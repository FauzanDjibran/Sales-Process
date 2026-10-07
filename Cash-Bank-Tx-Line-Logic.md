# Cash Bank Tx — how to use it, and how one line works

Part A is how to record money in and out in the app. Part B is how a line
(`fin_cash_bank_tx_line`) gets its outstanding, splits what it settles into
DPP and PPN, and works out the PPh — with the formulas, so the figures can be
recomputed or checked from the tables.

Code: `src/lib/erp/cash-bank-tx.ts` (`checkCashReceipt`, `openBills`,
`buildPosting`) and the arithmetic in `src/lib/erp/sales-tax.ts`
(`settleBill`, `settleBillFromCash`, `cashToClear`). Decisions: P66–P69, P76,
P98, P116–P119, P132; rounding `tax_concept.md` §7.

**Each receipt stands alone (P132).** A receipt never reads another receipt.
What a document has been paid so far lives on the document itself, and a
receipt reads it from there and adds to it when it posts.

The Pengeluaran (`cash-payment.ts`) is the same engine mirrored for
suppliers; Part B uses the receipt, and §B9 lists where the Pengeluaran
differs.

---

# Part A — Using it

## A1. Which menu

| You are recording | Menu | Tujuan | Number |
| --- | --- | --- | --- |
| Money from a customer, for an advance bill (Uang Muka Penjualan) and / or a posted Invoice Penjualan | Finance › Kas & Bank › **Penerimaan** | *Penerimaan dari Customer* | `BKM/YYYY/MM/NNNN` |
| Money to a supplier, for an advance bill (Uang Muka Pembelian) and / or a posted Invoice Pembelian | Finance › Kas & Bank › **Pengeluaran** | *Pembayaran ke Supplier* | `BKK/YYYY/MM/NNNN` |

**One transaction = one line on the bank statement.** If the customer sent
one transfer for three bills, record one Penerimaan with three lines.

What can be paid:

- an **advance bill** once it is *Diterbitkan* (issued); nothing is booked
  until money comes;
- an **Invoice** once it is *Posted*.

A document drops out of the list once it is fully paid (*Lunas*).

## A2. Recording a Penerimaan, step by step

1. **Baru.** Fill the header:
   - **Tujuan** — *Penerimaan dari Customer*.
   - **Partner** — the customer. Only that customer's documents can be paid.
   - **Kas & Bank** — the rupiah cash or bank account the money reached.
   - **Tanggal Terima** — the date on the bank statement. It may not be
     before the date of any document it pays.
   - **Referensi Bank** — the transaction number on the statement
     (optional, printed in the journal).
   - **Catatan** — optional.
2. **Pilih Tagihan.** A dialog lists the customer's open documents, oldest
   due first, with their total, *Dibayar* (paid so far) and *Sisa*. Tick the
   ones this transfer pays (*Pilih semua* ticks all), then **Terapkan**.
   - **Bagikan Dana** (optional): type the transfer amount once and it is
     spread over the ticked documents oldest first, each up to what clears
     it.
3. **Per line, type Diterima** — the money the customer sent **for that
   document**, not the gross bill.
   - **Potong PPh** (on by default): the customer withheld PPh, so the gap
     between the money and the bill is PPh and a bukti potong is expected.
     Turn it off when the customer paid without withholding.
   - The line shows the PPh and what is left after this payment.
   - Typing more than clears the document is refused (no overpayment).
   - A partial payment is fine: the rest stays open on the document.
4. **Biaya Bank** — the fee the bank kept, if any. It comes off what reached
   the bank and is the company's expense; the customer's bills are still
   cleared by what the customer sent.
   *Dana Masuk ke Bank* = Total Diterima − Biaya Bank: check it matches the
   statement.
5. **Simpan.** The transaction is a **Draft**: nothing is booked, no
   document is paid yet, and a Draft reserves nothing.
6. **Posting.** The confirmation shows the exact journal it will write (a dry
   run of the real posting). *Ya, Posting* books everything at once (§A4).
   If another receipt paid the same document since you saved, Posting
   re-reads the document and refuses if it no longer has room.
7. **Batalkan** (with a reason) is only for a Draft. A posted transaction is
   final; a wrong one is corrected by a new document, not edited.

## A3. Recording a Pengeluaran

The same steps under Finance › Kas & Bank › **Pengeluaran**, with these
differences:

- **Tujuan** *Pembayaran ke Supplier*, **Partner** the supplier,
  **Tanggal Bayar**.
- Per line you type the money **paid** to the supplier.
  - For an **advance bill**, *Potong PPh* means **the company** withholds
    PPh 23 from the supplier: the gap is Hutang PPh the company owes the tax
    office.
  - For an **Invoice Pembelian**, the PPh was already booked by the Invoice,
    so the line is paid in cash only, with no PPh.
- **Biaya Bank** leaves the bank **with** the payment:
  *Dana Keluar dari Bank* = paid + Biaya Bank.
- Posting refuses if the cash or bank account would go below zero
  (*Saldo Cash & Bank tidak mencukupi*).

## A4. What Posting does

All in one database transaction — everything or nothing:

| Written | Penerimaan | Pengeluaran |
| --- | --- | --- |
| Journal | §B6 | Dr Uang Muka Pembelian · Dr PPN Masukan · Dr Beban Bank / Cr Kas & Bank · Cr Hutang PPh (advance bill); Dr Hutang Usaha / Cr Kas & Bank (Invoice) |
| Cash Bank Book | Dana Masuk ke Bank, In | Dana Keluar dari Bank, Out |
| Each document paid | `paid_amount` += what the line settled | same |
| Advance bill's item | the bill's **one** Uang Muka item: created by the first payment, raised by each later one (*Uang Muka Diterima*) | same, AP side (*Uang Muka Dibayar*) |
| Invoice's item | *Pembayaran* on the Invoice item | same, AP side |
| Tax records | Faktur Pajak Uang Muka per taxable advance line (one per payment); Bukti Potong per PPh row | none yet (the company's own bukti potong is out of scope) |

## A5. Reading where a document stands

- The advance bill and the Invoice show **Belum Dibayar / Sebagian /
  Lunas** from their own `paid_amount`, and list the receipts that paid them.
- A paid advance bill can no longer be cancelled; a leftover is to be
  refunded (Pengembalian Uang Muka, not built yet).
- Buku Piutang / Buku Hutang, Umur Piutang / Hutang and Uang Muka Customer /
  Supplier read the items.

---

# Part B — How one line works

## B1. What is stored

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

The bank charge is not shared to lines (P76): it is one header figure, taken
off what reached the bank.

### B1.1 What a line needs

A line is computed from **one receipt plus one document**, never from other
receipts. From the document it reads its totals and what it has been paid:

| Needed | Advance bill (`fin_ar_advance`) | Invoice (`fin_ar_invoice`) |
| --- | --- | --- |
| `before` paid so far | `paid_amount` | `paid_amount` (P133) |
| `T` total asked | `total_amount` | `total_amount` (net Piutang, after Uang Muka) |
| `P` PPN | `ppn_amount` | `ppn_amount` (full PPN − advance PPN, P113) |
| `B_k` PPh base per Jenis PPh | the bill's DPP shared over the Customer Order lines by Jenis PPh (`computeAdvance`) | Σ `net_dpp_amount` of the Invoice lines with that Jenis PPh |
| `W_k` PPh per Jenis PPh | `round(B_k × rate_k)` | `round(B_k × rate_k)` |

Everything else comes from the line itself.

---

## B2. Outstanding (sisa) of the document

The document carries it. No receipt is summed:

```
advance bill:  before = fin_ar_advance.paid_amount
               open   = total_amount − paid_amount

Invoice:       before = fin_ar_invoice.paid_amount
               open   = total_amount − paid_amount
```

```sql
SELECT total_amount, paid_amount, total_amount - paid_amount AS open
FROM fin_ar_advance WHERE id = :bill_id;   -- or fin_ar_invoice
```

**Posting keeps it current.** In the same transaction, with the document
locked, posting a receipt adds each line's `settled_amount` to its document's
`paid_amount` (`recordSalesAdvancePaid` / `recordSalesInvoicePaid`), refused
if it would pass the total. Beside it the book moves too: an Invoice line
records *Pembayaran* on the Invoice's AR item, an advance line creates or
raises the bill's **one** Uang Muka item (P133). So the next receipt finds the
new `before` on the document, and `db:reconcile` proves the document and its
item agree (`total − paid_amount = item balance`).

- Only posting writes it. A Draft changes nothing, so a Draft never counts
  itself or another Draft.
- `settled_amount` includes the PPh, so **the PPh the customer withheld
  counts as paid**: a bill paid in cash + bukti potong is Lunas.
- The bill's Belum Dibayar / Sebagian / Lunas and its refusal of Batalkan
  (`paid_amount > 0`) read the same field.
- `db:reconcile` proves `paid_amount` = Σ `settled_amount` of the posted lines
  naming the bill. That sum is a check, not how the app reads it.

---

## B3. Splitting a payment: the positional share

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

## B4. From the cash typed to `S` (P76)

The user does not type `S`. They type **Diterima** — the money that came for
this document. `S` is found from it.

### B4.1 Cash that clears the document

```
cashToClear = open − Σ_k [ W_k − round(W_k × before / T) ]     (withhold on)
cashToClear = open                                              (withhold off)
```

i.e. the remainder less the PPh still to be withheld on it.

- `Diterima > cashToClear` → refused (*Melebihi sisa tagihan* — no overpayment, P85).
- `Diterima = cashToClear` → `S = open`; the gap is the PPh; the document is Lunas.

### B4.2 Less money: a partial payment

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

### B4.3 The header

```
total diterima  = Σ line cash
cash_amount     = total diterima − bank_charge    (Dana Masuk ke Bank; bank_charge < total)
settled_amount  = Σ S
pph_amount      = Σ S_pph
```

Check: `cash_amount + bank_charge + pph_amount = settled_amount`.

---

## B5. Kena / tidak kena PPN

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
  the bill's one Uang Muka AR item is born at (first payment) or raised by
  (each later payment, *Uang Muka Diterima*, P133).
- **Invoice** — PPN was booked by the Invoice. `ppn_part` / `dpp_part` are
  stored **for information only**; the whole `S` is Cr Piutang Usaha (U25).

---

## B6. The journal one receipt writes

```
Dr Kas & Bank                 cash_amount
Dr Beban Bank                 bank_charge                 (if any)
Dr PPh Dibayar Dimuka (k)     Σ pph_k of type k           per Jenis PPh, naming the customer
   Cr Uang Muka Penjualan     dpp_part                    per advance line, naming the customer
   Cr PPN Keluaran            Σ ppn_part of advance lines
   Cr Piutang Usaha           settled_amount              per Invoice line, naming the customer
```

Beside it: the Cash Bank Book (`cash_amount` In), `paid_amount` raised on each
document, the bill's one Uang Muka AR item created or raised by `dpp_part`, a
*Pembayaran* of `settled_amount` on each Invoice item, a Faktur Pajak Uang Muka
per taxable advance line (one per payment, all naming the bill's one item) and
a Bukti Potong per wht row.

---

## B7. Worked example (computed with the code's own functions)

Advance bill, Kena PPN, PPN 12 % × 11/12, PPh 23 2 %:

```
DPP 10.000.000 → DPP Nilai Lain round(10.000.000 × 11/12) = 9.166.667
               → PPN round(9.166.667 × 12 %)               = 1.100.000
T = 11.100.000   P = 1.100.000   B = 10.000.000   W = 200.000
```

**Receipt 1** — bill's `paid_amount` = 0, customer sends **5.000.000** with Potong PPh on.

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

After posting, the bill holds `paid_amount` = 5.091.743.

**Receipt 2** — reads `before` = 5.091.743 from the bill, open = 6.008.257.

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

## B8. Checks that must hold on the stored rows

```
line:    settled_amount = dpp_part + ppn_part
         pph_amount     = Σ wht.amount
         pph_amount     = 0                      when withhold = false
         settled_amount − pph_amount > 0         (cash received)

header:  settled_amount = Σ line settled_amount
         pph_amount     = Σ line pph_amount
         cash_amount    = Σ (line settled − line pph) − bank_charge

per document over its posted lines (a reconcile check, not how it is read):
         Σ settled_amount = paid_amount ≤ T     (advance bill and Invoice)
         Σ ppn_part       = P    once fully settled
         Σ wht.amount     = W_k  per Jenis PPh, once fully settled with withhold on every line
```

---

## B9. Where the Pengeluaran differs

Same tables (`direction = Out`), same formulas, with these differences
(`cash-payment.ts`):

| | Penerimaan (customer) | Pengeluaran (supplier) |
| --- | --- | --- |
| Documents | `fin_ar_advance`, `fin_ar_invoice` | `fin_ap_advance`, `fin_ap_invoice` |
| `T` for an Invoice | `total_amount` (net Piutang) | what it owes: `payable_amount − advance_dpp_amount − advance_ppn_amount` |
| PPh on an Invoice line | withheld by the customer, split per §B3 | none: booked at the Invoice Pembelian, the line is cash only (`P` = 0, no `W_k`) |
| PPh on an advance line | withheld by the customer → Dr PPh Dibayar Dimuka | withheld **by the company** → Cr Hutang PPh |
| Bank charge | `cash_amount = Σ cash − bank_charge` | `cash_amount = Σ cash + bank_charge` |
| Overdraw | — | refused |
| Advance item event | *Uang Muka Diterima* | *Uang Muka Dibayar* (same `AdvanceReceived` event) |

