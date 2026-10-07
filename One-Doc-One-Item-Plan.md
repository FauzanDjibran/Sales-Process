# One document, one item — plan

> **Status: agreed and built 07/10/2026** (P133 in `Claude-ERP.md`). The
> user's answers to D1–D6 are in §8; §9 lists the build steps, all done. The
> deployed (Neon) database still needs its reset before the migration (§5).

## 1. The rule

Every document that creates a position with a customer or supplier has
**exactly one open item** for its whole life. That document also **keeps what
it has been paid** (`paid_amount`).

| Document | Its one item | Keeps `paid_amount` |
| --- | --- | --- |
| Uang Muka Penjualan / Pembelian (advance bill) | one **Uang Muka** item per bill | yes (P132, built) |
| Invoice Penjualan / Pembelian | one **Invoice** item per Invoice (already so) | **yes, new** |

**What each one is for:**

- **A receipt or payment reads the document**, never another receipt and
  never the item:
  - `before = paid_amount`;
  - `open = total − paid_amount` (for an Invoice Pembelian, `owed − paid_amount`).
- **The item is the book's view**: Buku Piutang / Hutang, Umur, Uang Muka
  Customer / Supplier, the reconciliation with the General Ledger, and the
  Uang Muka an Invoice deducts.
- **Both are written in the same posting**, and `db:reconcile` proves they
  agree (§6).

## 2. The Uang Muka item: one per bill

```
Bill ARA/…/0001
 └─ item ARI/…/0001
      Create            +4.587.156   BKM/…/0001   first payment
      AdvanceReceived   +5.412.844   BKM/…/0007   each later payment   ← new event
      AdvanceUsed       −x           INV/…        an Invoice deducts it
```

- **Born by the first posted payment of the bill**, at the DPP part of that
  payment (D2). No payment, no item: the bill itself creates nothing.
- **Each later payment changes the balance of that same item** with a new
  Buku Piutang / Hutang event, **`AdvanceReceived`** (*Uang Muka Diterima*),
  for its DPP part.
  - The posting finds the bill's item with the bill locked, and creates it
    only when there is none.
  - The item is identified by its source (the bill, `source_doc_type_id` /
    `source_doc_id`); a unique index on it makes "one per bill" a database
    rule.
- **`original_amount` = total received**: the sum of its `Create` and
  `AdvanceReceived` entries. It grows with each payment (D3), amending P116's
  "fixed at birth" for this item type. An Invoice item's `original_amount`
  stays its face, fixed.
- Invoices lower it with **`AdvanceUsed`**, as today. The item never goes
  below 0.
- The AP side mirrors all of this: `fin_ap_item`, Buku Hutang, Uang Muka
  Pembelian.

## 3. Tax documents

**The Faktur Pajak Uang Muka is still made at each payment, as today (D4):**
one per bill per receipt, at that receipt line's DPP and PPN, dated the
receipt. Bukti Potong are unchanged as well: one per document, per payment,
per Jenis PPh (P69).

What changes is that **one Uang Muka item now has several Fakturs Uang
Muka**, one per payment, all pointing at it (`tax_faktur.ar_item_id`). So
when an Invoice deducts `x` DPP from the item, its Faktur Pelunasan has to
say which fakturs it draws on.

**The rule: oldest first.** The item's Fakturs Uang Muka are used in order of
date, then id. Each gives what it has not yet given, up to what is left of
`x`:

```
x_left = x
for each Faktur Uang Muka f of the bill, oldest first:
  free_f = f.dpp − Σ tax_faktur_ref.dpp_deducted of f
  take_f = min(x_left, free_f)
  tax_faktur_ref(faktur pelunasan, f, dpp_deducted = take_f, ppn_deducted = …)
  x_left = x_left − take_f
```

`ppn_deducted` per faktur is the positional share (`tax_concept.md` §7.5) of
the PPN of the part used, by `take_f`. So the refs add up to the Invoice's
`advance_ppn_amount` exactly.

**PPN of the part used** (P118) is still recalculated by the chain. It is now
cumulative over the **whole bill's** item:

```
ppn_used = chain(used so far + x) − chain(used so far)
```

Over every use of the bill, it adds up to the chain on everything received.
P118's accepted limit stays: when a bill is paid in instalments, the sum of
its fakturs' PPN (positional shares of the bill) can differ from the chain on
the total DPP by Rp1.

`fakturNsfpByArItemIds` returns a list of NSFPs per item instead of one.

## 4. The Invoice keeps `paid_amount` (D6 = B)

- `fin_ar_invoice.paid_amount` and `fin_ap_invoice.paid_amount`,
  `Decimal(18,2)`, default 0.
- CHECK `0 ≤ paid_amount ≤ total_amount` (AR), `≤ owed` (AP).
- **Reading:** the receipt reads the Invoice's `paid_amount` as `before`,
  exactly as it reads an advance bill. It no longer asks the item for the
  open amount.
- **Posting an Invoice line**, with the Invoice locked:
  - adds `settled_amount` to the Invoice's `paid_amount`
    (`recordSalesInvoicePaid` / `recordPurchaseInvoicePaid`, in the invoice
    module);
  - records *Pembayaran* of the same amount on the Invoice item, as today
    (the book).
- **The Invoice's standing** (Belum Dibayar / Sebagian / Lunas, Lewat jatuh
  tempo) reads `paid_amount`.
- The lock order is **Invoice, then its item**, so a posting never waits on
  the item while holding nothing.

**Knowledge base.** D6 = B changes the shared open-item concept for every
project. §3 of `ar_ap_open_item_concept.md` says source documents should not
own their outstanding balance. It becomes:

> A source document may keep **what it has been paid** beside its open item,
> so a payment reads its own document and never another payment. The item
> stays the settlement unit for the books, reports and allocation. Both are
> written in the same posting, and the reconcile proves
> `document total − paid = item balance`.

This session cannot reach `D:\Claude Code\Knowledge-Base`, so the edit is
**queued in `KNOWLEDGE.md` → Harvest queue as "Queued from cloud"**. It is
folded into the KB from the desktop, with a version bump and a changelog
line. The `knowledge/` copy is updated then, not before.

## 5. Data: reset, no merge (D5)

The user consents to a reset, so **no data is merged**.

- The migration is schema-only:
  - add `paid_amount` to the two Invoice tables;
  - add the `AdvanceReceived` event;
  - add the unique index on an Uang Muka item's source.
- **It refuses to run on data that breaks the new rule.** If any bill
  already has more than one Uang Muka item, the unique index cannot be
  built, so `migrate` stops and nothing is half-changed. The way through is
  a reset.
- **Local:** `npm run db:fresh` (reset + seed + showcase).
- **Deployed (Neon):** `npm run db:neon-reset -- --confirm`, then
  `db:neon-seed` and `db:neon-seed-accounts`. These must run from your
  machine; this cloud session cannot reach Neon (C33).
- `db:tax-backfill` is not needed after a reset.

## 6. Reconcile checks (`db:reconcile`)

| Check | Change |
| --- | --- |
| Uang Muka items equal the Uang Muka account per partner | unchanged |
| An advance bill's `paid_amount` = Σ its posted lines | unchanged (P132) |
| **One Uang Muka item per bill**; its `original_amount` = Σ `dpp_part` of the bill's posted lines | **new** (replaces "each posted advance line made one item") |
| **An Invoice's `paid_amount` = Σ its posted lines**, and `total − paid_amount = item balance` (AR), `owed − paid_amount = item balance` (AP) | **new** |
| Each posted taxable advance line made one Faktur Uang Muka | unchanged |
| Σ `tax_faktur_ref.dpp_deducted` from one Faktur Uang Muka ≤ its DPP | **new** |
| A fully used Uang Muka's PPN deducted = the chain on its whole DPP | unchanged, now over the bill's one item |

## 7. Screens

- **Uang Muka picker on the Invoice:** one row per bill. It shows the bill,
  the item number, its balance, what other Draft Invoices reserve, and the
  bill's fakturs' NSFPs (several).
- **Uang Muka Customer / Supplier report:** one row per bill.
- **Buku Piutang / Hutang:** the new event reads *Uang Muka Diterima*.
- **Advance bill and Invoice pages:** the standing reads the document's
  `paid_amount`.

## 8. Decisions taken (07/10/2026)

| # | Question | Answer |
| --- | --- | --- |
| D1 | One Uang Muka item per bill instead of per bill per receipt | **Yes.** Supersedes U1 and P73's "one per bill per receipt" |
| D2 | When the item is born | **At the first payment**; later payments change its balance |
| D3 | `original_amount` grows with payments for an Uang Muka item | **Yes** |
| D4 | Fakturs Uang Muka | **Still made at each payment, as today.** The deduction's share over them is oldest first (§3) |
| D5 | Existing data | **Reset the database** (consent given); no merge migration |
| D6 | `paid_amount` on the Invoice, against the open-item concept §3 | **B**: improve the concept for every project (§4) |

## 9. Build steps

1. **Schema:**
   - `paid_amount` and its CHECK on `fin_ar_invoice` / `fin_ap_invoice`;
   - `AdvanceReceived` in `ArEvent`;
   - a partial unique index on `fin_ar_item` / `fin_ap_item`
     `(source_doc_type_id, source_doc_id) WHERE item_type = 'Advance'`;
   - migration and DBML.
2. **Books** (`ar-item.ts` / `ap-item.ts`): `receiveAdvance(tx, …)`, which
   creates the bill's item or raises it with `AdvanceReceived` and adds to
   `original_amount`.
3. **Receipt / payment** (`cash-bank-tx.ts` / `cash-payment.ts`):
   - advance lines call `receiveAdvance`;
   - Invoice lines read `paid_amount` and call the invoice module's
     `record…InvoicePaid`, then *Pembayaran* on the item;
   - lock order: bill / Invoice, then item.
4. **Invoice modules** (`ar-invoice.ts` / `ap-invoice.ts`):
   - `recordSalesInvoicePaid` / `recordPurchaseInvoicePaid`;
   - `settlementInvoices` returns `paid`;
   - pay state reads `paid_amount`;
   - the Uang Muka picker lists one row per bill.
5. **Tax** (`tax-document.ts`):
   - Faktur Uang Muka per payment, unchanged;
   - the Faktur Pelunasan's refs shared oldest first with positional
     `ppn_deducted`;
   - `fakturNsfpByArItemIds` returns lists.
6. **Reports:** Uang Muka Customer / Supplier, one row per bill; the new
   event's label in Buku Piutang / Hutang.
7. **Tests:**
   - a bill paid in two receipts has one item raised twice;
   - an Invoice deducting it names both fakturs, oldest first;
   - receipts read the Invoice's `paid_amount`;
   - the reconcile checks hold.
8. **Docs:**
   - `Claude-ERP.md`: P133 built, and §10.2 rule 12;
   - `Sales-Process-Concept.md` §8 and `Purchasing-Concept.md`;
   - `Cash-Bank-Tx-Line-Logic.md`;
   - the harvest queue entry.
9. **Run the reset** locally (`db:fresh`) and tell you to run the Neon reset.
