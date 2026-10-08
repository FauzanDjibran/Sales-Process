# Perizinan — Pengajuan to Invoice Perizinan

> **Status: AGREED and BUILT 08/10/2026** (P138–P144). The plan for the
> Perizinan sales flow (§10.2 rule 11, IMPLEMENTATION-PLAN 3.10), learnt from
> the simulation (`Initialization/actual-simulation-v2.html`: `PERMITS`,
> `przPage`, `applyPrzToAdv`, `applyPrzToInv`, `payCostCard`,
> `seedPerizinan`). Every rule is numbered **Z1…**; the open questions are
> **QZ…** in §12. Once the user agrees, `Claude-ERP.md` records the adopting
> P-decision, and each build step records its own.

---

## 1. What Perizinan is

The company produces under **makloon** (toll manufacturing) for customers who
own the brand. Before such a product may be sold it needs permits: a
pre-registration review, the BPOM notification (NA number), laboratory tests
(stability, microbiology, heavy metals), halal certification, a trademark.
The company **arranges these permits for the customer** as a service, and
bills them **at cost**, plus PPN.

It is its own flow, not a goods sale:

| Goods sale (built) | Perizinan |
| --- | --- |
| A catalogue Item × quantity × agreed price | A list of permits, **each priced by estimate** — no item, no unit, no quantity |
| The price is fixed on the Customer Order | **The real price is known afterwards** (realisasi): a permit costs more or less, is dropped (0) or added |
| Billed from what was delivered | Billed from **what was realised**, as one amount |
| The customer's documents list the items | **Internal documents list the permits; external documents carry one description line** (Z1) |
| Cost = stock released (HPP) | Cost = **what the company pays out** for the permits (*Biaya Perizinan*), no stock |
| Nota Retur reduces billed quantity | No return — nothing to return |

In mainstream ERPs this is a **small project with an estimate, actuals and
billing at the actual** (Dynamics Project Operations, Odoo's *re-invoice
expenses at cost*, SAP's resource-related billing), not a catalogue sale.

**Z1. Internal shows the detail, external shows one line** (the user,
08/10/2026). The **Pengajuan and its Realisasi** are internal and list every
permit with its estimate and realised price. The **Uang Muka Perizinan, the
Invoice Perizinan and their faktur pajak** go to the customer and carry **one
description line**, e.g. *Jasa pengurusan perizinan — Serum Wajah "Glowin"
30 ml · realisasi RLZ/2026/09/0002*. **No Item represents a permit or the
service** — the user rejected a stand-in item that users would have to
maintain without it meaning anything.

## 2. The flow in one picture

```text
INTERNAL                                                   EXTERNAL (one description line)
Pengajuan Perizinan (PRZ/…)                                 
  full list of permits, estimate each, approved   ──────►  Uang Muka Perizinan (UMP/…)        posts nothing
  posts nothing                                              └─► Penerimaan dari Customer
                                                                  Dr Bank · Dr PPh 23 Dibayar Dimuka
                                                                  / Cr Uang Muka Perizinan · Cr PPN Keluaran
                                                                  + AR item Uang Muka · Faktur Uang Muka · Bukti Potong
Realisasi (RLZ/…, on the same Pengajuan)
  full list, real price each, permits added
  posts nothing
  ├─► Pengeluaran · Biaya Perizinan (lump, no tax, partial allowed)
  │     Dr Biaya Perizinan / Cr Bank
  └────────────────────────────────────────────────►  Invoice Perizinan (INP/…)
                                                        deducts the Pengajuan's Uang Muka
                                                        Dr Piutang (face) / Cr Pendapatan Perizinan · Cr PPN Keluaran
                                                        per Uang Muka: Dr Uang Muka Perizinan · Dr PPN Keluaran / Cr Piutang
                                                        + AR item Invoice · Faktur Normal / Pelunasan (1 line)
                                                        Pengajuan → Selesai
                                                         └─► Penerimaan dari Customer
                                                              Dr Bank · Dr PPh 23 Dibayar Dimuka / Cr Piutang
```

The simulation's four scenarios become the showcase seed: (1) realised
**below** the estimate — the advance covers the invoice whole and a leftover
remains; (2) realised **above** it with a permit **added** — Piutang left to
collect; (3) **Include PPN**, billed in full, advance unpaid; (4) a Draft.

## 3. What is reused, what is new

| Part | Decision |
| --- | --- |
| Arithmetic (`sales-tax.ts`: PPN chain, inclusive split, `computeAdvance`, `computeInvoice`, P113 / P117–P119) | **Reused as is**; Perizinan adds one function for the Pengajuan's totals |
| Penerimaan dari Customer (`customer_receipt`) | **Same menu, same purpose**; it learns two more document kinds (§9) |
| Pengeluaran | **Same menu**; one new purpose, *Biaya Perizinan* (§8) |
| AR items, Buku Piutang, Umur Piutang | **Reused**; the item's scope is generalised from a Customer Order to *Customer Order or Pengajuan* (§10) |
| Faktur pajak, Bukti Potong (Pajak module) | **Reused**; two one-line faktur builders added (§10) |
| Uang Muka Penjualan, Invoice Penjualan | **Untouched**. The goods invoice line stays free to gain its own item, unit and factor as NOT NULL for Nota Retur |
| Pengajuan, Uang Muka Perizinan, Invoice Perizinan, Jenis Perizinan | **New** |

**Why the advance and the invoice are separate documents** (the user, QZ5):
an external Perizinan document has no lines and no item, while the goods
invoice is a line document heading for item / unit / quantity per line and
returns. Forcing both into one table would leave the goods line's item
nullable and give the Perizinan invoice line columns that mean nothing. The
two Perizinan documents are **header-only**: their one line is the header's
description and figures. AR and AP already show the pattern (P58): **same
engine and design, their own tables**.

## 4. Master — Jenis Perizinan (`ref_permit_type`)

**Z2.** A reference master under **Master › Referensi**, a registry entity
with list / detail / create / edit / deactivate: **Label** (`IZ-001`), **Nama**,
**Kategori** (enum: Regulatori · Laboratorium · Sertifikasi · Kekayaan
Intelektual), **Uraian Default**, **Harga Estimasi Standar** (`Decimal(18,2)`,
before PPN, optional; only the starting estimate of a new Pengajuan line,
QZ2). Permissions `PERMIT_TYPE_VIEW / _CREATE / _EDIT`. Not an Item: no unit,
no quantity, never on a goods or purchasing document. A type a Pengajuan uses
is deactivated, never deleted.

## 5. Pengajuan Perizinan (`sal_permit_request(_line)`, `PRZ/…`) — internal

The flow's agreement, in the Sales module (P107: Sales holds orders). Menu
**Penjualan › Perizinan › Pengajuan Perizinan** (`/sales/permit`).

**Z3. Header** — Customer, Alamat (any of the customer's, P53), No. / Tanggal
PO customer, Termin (the customer's default, P51), Salesperson (free text,
P52), **Produk yang Didaftarkan** (text, required), **Kena PPN**, Mode Harga
(asked only when Kena PPN, P63), **Jenis PPh** (one per Pengajuan, usage
*Penjualan*, empty = none, QZ7), Catatan. Numbered `PRZ/…`, `PRZ-NP/…`
without PPN (P109).

**Z4. Lines — the full list** (`sal_permit_request_line`): Jenis Perizinan
(each once), Uraian (from the master, editable), **Harga Estimasi** (> 0, in
the price mode; starts on the standard estimate, grossed up by PPN when
Include), and from the realisation **Harga Realisasi** and *Tambahan* (a
permit added at realisation, estimate 0). Picked in a *Pilih Perizinan*
dialog (P81's pattern).

**Z5. Figures** — because the external documents carry one line, the
Pengajuan computes **PPN once on its total** (the faktur's single line; P60's
"the document is its faktur lines"), the inclusive split on the total (P115),
for the estimate and for the realisation alike. The PPh estimate (the Jenis
PPh's rate on the DPP) shows as *Estimasi Penerimaan*.

**Z6. Lifecycle** (QZ6) — Draft → *Ajukan* → Diajukan → *Setujui* (estimate
locked) → **Disetujui** → *Realisasikan* → **Terealisasi** → (Invoice
Perizinan posted) → **Selesai**. *Batalkan* (Draft, reason) and *Tolak*
(Diajukan, reason) are final; *Batalkan* of a Disetujui one only while no
Uang Muka Perizinan on it is live. Permissions `PERMIT_REQUEST_VIEW /
_CREATE / _EDIT / _SUBMIT / _APPROVE / _REALIZE / _CANCEL`. **Posts nothing.**

## 6. Realisasi — on the same Pengajuan, internal

**Z7.** From Disetujui, *Input Realisasi* opens the Pengajuan in realisation
mode: the estimates are locked; each line takes **Harga Realisasi** (0 = not
done); permits not estimated are **added** and must have a price; Tanggal
Realisasi (not before the Pengajuan) and Catatan Realisasi. *Realisasikan*
gives it **its own number `RLZ/YYYY/MM/NNNN`** and moves it to Terealisasi.
The page shows **Estimasi · Realisasi · Selisih** per permit and in total.

**Z8.** The realisation stays correctable (*Ubah Realisasi*) until a live
Invoice Perizinan or a live Biaya Perizinan payment names it; the action asks
both modules (§3.1 rule 2). It posts nothing, so nothing is reversed.

**Z9.** The realised total is what the Invoice bills; its **DPP is what the
Biaya Perizinan pays** — billed at cost (QZ3, answered).

## 7. Uang Muka Perizinan (`fin_ar_permit_advance`, `UMP/…`) — external

A Finance document (P107), **header-only**. Menu **Finance › Uang Muka ›
Uang Muka Perizinan** (`/finance/advance/permit`).

**Z10. Header** — the Pengajuan (weak id + number: another module), chosen
once and locked; customer, address, price mode, Kena PPN and Jenis PPh
follow from it, read-only, with its own PPN snapshot (P60). Tanggal, Jatuh
Tempo (+7 days), Rekening Pembayaran (a rupiah Bank, printed), **Uraian** —
the one line the customer sees, pre-filled *Uang muka jasa pengurusan
perizinan `<Produk>` · PRZ/… (PO …)*, editable — and Catatan.

**Z11. Value** — % or Nominal of the Pengajuan's **estimate**, in its price
mode, **defaulting to all the room left** (customers usually pay in full);
DPP, DPP Nilai Lain, PPN by `computeAdvance`; the PPh estimate on its DPP.
**The live bills on a Pengajuan never exceed its estimate**, checked under the
Pengajuan's lock. Drawn only from a **Disetujui or Terealisasi** Pengajuan
not yet invoiced.

**Z12. Lifecycle** — Draft → *Terbitkan* → Diterbitkan; *Batalkan* (reason)
from Draft or Diterbitkan, refused once paid. Keeps **`paid_amount`** (P132).
**Posts nothing.** Numbered `UMP/…`, `UMP-NP/…` (QZ10). Permissions
`PERMIT_ADVANCE_VIEW / _CREATE / _EDIT / _ISSUE / _CANCEL`.

## 8. Biaya Perizinan — a Pengeluaran purpose

**Z13.** A new purpose **`permit_cost`** (*Biaya Perizinan*, Out, `BKK/…`) in
the existing Pengeluaran menu, partner = the Pengajuan's **customer**, the
real payee in the bank reference and note (QZ4, answered). It settles **one
Terealisasi Pengajuan's cost** — the realised DPP — as one lump, **partial
payments allowed**, never beyond what is left.

**Z14.** **No tax, no AP item**: Dr **Biaya Perizinan** / Cr Kas & Bank, the
Cash Bank Book Out beside, an overdraw refused (P104). The Pengajuan keeps
**`cost_paid_amount`** (P132), written through the permit module's own
function.

## 9. Invoice Perizinan (`fin_ar_permit_invoice`, `INP/…`) — external

A Finance document, **header-only**. Menu **Finance › Invoice › Invoice
Perizinan** (`/finance/invoice/permit`).

**Z15. Header** — one **Terealisasi** Pengajuan (weak id + number), chosen
once and locked, **at most one live Invoice per Pengajuan**; customer,
billing address, Termin, price mode, Kena PPN, Jenis PPh and the PPN snapshot
follow from it. **Tanggal Invoice** (the journal date, not before the
realisation); **Tanggal Pajak = Tanggal Invoice** (a service's PPN is due
when its completion is billed); **Jatuh Tempo** = it + Termin; Rekening
Pembayaran; **Uraian** — the one line, pre-filled *Jasa pengurusan perizinan
— `<Produk>` · realisasi RLZ/…*, editable; Catatan. No line table.

**Z16. Figures, stored on the header** — the realised amount (in the price
mode), its DPP, DPP Nilai Lain and PPN; the **Uang Muka used**
(`fin_ar_permit_invoice_advance_deduction`: the Pengajuan's open Uang Muka AR
items, **pre-filled oldest first as far as they reach**, editable, a Draft
reserving them); then P113 / P118 unchanged — advance PPN recalculated by
the chain, PPN = full less the advances', refused if the rates differ — and
the PPh on the **net DPP after the advance** (P119). Computed by
`computeInvoice` over one line held in memory, so nothing is reimplemented.
Keeps **`paid_amount`** (P133).

**Z17. Lifecycle** — Draft → *Posting* → Posted (final); *Batalkan* (Draft,
reason). Permissions `PERMIT_INVOICE_VIEW / _CREATE / _EDIT / _POST /
_CANCEL`. Numbered `INP/…`, `INP-NP/…` (QZ10).

**Z18. Posting**, one transaction under the Pengajuan's lock: Dr Piutang Usaha
(face, naming the customer) / Cr **Pendapatan Perizinan** · Cr PPN Keluaran;
per Uang Muka used: Dr **Uang Muka Perizinan** · Dr PPN Keluaran / Cr Piutang;
the **Invoice AR item** born at face with *Dipakai Invoice* / *Uang Muka
Diterapkan* (P117); a **one-line Faktur Normal or Pelunasan** carrying the
Uraian; the Pengajuan → **Selesai** through its module's function. The
confirmation shows the journal by dry run (P103).

## 10. Changes to the shared parts

**Z19. Penerimaan dari Customer** — `SettledDocKind` gains
`fin_ar_permit_advance` (badge *UM Perizinan*) and `fin_ar_permit_invoice`
(*Inv. Perizinan*); *Pilih Tagihan* lists them with the rest. A permit
advance line posts like a goods advance line but **Cr Uang Muka Perizinan**,
raises its Uang Muka AR item (one per bill, P133) and makes its Faktur Uang
Muka and Bukti Potong; a permit invoice line posts **Cr Piutang Usaha**
against its Invoice AR item. Each writes `paid_amount` through the permit
module. Nothing else in the menu changes.

**Z20. AR item scope** (the user, 08/10/2026) — `fin_ar_item.customer_order_id` is replaced by the weak
scope pair `scope_doc_type_id / scope_doc_id` (Customer Order or Pengajuan),
migrated in place; an Invoice uses only its own scope's Uang Muka (P73).
`tax_faktur.customer_order_id` the same. The goods documents keep their own
columns.

**Z21. Faktur pajak** — two builders, one line each from the Uraian: the
Faktur Uang Muka (at the receipt, as today) and the Faktur Normal / Pelunasan
(at the Invoice), naming the Faktur Uang Muka it deducts.

**Z22. Accounts** — Account Mapping gains a **Perizinan** card: *Uang Muka
Perizinan* (liability, requires Customer), *Pendapatan Perizinan* (revenue),
*Biaya Perizinan* (cost); the starter chart (P130) adds the three.

**Z23. Reports and checks** — *Uang Muka Customer* groups by the scope
(Customer Order or Pengajuan) and checks each against its own account; the
Perizinan documents appear in Buku Piutang and Umur Piutang with their type.
`db:reconcile` gains: permit Uang Muka items = Uang Muka Perizinan per
customer; `paid_amount` of both documents = their posted lines;
`cost_paid_amount` = posted Biaya lines ≤ the realised DPP; one posted Invoice
per Pengajuan at most.

## 11. Out of scope

Pengembalian Uang Muka (the leftover when the realisation is below the
advance, QZ9), a fee or margin over cost, paying labs through Purchasing, a
Nota Retur on Perizinan, Coretax kode transaksi and NITKU.

## 12. Questions

| # | Question | State |
| --- | --- | --- |
| QZ1 | Jenis Perizinan: own master or Item? | **Answered 07/10/2026: own master** |
| QZ2 | *Harga Estimasi Standar* on the master, as a starting value only? | **Answered 08/10/2026: yes** — stored on the Jenis Perizinan as the default, changed freely on each Pengajuan line |
| QZ3 | Realisation = cost paid = price billed? | **Answered 07/10/2026: billed at cost.** Revenue vs reimbursement (*dana talangan*) on the tax-consultant list |
| QZ4 | Biaya Perizinan payee | **Answered 07/10/2026: a lump Pengeluaran purpose** |
| QZ5 | Advance and Invoice: shared or separate tables; an Item on the line? | **Answered 08/10/2026: separate, header-only, one description line, no Item** |
| QZ6 | Approval Ajukan → Setujui like the Customer Order, or direct Setujui? | **Answered 08/10/2026: as the Customer Order** |
| QZ7 | PPh: one Jenis PPh picked per Pengajuan, or always PPh 23? | **Answered 08/10/2026: picked per Pengajuan** |
| QZ8 | Kena PPN a decision on the Pengajuan, or always PPN? | **Answered 08/10/2026: a decision** |
| QZ9 | Pengembalian Uang Muka now or later? | **Answered 08/10/2026: later**; the leftover stays open on its AR item |
| QZ10 | Numbering: own `UMP` / `INP` (the simulation's), or shared `ARA` / `INV`? | **Answered 08/10/2026: own series, `UMP` and `INP`** |

## 13. Build order (each step committed and verified on its own)

1. **Masters** — Jenis Perizinan; Account Mapping *Perizinan* card; starter
   accounts.
2. **Pengajuan Perizinan** — form, *Pilih Perizinan*, Ajukan / Setujui /
   Tolak / Batalkan.
3. **Realisasi** — realisation mode, `RLZ/…`, Ubah Realisasi.
4. **AR scope** — migration of `fin_ar_item` / `tax_faktur` to the scope pair;
   the goods flow re-tested unchanged.
5. **Uang Muka Perizinan** — the document, and Penerimaan learning it
   (posting, AR item, Faktur Uang Muka, Bukti Potong).
6. **Biaya Perizinan** — the `permit_cost` purpose, `cost_paid_amount`.
7. **Invoice Perizinan** — the document, posting, the one-line faktur,
   Selesai, and Penerimaan learning it.
8. **Reports, reconcile, showcase** — Z23 and the simulation's four
   scenarios.
