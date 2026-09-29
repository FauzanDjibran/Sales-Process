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
| Salesperson | `SALES` | |
| Termin Pembayaran | `TERMS` | |
| Gudang | `WAREHOUSES` | Delivery origin only while stock is ignored (P5) |
| Price group | `PRICE_GROUPS` | |
| Barang (`m_item`) | `GOODS` | Units with conversion, tax code, NIE BPOM + expiry, price list per price group × mode, placeholder cost (P18) |
| Jenis Perizinan | `PERMITS` | Not an item |
| Jenis PPh | `WHT_TYPES` | Rate, object, prepaid-tax account |
| Kode Pajak | `TAX_CODES` | Master or code catalogue — decided when built |
| Company Setting | `COMPANY` | Its own menu (P28) |

---

## Phase 3 — Sales process (as the user instructs)

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
| 3.1 | Sales Order Barang (credit check, approval, Salin, Tutup Pesanan) | nothing |
| 3.2 | Uang Muka Penjualan | nothing |
| 3.3 | Pembayaran — Uang Muka (+ Penerimaan / Pengeluaran lain-lain) | Cash Bank Book, journal |
| 3.4 | Faktur Pajak Keluaran (uang muka) and Bukti Potong PPh | nothing — tax documents |
| 3.5 | Surat Jalan | HPP / Persediaan at placeholder cost (P18) |
| 3.6 | Faktur Penjualan with advance deduction; faktur pelunasan / normal | journal, faktur |
| 3.7 | Pembayaran — Faktur Penjualan (withholding and WAPU by rule) | Cash Bank Book, journal, bukti potong |
| 3.8 | Pengembalian Uang Muka, Faktur Pengganti / Pembatalan, Perlu Pembetulan | Cash Bank Book, journal, tax corrections |
| 3.9 | Nota Retur, Kredit Pelanggan, Pengembalian Kredit Pelanggan | journal, tax |
| 3.10 | Perizinan: Pengajuan, Uang Muka Perizinan, Realisasi, Biaya Perizinan, Invoice Perizinan | per simulation |
| 3.11 | Opening balances | SIBA's concept, empty unless stated (P27) |
| 3.12 | Sales dashboard | reads only |
