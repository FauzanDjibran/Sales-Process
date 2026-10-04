# ERP — Implementation Plan

> Companion to `Claude-ERP.md`. Sales first. Three phases, in the order the
> user set (P2): carry over SIBA → master data → sales process. Decision ids
> (`P…`) refer to `Claude-ERP.md` §12; open items (`C…`) to §18 — an item that
> depends on an open one is not started until it is decided.

---

## Phase 1 — Carry over from SIBA

**Status: done 29/09/2026.** Build, lint and tests pass on PostgreSQL 18, and
the walk-through below was checked in a browser and in Postgres. Remaining
rough edges are listed in `Claude-ERP.md` §17.

**Scope (P23):** the Accounting module minus the Budget mapping, `m_partner`,
`ref_currency`, `m_cash_bank`, users & roles, System Default and Profil Saya.
Anything else only once confirmed (C17–C21, `Claude-ERP.md` §18.2).

**Goal:** a running application with sign-in, users and roles, Profil Saya,
System Default, Partner, Currency, Cash & Bank, the chart of accounts, fiscal
calendar, journal and manual journal, and the accounting reports — behaving as
in SIBA except where a decision says otherwise, with the carried tests passing.

**Method:** copy from SIBA `main` @ `3b33094` into this repository's own
history (a standalone project, P22), unchanged first; then apply each decision
as its own commit, so every deviation from SIBA is one reviewable change.

| Step | Work | Decision |
| --- | --- | --- |
| 1.1 | Rename branch `master` → `main`. Scaffold: `package.json` (name `erp`, ports 3100 / 3110, no Neon / Vercel / standalone scripts), `tsconfig`, ESLint, `next.config.ts`, `prisma7.config.ts`, `.gitignore`, `.env.example` (DB `erp`), `AGENTS.md` | — |
| 1.2 | Foundation: shell, `components/ui`, `globals.css`, icons, `format.ts`, sign-in / sessions / `proxy.ts`, audit log and record history, entity registry and its pages, error / forbidden pages, health and startup checks; `lib/siba/` becomes `lib/erp/` | C17 |
| 1.3 | Users, roles, permissions, RBAC, user & role admin; Profil Saya | P23 |
| 1.4 | System Default: catalogue reduced to default currency, FX difference account, Laba/Rugi Tahun Berjalan and Tahun Sebelumnya | P23, P9, P19 |
| 1.5 | Currency, `fx.ts`, `currency.ts` | P13, P23 |
| 1.6 | Partner (+ Partner Category if confirmed) | P23, C18 |
| 1.7 | Cash & Bank master (+ Cash Bank Book, layers and reports if confirmed) | P23, C19 |
| 1.8 | Accounting: account types / categories / subcategories and seeded skeleton, chart of accounts tree, fiscal year / periods / posting lock / backdating, journal engine and register, manual journal, General Ledger, Trial Balance, Laba Rugi, Neraca, Fiscal Year Closing, Opening Balance (empty at start). No Budget mapping, no subject books | P14, P23, P25, P27 |
| 1.9 | **Remove the company dimension**: every `company_id`, Company access, Company filter; account numbers unique in the one chart | P9 |
| 1.10 | **Control Account becomes a user choice** on the account form; the manual journal still refuses it | P16 |
| 1.11 | `document-number` → `PREFIX/YYYY/MM/NNNN` for documents and journals | P15 |
| 1.12 | Dashboard placeholder | C20 |
| 1.13 | Prisma schema = what was carried; one baseline migration; `DBML/erp.dbml.md`; `seed.ts` = system data only | all above |
| 1.14 | Tests for what was carried, adjusted for one company and a user-set control account; design-system and module-boundary suites; `run-erp` skill; `README.md` | C21 |

**Done when:** `npm run build`, `npm run lint` and `npm test` pass; the app
serves on 3110; the admin signs in, creates a fiscal year, accounts (one
marked Control Account), a Partner, a Cash & Bank with opening balance, and a
manual journal; the General Ledger and Trial Balance show them — checked in a
browser and in Postgres.

---
## Phase 2 — Master data (as needed)

Registry entities with list / detail / create / edit / deactivate (P11), in
the order the sales steps need them. **The initial masters are `m_item` and
`m_partner`; the rest are reference masters** (currency, unit of measure, …)
(P26). **What each holds is agreed with the user when it is started** (C6). Each: Prisma model + migration + DBML,
registry config, permissions, nav entry, audit, tests for its rules, and a
`seed-showcase.ts` entry from the simulation's demo data.

Candidates, from the simulation:

| Master | From the simulation | Notes |
| --- | --- | --- |
| Customer (`m_partner`) | `CUSTOMERS` | **Done 29/09/2026** (P38–P42): addresses on the region reference, contact persons, Pajak tab with tax identity and PPh 23 / PPh 22 / WAPU. Deferred: NITKU (C23); credit limit, default mode harga, credit block, SO defaults (C24); showcase data |
| Salesperson | `SALES` | **Not a master** (P43): typed on the document |
| Termin Pembayaran | `TERMS` | **Done 29/09/2026** (P43) |
| Gudang | `WAREHOUSES` | **Done 29/09/2026** (P43): Label + Nama, delivery origin only while stock is ignored (P5) |
| Price group | `PRICE_GROUPS` | **Not built** (P43): prices are typed on the document |
| Item (`m_item`) | `GOODS` | **Done 29/09/2026** (P46–P48): Tipe Barang / Jasa, seeded Kategori Item, Satuan Dasar + Konversi Satuan, four flags. No price, no tax, no NIE, no HPP standar on the Item |
| Jenis Perizinan | `PERMITS` | Not an item. Set aside for now (P43) |
| Jenis PPh | `WHT_TYPES` | **Done 29/09/2026** (P44): user-managed, four common types seeded |
| Kode Pajak | `TAX_CODES` | **No table** (P45): PPN yes / no is an enum on the Item and transactions |
| Satuan | `GOODS.uoms` | **Done 29/09/2026** (P43): unit only; conversions per Item |
| Kategori Item | `GOODS.cat` | **Done 29/09/2026** (P47): seeded system data per Tipe, no menu; account mapping later (C25) |
| Company Setting | `COMPANY` | Its own menu (P28) |

---

## Phase 3 — Sales process (as the user instructs)

**Sales Order — done 29/09/2026** (P49–P53): SO Barang, Draft → Konfirmasi →
Dikonfirmasi / Batalkan (with reason), Salin; header Kena PPN and mode harga;
per-line unit, qty, price, % / nominal discount and Jenis PPh; figures from
`lib/erp/sales-tax.ts`; posts nothing. Selesai / Tutup Pesanan follow with the
Surat Jalan.

**Uang Muka Penjualan — done 29/09/2026** (P54–P58): the AR advance bill under
Finance › Uang Muka, `ARA/…`, drawn from a confirmed SO; % / Nominal value in
the SO's price mode; PPN and the PPh estimate from `sales-tax.ts`; Draft →
Terbitkan → Diterbitkan / Batalkan; posts nothing; the SO's value caps its live
bills and an SO with a live bill is not cancelled. Print, payment state and open
items follow with Company Setting and Pembayaran.

**Tax arithmetic reworked — 29/09/2026** (P59, P60, `tax_concept.md`): half-up
whole rupiah; PPN per line by the chain round(tarif × round(DPP × 11/12)), the
document summing its lines; an inclusive price's difference absorbed in the DPP
(at most Rp1 under the typed price); the PPN rate and DPP Nilai Lain factor as
System Defaults, snapshotted by each Sales Order and advance bill and frozen at
Konfirmasi / Terbitkan. PPH42-SEWA no longer seeded.

**Settings split — 29/09/2026** (P61): System Default (Base Currency shown,
Pajak card) and Account Mapping (Accounting › Pengaturan: selisih kurs and
laba/rugi equity accounts, more as their documents are built). Currency
Default and the PPh 22 Jenis PPh pointer retired.

**Seeding — 30/09/2026**: `db:reset` now runs the system seed (Prisma 7 does
not), and `scripts/seed-showcase.ts` (`db:seed-showcase`, `db:fresh`) fills a
dev database with the simulation's customers, goods, references, accounts,
account mapping, banks and an open fiscal year.

**Sales Order lifecycle and form rework — 30/09/2026** (P63–P65): Draft →
Ajukan → Diajukan → Setujui → Open → Tutup Pesanan → Ditutup, with Batalkan
(Draft only) and Tolak (from Diajukan) final; new permissions
`SALES_ORDER_APPROVE` and `SALES_ORDER_CLOSE`, `SALES_ORDER_CONFIRM` renamed
`SALES_ORDER_SUBMIT`. Gudang and Kirim Diminta leave the SO (the Surat Jalan
and a future delivery schedule carry them); the item is picked per line from a
dropdown; Mode Harga is asked only when Kena PPN; the PPh estimate is its own
box. The advance bill reads the SO's header in the SO's layout and shows the
order as one line (Uraian, total, DPP) with the value typed below; it needs an
Open SO. Every dropdown answers ↓ / ↑ / Enter, and every percent field shows
`%` and takes 0–100 only. Automatic closing waits for the Surat Jalan.

**Penerimaan Kas & Bank — done 30/09/2026** (P66–P70): Finance › Kas & Bank ›
Penerimaan, one table (`fin_cash_bank_tx`) for both directions, `BKM/…`.
Purposes are a catalogue in code; the first is Penerimaan Uang Muka
Penjualan. Tujuan → Customer, then *Pilih Tagihan* opens the customer's open
bills in a dialog; one receipt settles several, fully or partly. Each line
takes the cash actually received for its bill and the PPh follows from it
(P76, reworked 30/09/2026 from the first build's typed Dilunasi and balance
check); the header's money follows from the lines, the bank charge absorbed
into Beban Bank. Posting writes the journal and the Cash
Bank Book in one transaction with the bills locked; each line keeps the DPP /
PPN / PPh figures the Faktur Pajak Uang Muka and Bukti Potong will be made
from. Advance bills show Belum Dibayar / Sebagian / Lunas and a paid one
refuses Batalkan. Next in this area, as instructed: further purposes
(Pelunasan Faktur, Pengembalian Uang Muka, lain-lain), Pengeluaran, the Pajak
records, then the open items (C22).

**Payment menu roadmap — set 02/10/2026** (P83–P86), after a review against
SAP, Dynamics 365, NetSuite, Odoo, Accurate and Jurnal. One engine, one table,
BKM / BKK stay. In order:

1. **Complete the base:** the Pengeluaran menu; Penerimaan / Pengeluaran
   Lain-lain (account lines, partner optional — `partner_id` becomes
   nullable and lines gain an account kind); Penerimaan Belum Teridentifikasi
   to a suspense account (P85); print Bukti Kas Masuk / Keluar; a
   proof-of-transfer attachment.
2. **With the Faktur Penjualan:** Penerimaan dari Customer settling advance
   bills and invoices together (P83); Pengembalian Uang Muka; the Faktur Pajak
   Uang Muka and Bukti Potong records; closing a bill or AR item with a
   write-off by its owner (P84); clearing the suspense (C31).
3. **Bank:** Transfer (C14), Rekonsiliasi Bank with statement import, Giro
   Mundur.
4. **With purchasing:** supplier payments, the PPh the company withholds
   (Hutang PPh, its own bukti potong), Setoran Pajak, a payment run with the
   bank's bulk file, kasbon karyawan.
5. **Currency and cash:** foreign-currency payments with realised selisih
   kurs; a cash-position forecast.

Set aside: reversal of a posted payment (C29, needs the user's go-ahead),
approval of Pengeluaran (C30, at the very end), menu layout and shortcuts
(C32, at the end).

**AR items and Buku Piutang — done 30/09/2026** (P71–P75): the open-item
concept applied to AR — `fin_ar_item` (Uang Muka and Invoice, balance held on
the item) and `fin_ar_ledger` (Buku Piutang, append-only), no allocation step.
A posted receipt creates one Uang Muka item per bill at its DPP part; existing
receipts were backfilled. Reports: Buku Piutang (Invoice items, with a
*Sertakan Uang Muka* switch, P77), Umur Piutang and Uang Muka Customer
(checked against the GL). Invoice items and the Pembayaran / Dipakai
Invoice events arrive with the Faktur Penjualan and the Pelunasan Faktur
purpose.

**Customer Order — renamed 01/10/2026** (P78): the Sales Order built above is
now the Customer Order, `CO/…`, the commercial basis of advances and
invoices; tables, permissions, document type and numbers were renamed in
place. The name Sales Order passes to its child document.

**Sales Order — done 01/10/2026** (P79): Sales › Sales Order, `SO/…`, a dated
part of one Open Customer Order released to PPIC — quantity and Tanggal Kirim
only, lines drawn from the Customer Order's lines and never more than them in
total. Draft → Diajukan → Pra-SO → Open → Ditutup; Batalkan and Tolak give
the quantity back. The Customer Order shows its schedule and cannot be
closed while a Sales Order is running. Next, as instructed: the Delivery Order
and Delivery Note (C28); purchasing and production will read Pra-SO / Open.

**Delivery Order — done 03/10/2026** (P93): Sales › Delivery Order, `DO/…`,
the instruction to one warehouse to send goods of one Customer Order to one
address; its lines are picked from that order's Open Sales Orders and never
hold more than a Sales Order line in total. Draft → Diterbitkan → Ditutup,
Batalkan from Draft; no approval; posts nothing. The Sales Order shows what it
has instructed (*Perintah Kirim*) and cannot be closed while a Delivery Order
on it is running. Next: the Delivery Note (C28), which posts HPP / Persediaan
at the placeholder cost (P18).

**Delivery Note — done 03/10/2026** (P94): Sales › Delivery Note, `SJ/…`, from
one issued Delivery Order; Draft → Posting → Posted, Batalkan from Draft.
Posting issues the goods through the stand-in inventory (`lib/erp/inventory.ts`
over the temporary `tmp_item_cost` / `tmp_stock_movement`, kept in Master ›
Sementara › Harga Pokok (Sementara)) and writes Dr HPP / Cr Persediaan from
Account Mapping — no Piutang. Delivered quantity is recorded on the Delivery
Order and Sales Order lines, which close themselves once fully delivered;
closing one by hand releases what never left. **Stock picking — done
04/10/2026** (P95): a line of a Barang with Kelola Stok is picked by lot from
the stand-in lot list (`tmp_stock_lot`, Master › Sementara › Lot (Sementara)),
earliest expiry first; a Draft may be picked in part, Posting needs every such
line in full and issues each lot as its own stock movement.

**Faktur Penjualan — planned 04/10/2026** (`Sales-Process-Concept.md` §9,
U16–U22), in three steps: (1) **the AR item's revised shape — done 04/10/2026**
(P96): `ARI/…` numbers, source = the document an item is about, the receipt
named by the Create entry, tax columns carrying an Uang Muka's Faktur Pajak
Uang Muka; (2) **the Faktur itself — done 04/10/2026** (P97): Sales › Faktur
Penjualan, `INV/…`, whole lines of one Customer Order's posted Delivery Notes,
the order's Uang Muka picked and its DPP typed, posting Dr Piutang · Dr Uang
Muka / Cr Penjualan · Cr PPN and the Invoice AR item, with the Customer Order
closing itself once fully delivered; (3) **Penerimaan dari Customer — done
04/10/2026** (P98): one receipt pays advance bills and Fakturs, a Faktur line
clearing Piutang Usaha and recording Pembayaran on its Invoice item, with the
Faktur showing Belum Dibayar / Sebagian / Lunas.

Built one step at a time, **in the order the user gives**. For each step:

1. Re-read the simulation's step (screens, lifecycle, arithmetic, journal) and
   the parent decisions behind it.
2. List any new SIBA ↔ simulation clash in `Claude-ERP.md` §18 and ask first.
   C3 (purposes and posting accounts) is settled when the Pembayaran menu is built.
3. Schema + migration + DBML; pure calculation module (client-safe) with unit
   tests reproducing the simulation's figures; data module (`server-only`)
   with lifecycle table and enforcement; Server Actions; list / form / detail
   pages; permissions; nav; audit events.
4. Post = one transaction: journal + Cash Bank Book + tax documents, as the
   step requires.
5. Tests for the rules and the posting; exercise the flow in a browser; check
   the rows in Postgres; showcase data for the step.

The simulation's natural sequence, for reference only — the user's
instruction decides:

| # | Step | Posts |
| --- | --- | --- |
| 3.1 | Sales Order Barang (approval, Salin, Tutup Pesanan) | nothing |
| 3.2 | Uang Muka Penjualan | nothing |
| 3.3 | Penerimaan Kas & Bank — Uang Muka (done); Penerimaan / Pengeluaran lain-lain | Cash Bank Book, journal |
| 3.4 | Faktur Pajak Keluaran (uang muka, pelunasan, normal) and Bukti Potong PPh — **done 04/10/2026 (P100)**: made by the receipt's and the Invoice's posting; Catat Upload / Catat Bukti Potong | nothing — tax documents |
| 3.5 | Delivery Order (done, P93) and Delivery Note (done, P94) — replacing the Surat Jalan | Delivery Note: HPP / Persediaan at the stand-in's Harga Pokok |
| 3.6 | Faktur Penjualan with advance deduction; faktur pelunasan / normal | journal, faktur |
| 3.7 | Pembayaran — Faktur Penjualan (withholding and WAPU by rule) | Cash Bank Book, journal, bukti potong |
| 3.8 | Pengembalian Uang Muka, Faktur Pengganti / Pembatalan, Perlu Pembetulan | Cash Bank Book, journal, tax corrections |
| 3.9 | Nota Retur, Kredit Pelanggan, Pengembalian Kredit Pelanggan | journal, tax |
| 3.10 | Perizinan: Pengajuan, Uang Muka Perizinan, Realisasi, Biaya Perizinan, Invoice Perizinan | per simulation |
| 3.11 | Opening balances | SIBA's concept, empty unless stated (P27) |
| 3.12 | Sales dashboard | reads only |
