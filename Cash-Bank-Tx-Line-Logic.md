# Cash Bank Tx — how one line works

How a line of a Penerimaan (`fin_cash_bank_tx_line`) gets its outstanding,
splits what it settles into DPP and PPN, and works out the PPh withheld — with
the formulas, so the figures can be recomputed or checked from the tables.

Code: `src/lib/erp/cash-bank-tx.ts` (`checkCashReceipt`, `openBills`,
`buildPosting`) and the arithmetic in `src/lib/erp/sales-tax.ts`
(`settleBill`, `settleBillFromCash`, `cashToClear`). Decisions: P66–P69, P76,
P98, P116–P119; rounding `tax_concept.md` §7.

The Pengeluaran (`cash-payment.ts`) is the same engine mirrored for
suppliers; this note uses the receipt.

---

## 1. What is stored

```
fin_cash_bank_tx                (header — one bank statement line)
  cash_amount     what reached the bank          = Σ line cash − bank_charge
  bank_charge     fee the bank kept (company's expense)
  settled_amount  Σ line settled_amount
  pph_amount      Σ line pph_amount

fin_cash_bank_tx_line           (one document paid: advance bill or Invoice)
  doc_type_id, doc_id    which document (fin_ar_advance / fin_ar_invoice)
  settled_amount  S      what this line clears of the document = cash + PPh
  withhold               the Potong PPh switch
  dpp_part        S_dpp  S − S_ppn
  ppn_part        S_ppn  this payment's share of the document's PPN
  pph_amount      S_pph  Σ of its wht rows

fin_cash_bank_tx_line_wht       (one per Jenis PPh on the line)
  withholding_tax_id, rate
  base_amount            this payment's share of the document's PPh base
  amount                 this payment's share of the document's PPh
```

**There is no cash column on the line.** The cash the customer sent for it is
derived:

```
line cash = settled_amount − pph_amount
```

> The schema comment on `settled_amount` still says "+ its share of the bank
> charge". That is from before P76: the bank charge is no longer shared to
> lines. It is one header figure, taken off what reached the bank.

### Can it be computed from the cash bank tx tables alone?

**The outstanding and the "what this payment did" — yes. The split — no, not
from the tx tables alone.** A line's split is a share of its *document's*
totals, so you need four figures from the document header:

| Needed | Advance bill (`fin_ar_advance`) | Invoice (`fin_ar_invoice`) |
| --- | --- | --- |
| `T` total asked | `total_amount` | `total_amount` (net Piutang, after Uang Muka) |
| `P` PPN | `ppn_amount` | `ppn_amount` (full PPN − advance PPN, P113) |
| `B_k` PPh base per Jenis PPh | the bill's DPP shared over the Customer Order lines by Jenis PPh (`computeAdvance`) | Σ `net_dpp_amount` of the Invoice lines with that Jenis PPh |
| `W_k` PPh per Jenis PPh | `round(B_k × rate_k)` | `round(B_k × rate_k)` |

Everything else comes from `fin_cash_bank_tx_line` itself.

---

## 2. Outstanding (sisa) of the document

What earlier receipts settled — **posted ones only, Draft and Cancelled never
count, and the receipt being edited never counts itself**:

```
before = Σ settled_amount
         FROM fin_cash_bank_tx_line l JOIN fin_cash_bank_tx t ON t.id = l.tx_id
         WHERE l.doc_type_id = :doc_type AND l.doc_id = :doc
           AND t.status = 'Posted' AND t.id <> :this_tx

open   = T − before
```

```sql
SELECT COALESCE(SUM(l.settled_amount), 0) AS before
FROM fin_cash_bank_tx_line l
JOIN fin_cash_bank_tx t ON t.id = l.tx_id
JOIN sys_doc_type d     ON d.id = l.doc_type_id
WHERE d.doc_table = 'fin_ar_advance'   -- or 'fin_ar_invoice'
  AND l.doc_id = :doc_id
  AND t.status = 'Posted'
  AND t.id <> :this_tx;                 -- leave out the receipt being edited
```

That is literally how an **advance bill** is read (`settledByDocuments`).

For an **Invoice** the code reads the open amount from its AR item instead
(`fin_ar_item.current_balance`, U23): `open = balance`, `before = T − balance`.
Both give the same number, because the Invoice item starts at the net total
(face, then *Uang Muka Diterapkan*, P117) and only a posted receipt lowers it,
by exactly the line's `settled_amount`.

Because `settled_amount` includes the PPh, **the PPh the customer withheld
counts as paid**: a bill paid in cash + bukti potong is Lunas.

---

## 3. Splitting a payment: the positional share

Every tax figure of the document is shared to a payment **cumulatively**
(`tax_concept.md` §7.5). For any figure `F` of the document (its PPN, a PPh
base, a PPh amount), the share of a payment that takes the document from
`before` to `after = before + S` is:

```
share(F) = round(F × after / T) − round(F × before / T)
```

`round` is **half up to whole rupiah**, computed on integers (no floating
point). Why this form:

- the shares of all payments always add up to `F` exactly — no lost rupiah;
- the payment that clears the bill (`after = T`) gets `F − round(F × before / T)`,
  i.e. whatever is left;
- a payment made with Potong PPh off takes no PPh, and does not leave its PPh
  behind for a later payment.

With it, for a line that settles `S`:

```
after    = before + S
S_ppn    = round(P × after / T) − round(P × before / T)        → ppn_part
S_dpp    = S − S_ppn                                          → dpp_part

per Jenis PPh k (only when withhold = true):
  base_k = round(B_k × after / T) − round(B_k × before / T)   → wht.base_amount
  pph_k  = round(W_k × after / T) − round(W_k × before / T)   → wht.amount
S_pph    = Σ pph_k                                            → pph_amount
cash     = S − S_pph
```

Note **`pph_k` is a share of the document's PPh, not `round(base_k × rate)`.**
The two usually agree but can differ by Rp1; the share is what keeps the
instalments adding up to the document's PPh exactly. `rate` on the wht row is
stored for the bukti potong, not used to recompute.

---

## 4. From the cash typed to `S` (P76)

The user does not type `S`. They type **Diterima** — the money that came for
this document. `S` is found from it.

### 4.1 Cash that clears the document

```
cashToClear = open − Σ_k [ W_k − round(W_k × before / T) ]     (withhold on)
cashToClear = open                                              (withhold off)
```

i.e. the remainder less the PPh still to be withheld on it.

- `Diterima > cashToClear` → refused (*Melebihi sisa tagihan* — no overpayment, P85).
- `Diterima = cashToClear` → `S = open`; the gap is the PPh; the document is Lunas.

### 4.2 Less money: a partial payment

`S` is the smallest part whose cash, after its own positional PPh, is exactly
the money:

```
find S such that  S − S_pph(S) = Diterima
```

`S − S_pph(S)` grows by 0–1 rupiah per rupiah of `S`, so the code estimates

```
S ≈ round(Diterima × open / cashToClear)
```

and tries `S` within ±4 of it. If no `S` lands exactly (two PPh shares can
both step on the same rupiah), the line is refused with *ubah Rp1*.

Withhold off → `S = Diterima`, no PPh.

### 4.3 The header

```
total diterima  = Σ line cash
cash_amount     = total diterima − bank_charge    (Dana Masuk ke Bank; bank_charge < total)
settled_amount  = Σ S
pph_amount      = Σ S_pph
```

Check: `cash_amount + bank_charge + pph_amount = settled_amount`.

---

## 5. Kena / tidak kena PPN

PPN is **decided on the Customer Order** (`is_taxable`, P52) and copied to the
advance bill and the Invoice with the PPN rate and the 11/12 factor (P60).
The cash bank tx does not decide it; it only follows the document's `P`:

| Document | Not Kena PPN | Kena PPN |
| --- | --- | --- |
| `is_taxable` | false | true |
| `ppn_amount` (`P`) | 0 | > 0 |
| every line's `ppn_part` | 0 (share of 0) | its share of `P` |
| Faktur Pajak Uang Muka | none | one per advance line with `ppn_part > 0` |

From the tx tables alone the signal is `ppn_part > 0`. It is not conclusive
in one edge case: a taxable bill paid in a tiny part can round its share to 0.
The authoritative test is the document's `is_taxable` (or `ppn_amount > 0`).

What `ppn_part` **does** differs by kind:

- **Advance bill** — `ppn_part` is booked: Cr PPN Keluaran at receipt (PPN on
  an advance is due when the money comes in), and it is the figure of the
  Faktur Pajak Uang Muka. `dpp_part` goes to Cr Uang Muka Penjualan and is what
  the Uang Muka AR item is born at.
- **Invoice** — PPN was booked by the Invoice. `ppn_part` / `dpp_part` are
  stored **for information only**; the whole `S` is Cr Piutang Usaha (U25).

---

## 6. The journal one receipt writes

```
Dr Kas & Bank                 cash_amount
Dr Beban Bank                 bank_charge                 (if any)
Dr PPh Dibayar Dimuka (k)     Σ pph_k of type k           per Jenis PPh, naming the customer
   Cr Uang Muka Penjualan     dpp_part                    per advance line, naming the customer
   Cr PPN Keluaran            Σ ppn_part of advance lines
   Cr Piutang Usaha           settled_amount              per Invoice line, naming the customer
```

Beside it: the Cash Bank Book (`cash_amount` In), an Uang Muka AR item per
advance line at `dpp_part`, a *Pembayaran* of `settled_amount` on each Invoice
item, a Faktur Pajak Uang Muka per taxable advance line and a Bukti Potong per
wht row.

---

## 7. Worked example (computed with the code's own functions)

Advance bill, Kena PPN, PPN 12 % × 11/12, PPh 23 2 %:

```
DPP 10.000.000 → DPP Nilai Lain round(10.000.000 × 11/12) = 9.166.667
               → PPN round(9.166.667 × 12 %)               = 1.100.000
T = 11.100.000   P = 1.100.000   B = 10.000.000   W = 200.000
```

**Receipt 1** — before = 0, customer sends **5.000.000** with Potong PPh on.

```
cashToClear = 11.100.000 − 200.000 = 10.900.000   → partial
S estimate  ≈ 5.000.000 × 11.100.000 / 10.900.000 ≈ 5.091.743
S           = 5.091.743   (5.091.743 − 91.743 = 5.000.000 ✓)

ppn_part = round(1.100.000 × 5.091.743 / 11.100.000) − 0 = 504.587
dpp_part = 5.091.743 − 504.587                           = 4.587.156
base     = round(10.000.000 × 5.091.743 / 11.100.000)    = 4.587.156
pph      = round(200.000 × 5.091.743 / 11.100.000)       = 91.743
cash     = 5.091.743 − 91.743                            = 5.000.000
```

**Receipt 2** — before = 5.091.743, open = 6.008.257.

```
cashToClear = 6.008.257 − (200.000 − 91.743) = 5.900.000
customer sends 5.900.000 → S = open = 6.008.257 (clears)

ppn_part = 1.100.000 − 504.587   = 595.413
dpp_part = 6.008.257 − 595.413   = 5.412.844
base     = 10.000.000 − 4.587.156 = 5.412.844
pph      = 200.000 − 91.743      = 108.257
cash     = 6.008.257 − 108.257   = 5.900.000
```

Totals over both receipts: settled 11.100.000 = T, PPN 1.100.000 = P,
PPh 200.000 = W, cash 10.900.000. Nothing lost, nothing created.

---

## 8. Checks that must hold on the stored rows

```
line:    settled_amount = dpp_part + ppn_part
         pph_amount     = Σ wht.amount
         pph_amount     = 0                      when withhold = false
         settled_amount − pph_amount > 0         (cash received)

header:  settled_amount = Σ line settled_amount
         pph_amount     = Σ line pph_amount
         cash_amount    = Σ (line settled − line pph) − bank_charge

per document over its posted lines:
         Σ settled_amount ≤ T
         Σ ppn_part       = P    once fully settled
         Σ wht.amount     = W_k  per Jenis PPh, once fully settled with withhold on every line
```
