# One document, one item — plan

> **Status: proposed, not built.** Recorded as C35 in `Claude-ERP.md` §18.
> Nothing here is built until the user decides the points in §6.

## 1. The idea

Every document that creates a position with a customer or supplier has
**exactly one open item**, for its whole life:

| Document | Its one item | Today |
| --- | --- | --- |
| Invoice Penjualan / Pembelian | one Invoice item | already one per Invoice |
| Uang Muka Penjualan / Pembelian (the advance bill) | **one Uang Muka item per bill** | **one per bill *per receipt*** (P73, U1) |

So a reader can always go from a document to its item and back, one to one.
The only real change is to the **Uang Muka item**. The Invoice side already
works this way.

This also fits P132. A receipt reads the document's state and never another
receipt. The bill keeps `paid_amount`, and the bill's one item keeps what is
still unused.

## 2. What changes for the Uang Muka item

### 2.1 Today

```
Bill ARA/…/0001  (DPP 10.000.000)
 ├─ Receipt BKM/…/0001 pays 5.091.743 → item ARI/…/0001  DPP 4.587.156
 └─ Receipt BKM/…/0007 pays 6.008.257 → item ARI/…/0004  DPP 5.412.844
Invoice deducts → picks ARI/0001 and/or ARI/0004 separately
```

### 2.2 Proposed

```
Bill ARA/…/0001
 └─ item ARI/…/0001   (one, for the bill)
      Create            +4.587.156   BKM/…/0001   (first payment)
      AdvanceReceived   +5.412.844   BKM/…/0007   (each later payment)  ← new event
      AdvanceUsed       −x           INV/…        (Invoice deducts)
```

- **Born by the first payment**, at the DPP it received. This keeps P116:
  no item without money, so the item still reconciles with the Uang Muka
  Penjualan account.
- **Each later payment raises the same item** with a new Buku Piutang event,
  `AdvanceReceived` (*Uang Muka Diterima*). The posting finds the bill's item
  under the bill's lock and creates it only if none exists.
- **Invoices lower it** with `AdvanceUsed`, as today.
- **`original_amount` becomes "total received"**: the sum of its Create and
  AdvanceReceived entries. It is no longer fixed at birth, so P116's "fixed"
  wording is amended for this item type (decision D3).
- Scope (`customer_order_id`), number (`ARI/…`), direction (Decrease) and the
  Uang Muka Customer report are unchanged, except that the report shows one
  row per bill.

The AP side mirrors all of this: `fin_ap_item`, Buku Hutang, Uang Muka
Pembelian (P127).

## 3. The tax consequence — the hard part

Today **one Uang Muka item = one Faktur Pajak Uang Muka** (`tax_faktur.ar_item_id`),
so when an Invoice deducts from an item, its Faktur Pelunasan names exactly
that faktur (`tax_faktur_ref`).

With one item per bill, **one item has several Fakturs Uang Muka**, one per
payment. A deduction of `x` DPP from the item must be shared over them.

**Proposed rule:** the item's fakturs are consumed **oldest first** by DPP:

```
for each Faktur Uang Muka f of the bill, by date then id:
  take_f = min(x_left, f.dpp − already deducted from f)
  tax_faktur_ref(faktur pelunasan, f, dpp_deducted = take_f, ppn_deducted = share)
```

The Faktur Pelunasan then names each faktur it draws on, with the DPP taken
from each.

**PPN of the part used** (P118) is the chain on the item's cumulative DPP
used, less the chain on what was used before. With one item per bill, that
cumulative runs over the **whole bill**, not over each payment. For a bill
paid in instalments the PPN deducted can therefore move by about Rp1
compared with today. The total over the bill stays the chain on its whole
DPP. The `ppn_deducted` shares per faktur are cut positionally from that
figure (`tax_concept.md` §7.5).

`tax_faktur.ar_item_id` stays. Several fakturs now point at the same item.

## 4. Invoice: read the document or the item?

You asked whether the receipt should read the Invoice itself (a new
`paid_amount` on `fin_ar_invoice` / `fin_ap_invoice`), like the advance bill
since P132.

**This contradicts the adopted open-item concept**
(`knowledge/ar_ap_open_item_concept.md` §3):

> The open item is the **settlement unit**, not the source document itself.
> Source documents should not own their own outstanding balance. Outstanding
> balance is maintained through the open-item model.

- **The deviation:** the Invoice would store what was paid, so the Invoice
  and its item would both hold "what is still owed".
- **The case for the existing rule:**
  - with one document = one item, the Invoice item *is* the Invoice's
    settlement state, read in one step;
  - a second copy needs a reconcile check to catch drift, and every future
    event (retur, DN/CN, write-off, refund) would have to update both;
  - the receipt already does not read other receipts for an Invoice. It
    reads the one item.
- **Why the advance bill is different (and why P132 did not break §3):**
  - the bill is outside the open items, a noted item like SAP's
    down-payment request (P73, P116);
  - its item is at DPP and goes down when Invoices use it, so it cannot say
    how much of the bill's gross total was paid. The bill has to carry that
    itself.

**Recommendation:** the Invoice keeps no `paid_amount`, and the receipt reads
the Invoice's one item, as today (option **A** below). If you still want it,
§20 asks you to choose:

- **A** — follow the concept: no `paid_amount` on the Invoice.
- **B** — improve the KB concept for every project: documents may keep a
  paid figure beside their item, checked by reconcile.
- **C** — a second concept (a variant).
- **D** — a local exception for this ERP only.

## 5. Migration of existing data

1. For each bill (AR and AP) with more than one Uang Muka item, keep the
   **oldest** item as the bill's item.
2. Move every Buku Piutang / Buku Hutang entry of the others onto it:
   - each extra item's `Create` becomes `AdvanceReceived`;
   - the survivor's balance is recomputed in date order, and `balance_after`
     is rewritten on every entry.
3. Repoint whatever names a retired item:
   - `fin_ar_invoice_advance_deduction.ar_item_id` / `ar_item_no`, merging
     rows that become duplicates on `(invoice_id, ar_item_id)` by adding
     their `dpp_used` / `ppn_used`;
   - `counter_item_id` on ledger entries;
   - `tax_faktur.ar_item_id`.
4. Retired items are **deleted**, so the `ARI` numbers they had are no longer
   used. Their numbers are written into the survivor's ledger notes. This is
   history-rewriting of a book, so the user must allow it (D5).
5. Posted Invoices keep their figures. Only the item each deduction points
   at changes.
6. `db:reconcile`:
   - the Uang Muka item checks become one item per bill;
   - a new check: for each bill, the item's `original_amount` equals the sum
     of `dpp_part` on the posted lines naming the bill.

## 6. Decisions needed

| # | Question | Recommendation |
| --- | --- | --- |
| D1 | Replace U1 / P73's **"one Uang Muka item per bill per receipt"** with **one per bill**? It reverses an agreed decision. P87–P92 note that the desktop branch `wip-ar-p87-p92` already did this and was parked for exactly this reason, so it may be worth reviving instead of rewriting | Yes, if you want 1 doc = 1 item; review that branch first |
| D2 | When is the item born: at the **first payment** (no money, no item), or at **Terbitkan** with balance 0? | First payment (keeps P116 and reconciliation simple) |
| D3 | For a Uang Muka item, `original_amount` = **total received** and grows with payments. OK to amend P116's "fixed at birth" for this type? | Yes |
| D4 | Share an Invoice's deduction over the bill's Fakturs Uang Muka **oldest first** (§3)? | Yes |
| D5 | Migrate existing items by merging and **deleting the extra items** (§5)? The alternative is to keep old items as they are and apply the rule to new bills only, but then two rules live side by side | Merge (development data only) |
| D6 | `paid_amount` on the Invoice: **A / B / C / D** (§4) | **A** — the receipt reads the Invoice's item |

## 7. Build steps, once decided

1. Schema: add `AdvanceReceived` to `ArEvent` (shared by AP); migration
   (§5); DBML.
2. `ar-item.ts` / `ap-item.ts`: `receiveAdvance(tx, bill, dpp, …)` — create
   the item or raise it — under the bill's lock.
3. `cash-bank-tx.ts` / `cash-payment.ts`: call it instead of `createArItem`
   / `createApItem` per line.
4. `ar-invoice.ts` / `ap-invoice.ts`: the Uang Muka picker lists one row per
   bill; deduction unchanged against the item.
5. `tax-document.ts`: Faktur Pelunasan refs shared oldest first (§3);
   `fakturNsfpByArItemIds` returns several NSFPs per item.
6. Reports: Uang Muka Customer / Supplier, one row per bill; Buku Piutang /
   Hutang show the new event.
7. Tests and reconcile checks; record P133 in `Claude-ERP.md`, update
   `Sales-Process-Concept.md` §8 and `Purchasing-Concept.md`, queue the
   harvest.
