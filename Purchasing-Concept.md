# Purchasing Process — Purchase Request to Hutang

> **Status: AGREED 06/10/2026, not built.** The plan for the purchasing
> module, written before any code and confirmed with the user (§11). Every
> rule is numbered **B1…**; `Claude-ERP.md` P121 adopts this document, and
> each build step records its own P-decision when it lands, as
> `Sales-Process-Concept.md` did for sales (U1…).
>
> Purchasing **mirrors sales**: the same document shapes, lifecycles, tax
> arithmetic (`tax_concept.md`, `sales-tax.ts`), open items and posting
> discipline, with the roles reversed. Where it does not mirror, it says why.
> **The tax module is out of scope** (no Faktur Pajak Masukan or Bukti Potong
> records), exactly as sales was built before P100. The tax *figures* and the
> tax *accounts* are in scope.

---

## 1. The process in one picture

```text
Purchase Request (Barang | Jasa)          posts nothing
   │  many PR lines ──► one PO line (consolidated, B9)
   ▼
Purchase Order  (one supplier, prices, PPN, PPh; approved)   posts nothing
   │                         │
   │                         ├─► Uang Muka Pembelian (bill)      posts nothing
   │                         │        └─► Pengeluaran Kas & Bank ── Dr Uang Muka · Dr PPN Masukan / Cr Bank · Cr Hutang PPh
   │                         │                                     + AP item "Uang Muka"
   ▼
Receipt Note (from 1 PO; many per PO)
   │  Kelola Stok  → stock books (lots made here)   Dr Persediaan / Cr Barang Diterima Belum Ditagih
   │  otherwise    → expense                        Dr Beban      / Cr Barang Diterima Belum Ditagih
   ▼
Invoice Pembelian (whole lines of 1 PO's posted Receipt Notes; deducts that PO's Uang Muka)
   │      Dr Barang Diterima Belum Ditagih · Dr PPN Masukan · Dr/Cr Selisih Tagihan Supplier / Cr Hutang Usaha · Cr Hutang PPh
   │      + AP item "Invoice", the Uang Muka applied inside the posting (P117 mirrored)
   ▼
Pengeluaran Kas & Bank (Pembayaran ke Supplier)        Dr Hutang Usaha / Cr Bank
```

| Document | Module / menu | Table | Number | Posts |
| --- | --- | --- | --- | --- |
| Purchase Request | Pembelian › Purchase Request Barang / Jasa | `pur_request(_line)` | `PR/…` | nothing |
| Purchase Order | Pembelian › Purchase Order | `pur_order(_line, _line_request)` | `PO/…`, `PO-NP/…` | nothing |
| Receipt Note | Logistik › Receipt Note (standalone, P106) | `log_receipt_note(_line, _lot)` | `RN/…`, `RN-NP/…` | stock books + journal |
| Uang Muka Pembelian | Finance › Uang Muka | `fin_ap_advance` | `APA/…`, `APA-NP/…` | nothing (bill) |
| Pengeluaran Kas & Bank | Finance › Kas & Bank › Pengeluaran | `fin_cash_bank_tx` (direction Out) | `BKK/…` (P70) | Cash Bank Book + journal + AP items |
| Invoice Pembelian | Finance › Invoice | `fin_ap_invoice(_line, _advance_deduction)` | `PI/…`, `PI-NP/…` | journal + AP item |
| AP items / Buku Hutang | a book (kernel only) | `fin_ap_item`, `fin_ap_ledger` | `API/…`, `BH/…` | never a journal |

New table prefix **`pur_`** for the purchasing module (orders only, as `sal_`
holds only orders since P107).

---

## 2. Masters touched

- **B1 — Supplier is switched on.** The seeded Supplier category becomes
  Active (P41 kept it Inactive for this moment). A Partner may be Customer or
  Supplier; the tax identity (Tipe, NPWP / NIK, PKP) is shared (P42).
- **B2 — A supplier carries purchase defaults** in a *Pembelian* tab, mirroring
  P51: Termin Pembayaran Default and Mode Harga Default. They only pre-fill a
  new PO.
- **B3 — Items offered** on purchasing documents are those marked **Dapat
  Dibeli**, of the document's type (Barang or Jasa).
- **B4 — A Jenis PPh belongs to one side** (the user, confirmed against
  practice: Odoo's tax *usage* Sales / Purchase, SAP's withholding codes kept
  apart for customers and vendors, Accurate's sales and purchase taxes). Its
  **Penggunaan** is *Penjualan* or *Pembelian*, chosen at creation; its one
  account is *PPh Dibayar Dimuka* (an asset) for a sales one and *Hutang PPh*
  (a liability) for a purchase one. A document offers only its side's Jenis
  PPh. The seed adds **PPH23-BELI** (2 %) for purchases. *Built in step 1
  (P122).*
- **B5 — Account Mapping gains a *Pembelian* card**: *Barang Diterima Belum
  Ditagih* (GR/IR clearing), *Hutang Usaha*, *Uang Muka Pembelian*, *PPN
  Masukan* and *Selisih Tagihan Supplier* (B29).
- **B5a — Accounts per Kategori Item** (closes C25; the user's choice): each
  Kategori Item names its **Persediaan**, **HPP** and **Beban** accounts, in
  its own menu under Accounting › Pengaturan. A Receipt Note line takes the
  Persediaan (Kelola Stok) or Beban (otherwise) account of its item's
  category. The Delivery Note takes HPP and Persediaan from the category too;
  **a category with no account set falls back to Account Mapping's
  *Pengiriman Barang* card** (P94), so nothing posted today changes. Posting
  is refused when neither gives an account.

---

## 3. Purchase Request  (`pur_request`, `PR/…`)

- **B6 — Two menus, one table.** *Purchase Request Barang* and *Purchase
  Request Jasa* are one table with a header `item_type` (Barang / Jasa), so
  each request holds one kind only, as SO Barang did (P49).
- **B7 — Content.** Header: Tanggal, Peminta (free text, as the salesperson
  is, P52), Gudang Tujuan (Barang only, optional — a hint for the receipt),
  Catatan. Lines: item (Dapat Dibeli, of the type), **quantity in the item's
  base unit**, **Tanggal Dibutuhkan per line** (the header offers a default),
  note. **No supplier, no price, no tax** — those belong to the PO.
- **B8 — Lifecycle, without approval** (the user's choice: only the PO is
  approved): Draft → *Ajukan* → **Open** → Ditutup. *Batalkan* (Draft) is
  final, with a reason. *Tutup* by hand with a reason; **closes itself once
  every line is fully ordered**. Posts nothing. `ordered_qty` on each line is
  written by the PO module through a PR function (as `delivered_qty`, P94).
  Permissions `PURCHASE_REQUEST_VIEW / _CREATE / _EDIT / _SUBMIT / _CANCEL / _CLOSE`.

*Built 06/10/2026 (P123).*

---

## 4. Purchase Order  (`pur_order`, `PO/…`)

### 4.1 Header and tax

- **B10 — One supplier, one type.** Header: Supplier (an active Supplier),
  Tanggal, Termin, Tanggal Kirim Diharapkan, Gudang Tujuan (Barang), No.
  Penawaran Supplier (reference), Catatan. **Kena PPN** then **Include /
  Exclude** are explicit decisions (P52, P63); a supplier that is **not PKP**
  cannot be Kena PPN (it may not issue a faktur pajak). The PPN rate and the
  11/12 factor are **snapshotted** (P60). `-NP` series when not Kena PPN
  (P109).
- **B11 — The same tax arithmetic** as the Customer Order, from the same
  client-safe module: per-line DPP, DPP Nilai Lain by 11/12, PPN by the chain,
  half up to whole rupiah, inclusive split (P59, P60, P115); discount % or
  Nominal per line; Jenis PPh per line; prices `Decimal(18,6)` (P111).
- **B12 — PPh 23 at 100 % higher without an NPWP** (UU PPh Pasal 23 ayat 1a): a
  supplier with no tax identity is withheld at twice the Jenis PPh rate. A NIK
  counts as an NPWP for an Orang Pribadi (PMK 112/2022). Shown on the PO's
  estimate and applied wherever PPh is computed.

### 4.2 Lines, units and the link to requests

- **B13 — A PO is made only from Open requests of its type.** *Tambah dari PR*
  opens the open PR lines (any requester, any PR) with Tanggal Dibutuhkan,
  Qty PR, Sudah di-PO and Sisa (as P81).
- **B14 — The PO line may use another unit** of the item (the Item's
  *Konversi Satuan*, P46): quantity and price are in that unit, `uom_factor`
  converts to base. Everything compared with a PR is compared in base units.
- **B9 — Consolidation** (agreed): **PR lines of the same
  item and the same unit become one PO line**, and a link table
  `pur_order_line_request (order_line_id, request_line_id, base_qty)` records
  how much of each PR line that PO line covers. Why:
  - the supplier quotes, delivers and invoices per item — one line is what
    their quotation, delivery note and faktur pajak show, so a 3-way match
    (PO ↔ Receipt Note ↔ Invoice) compares like with like;
  - one line means one price and one PPN chain, so rounding is done once per
    item, as the faktur does it (P60);
  - nothing is lost: the link table keeps every PR line's share, so a request
    still shows what was ordered for it. This is how Dynamics 365
    (*consolidated requisitions*), Odoo (purchase lines merged per product)
    and SAP (collective PO from a source list) all do it; SAP's 1 PR item =
    1 PO item is the stricter variant, at the cost of duplicate lines the
    supplier never sees.
  - The user may still split one item over two PO lines (e.g. two units or
    two prices) — consolidation is the default, not a lock.
- **B15 — Partial and exceeding.** The PO line's base quantity is shared over
  its linked PR lines **earliest Tanggal Dibutuhkan first**: less than they
  ask leaves the rest open on the PRs (partial); **more is allowed** and the
  excess is shown as *melebihi PR* and belongs to no request. The share is
  recomputed at each save; at *Ajukan* it is written to the PR lines under
  the PR's lock.
- **B16 — Lifecycle with approval**, mirroring the Customer Order: Draft →
  *Ajukan* → Diajukan → *Setujui* → **Open** → Ditutup; *Tolak* / *Batalkan*
  final.
  **Closes itself once every line is fully received** (as P97 for delivery);
  billing comes after and a closed PO is still billed. **Closing by hand
  releases what was never received** back to its PR lines (as U14).
  Permissions `PURCHASE_ORDER_*` as the Customer Order's.

*Built 06/10/2026 (P124); closing on full receipt comes with the Receipt Note.*

---

## 5. Receipt Note  (`log_receipt_note`, Logistik)

- **B17 — The standalone document P106 announced**: purpose
  **`purchase_receipt`**, source one **Open PO** by the weak pair, chosen once
  and locked. One PO may have many Receipt Notes; a Receipt Note has exactly
  one PO.
- **B18 — Header:** Tanggal Terima, **Gudang** (Barang; starts on the PO's
  Gudang Tujuan, changeable), No. Surat Jalan Supplier, Catatan. Lines picked
  from the PO's lines (*Qty PO*, *Sudah Diterima*, *Sisa*), quantity in the PO
  line's unit, base quantity derived. **No over-receipt** beyond the PO line
  (over-supply is handled by changing the PO, B15).
- **B19 — Kelola Stok decides what a line does** (P120):
  - **Barang with Kelola Stok** → stock books. The line is **split into one or
    more lots**, each with its lot number, expiry (required for Memiliki
    Kadaluarsa) and quantity; together exactly the line at posting. **The lot
    is created here** (`receiveStock`, `log_stock_tracking` with the supplier as
    `source_partner_id`). Lot number typed, or generated when left empty.
  - **Barang without Kelola Stok, and Jasa** → an expense; no stock row.
    **Jasa goes through the Receipt Note too** (agreed), as a service
    acceptance (SAP's service entry sheet): one 3-way flow for both types; a
    Jasa receipt has no Gudang.
- **B20 — Value at receipt = the PO line's DPP for the quantity received**, the
  cumulative split of P112 (so the receipts of one line add up to its DPP
  exactly), excluding PPN — PPN Masukan is creditable and never enters stock
  or expense. A lot's value is the cumulative split of its line's value.
- **B21 — Posting** (one transaction): stock lines → `receiveStock` per lot and
  **Dr Persediaan / Cr Barang Diterima Belum Ditagih**; other lines → **Dr
  Beban / Cr Barang Diterima Belum Ditagih**. Writes `received_qty` to the PO
  line (which may close the PO). Draft → Posted (final); *Batalkan* a Draft.
  The confirmation shows the journal by dry run (P103).
- **B22 — Why GR/IR** (*Barang Diterima Belum Ditagih*): it is the mainstream
  shape (SAP, Dynamics, Odoo anglo-saxon, NetSuite). The goods are in the
  books the day they arrive at the price agreed; the invoice later clears the
  account. Its balance is exactly *received, not yet invoiced*.

*Built 06/10/2026 (P125).*

---

## 6. Uang Muka Pembelian  (`fin_ap_advance`, `APA/…`)

- **B23 — Mirrors the AR advance** (P54–P58, P64, P58 already says so): drawn
  from one **Open PO**; value typed as % or Nominal in the PO's price mode;
  PPN follows; PPh estimate from the PO lines' Jenis PPh (with B12). Draft →
  *Terbitkan* (here: *Catat*) → Diterbitkan; *Batalkan* with a reason, refused
  once paid. **Posts nothing.** The PO's value caps its live bills. It records
  the supplier's proforma / request for a down payment.

*Built 06/10/2026 (P126).*

---

## 7. Pengeluaran Kas & Bank — *Pembayaran ke Supplier*

- **B24 — The Out half of `fin_cash_bank_tx`** (P66): menu *Pengeluaran*,
  `BKK/…`, permissions `CASH_PAYMENT_*`. First purpose **`supplier_payment`**,
  which settles **AP advance bills and Invoices Pembelian together** (P83
  mirrored). *Pilih Tagihan* lists the supplier's open bills and invoices.
- **B25 — A line takes the cash paid** (P76 mirrored). Biaya Bank is the
  company's (Dr Beban Bank). **Saldo Cash & Bank tidak mencukupi** refuses an
  overdraw (P104). No overpayment; rupiah only.
- **B26 — Posting an advance-bill line**: Dr Uang Muka Pembelian (DPP, naming
  the supplier) · Dr PPN Masukan / Cr Kas & Bank · Cr Hutang PPh (the PPh the
  company withholds on the advance's DPP); creates an **AP item *Uang Muka*** at
  the DPP (P73 / P116 mirrored).
- **B27 — Posting an Invoice line**: Dr Hutang Usaha / Cr Kas & Bank; records
  *Pembayaran* on the Invoice AP item. Its PPh was booked at the invoice
  (B31), so the payment is cash against the item's balance only.

---

## 8. Invoice Pembelian  (`fin_ap_invoice`, `PI/…`)

- **B28 — Mirrors the Invoice Penjualan** (P97, P111–P113, P117): one PO; its
  lines are **whole lines of that PO's posted Receipt Notes**, each invoiced
  by at most one live invoice; priced from the PO line, partial billing split
  cumulatively (P112).
- **B29 — The supplier's document:** No. Invoice Supplier (required, unique
  per supplier — a duplicate-invoice guard), Tanggal Invoice Supplier, No.
  Faktur Pajak Supplier (optional reference; the tax module will make it a
  record later). Tanggal (the journal date, not before the latest receipt),
  Jatuh Tempo = Tanggal Invoice Supplier + Termin.
- **B29a — The price is always the PO's** (the user): an invoice line is a
  posted Receipt Note line at its PO price; **no invoice without a receipt
  and no price adjustment** on the invoice, and none anywhere on our own
  documents.
- **B29b — Total Tagihan Supplier** (the user): at the foot of the invoice the
  user types the supplier's invoice total (DPP + PPN, before our PPh), compared
  with ours. **The difference is posted to *Selisih Tagihan Supplier* only
  within a tolerance** — *Toleransi Selisih Tagihan Supplier*, a System Default
  in rupiah (default **Rp 100**, changeable in Pengaturan); **beyond it the
  invoice refuses to post**, naming both totals, because a larger gap is a
  price or quantity dispute to settle with the supplier or on the PO, not a
  cost. Within it, Hutang Usaha is the supplier's total less our PPh. Left
  empty, the total is not compared. **PPN Masukan and the PPh stay our own
  figures**: the creditable PPN is the faktur's (UU PPN Pasal 9) and cannot be
  corrected by us, so the difference account never carries PPN; and keeping
  the gap small keeps the PPh 23 base (PMK 141/2015) what was charged.
- **B30 — Advance deduction**, the same mechanism as sales and **compliant**:
  the supplier's faktur pelunasan carries the full DPP less the advances' DPP
  (PER-11/PJ/2025, as for sales, P113): *Pilih Uang Muka* lists this PO's open
  AP Uang Muka items; full PPN per line less the advance's PPN recalculated by
  the chain (P113, P118); refused if the PPN rate or factor differs from the
  advance's.
- **B31 — Posting** (P117 mirrored): **Dr Barang Diterima Belum Ditagih** (the
  receipt value of its lines) · **Dr PPN Masukan** (full PPN) · **Dr / Cr
  Selisih Tagihan Supplier** (B29b) / **Cr Hutang Usaha** (face) · **Cr Hutang
  PPh** (on the DPP after the advance, §4.4) — **the company's PPh is booked
  here, at the invoice** (agreed; `tax_concept.md` §4.3b); per
  advance used: **Dr Hutang Usaha** (DPP + its PPN) / **Cr Uang Muka
  Pembelian** (DPP) · **Cr PPN Masukan** (its PPN). Creates the **Invoice AP
  item** at its face and applies each Uang Muka inside the posting
  (*Dipakai Invoice* / *Uang Muka Diterapkan*). GR/IR clears exactly because
  the invoice price is the PO price (B29a).

---

## 9. AP items and Buku Hutang  (`fin_ap_item`, `fin_ap_ledger`)

- **B32 — The AR book mirrored** (P71–P74, P116, P117): a book, kernel only;
  types *Uang Muka* and *Invoice*; `original_amount` + `current_balance`;
  append-only ledger with `ledger_no` per posting (`BH/…`, P110); events
  *Dibuat, Pembayaran, Dipakai Invoice, Uang Muka Diterapkan*; never below
  zero. Reconciles with Hutang Usaha and Uang Muka Pembelian in the GL per
  supplier.
- **B33 — Reports under Finance › Laporan:** **Buku Hutang**, **Umur Hutang**,
  **Uang Muka Supplier** — the three AR reports mirrored (P75, P77).

---

## 10. Tax law — what the plan relies on

| Point | Rule | Where it lands |
| --- | --- | --- |
| PPN rate and base | 12 % × DPP Nilai Lain 11/12 for non-luxury goods and services (PMK 131/2024) | B11, the shared module |
| Input VAT creditable | Only from a **PKP** supplier's valid faktur pajak (UU PPN Pasal 9) | B10: non-PKP supplier → no PPN |
| PPN on an advance | Due when the advance is paid before delivery; the supplier issues a faktur uang muka (UU PPN Pasal 11, 13) | B26: PPN Masukan at the advance payment |
| Settlement | Faktur pelunasan = full DPP less advances' DPP | B30, P113 |
| PPh 23 base and rate | 2 % of the DPP excluding PPN on services (PMK 141/2015); **100 % higher without NPWP** (Pasal 23 ayat 1a) | B11, B12 |
| PPh 23 on advances | Withheld on the advance too; the invoice withholds only on what remains | B26, B31 |
| PPh 23 timing | Due at the end of the month of **payment, provision for payment (accrual) or due date — whichever comes first**; deposit by the 15th, report by the 20th of the next month | B31: at the invoice |
| PPh 22 on purchases | Only when the company is a designated collector or the supplier collects (fuel, import) — **out of scope** | — |
| PPh 4(2) final (rent, construction) | Out of scope (P60) | — |
| Faktur / Bukti Potong records | Out of scope (the tax module) | later, like P100 |

*To verify with a tax consultant:* the accrual timing of PPh 23, and PPN
Masukan on an advance whose faktur uang muka has not arrived yet.

---

## 11. Decided with the user (06/10/2026)

| Question | Decision |
| --- | --- |
| Merge PR lines of one item into one PO line? | **Yes**, per item + unit, with the link table (B9) |
| When the company's PPh 23 is booked | **At the Invoice Pembelian posting**; an advance's at its payment (B26, B31). The mainstream way: Accurate, Jurnal.id and Odoo's Indonesian localization put PPh 23 on the vendor bill, and SAP / Dynamics implementations in Indonesia set withholding to post at invoice. Sales cannot be mirrored here because there the customer withholds and we learn the figure only when the money arrives; here we withhold and the law makes it due at the earliest of payment, accrual or due date. `tax_concept.md` §4.3 is amended for the withholder (§4.3b, option **B** of the deviation check) and queued for the KB |
| Expense account for non-stock receipts | **Per Kategori Item** (B5a, closes C25) |
| Jasa through the Receipt Note | **Yes**, as service acceptance (B19) |
| Invoice price | **Always the PO price × the received quantity**; no invoice without a receipt; no adjustment (B29a) |
| Supplier's total | **Typed at the foot and compared; the difference posted to *Selisih Tagihan Supplier* within a tolerance** (System Default, default Rp 100), refused beyond it (B29b), PPN and PPh staying ours |
| PPN rounding against the supplier's faktur | **No correction** on our documents; the tax module deals with the faktur later |
| Approval | **PO only** (B16); the PR goes Draft → Open (B8) |

## 12. Build order (each step committed and verified on its own)

1. Masters: Supplier on, supplier defaults, Jenis PPh payable account, Account
   Mapping *Pembelian*, accounts per Kategori Item (B5a), `pur_` module and
   the *Pembelian* menu.
2. Purchase Request (Barang / Jasa).
3. Purchase Order with the PR link table and consolidation.
4. Receipt Note — stock in, lots, GR/IR, PO received quantity.
5. Uang Muka Pembelian.
6. AP items + Pengeluaran Kas & Bank (*Pembayaran ke Supplier*), advance bills.
7. Invoice Pembelian with advance deduction; Pengeluaran paying invoices.
8. Buku Hutang, Umur Hutang, Uang Muka Supplier; `db:reconcile` checks for
   GR/IR, Hutang and Uang Muka Pembelian vs the AP items.
