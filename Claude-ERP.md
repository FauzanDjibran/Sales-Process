# Project Context — ERP

> The main guideline for Claude Code in this folder. Read it before any
> substantial work. It overrides the parent `Simulation-Project/CLAUDE.md`
> wherever the two differ (§1.3). Every decision agreed with the user is
> recorded in §12, and every open clash in §18, so it applies to all future work.
>
> Named `Claude-ERP.md` to tell it apart from SIBA's `CLAUDE.md`. The
> one-line `CLAUDE.md` beside it only imports this file, so Claude Code still
> loads it automatically.

---

## 1. Project Overview

**ERP** is a new ERP project: a business web application, built in Indonesian
for Indonesian accounting and tax practice. It is a **real application on a
real database**, run mainly on the user's own machine, where people enter their
own data. **One installation serves one company.**

It grows module by module, and **sales comes first**: the first goal is to do
everything the PRJ.001 simulation `Initialization/actual-simulation-v2.html`
("sales.html") does, including its tax handling (PPN, PPh 22/23, Coretax faktur
pajak, bukti potong). It is built on **SIBA 3.0's stack, workflow and
accounting framework** (`D:\Claude Code\Budget-Project`). SIBA already solves
accounts, journals, ledgers, fiscal periods, cash & bank, multi-currency, RBAC,
audit and the UI system; this project leans on those rather than re-inventing
them.

**It is a standalone project** (P22). SIBA is only the source the working parts
are carried from during initialization. Once carried, the code is this
project's own: nothing imports from SIBA or follows its later changes. The
way of working, though, is SIBA's exactly — the same workflow, discipline,
conventions and documentation habits.

### 1.1 Source material (`Initialization/`, read-only)

| File | Role |
| --- | --- |
| `actual-simulation-v2.html` | **Behaviour and UI reference for sales** — a ~5.6k-line vanilla-JS SPA carrying SIBA's stylesheet verbatim. Its flows, rules, tax arithmetic, journals and screens are what the sales module must reproduce. Its **data is demo content** and never canonical |
| `design-convention.md` | The shared UI/UX convention, extracted from SIBA (P1–P12, D1–D22). **Followed in full** |
| `Core_UI_Reference.md` | Benchmark study behind the convention; background only |
| `multi_currency_concept.md` | **The multi-currency convention this app follows** (§12 P13) — identical to SIBA's `CORE Multi Currency Concept.md` |
| `tax_concept.md` | **The tax convention this app follows** (P59, P60): PPN, PPh, the faktur pajak and bukti potong as records, rounding. Written in the repository root; it moves into `Initialization/` when the user places it there |
| `ar_ap_open_item_concept.md` | The AR/AP open-item model: each financial source creates an open item with direction and current balance; an append-only open-item ledger; allocation between items of the same partner and currency. **Applied to AR by P71–P75** as AR items and Buku Piutang, without a separate allocation step; AP follows the same way when purchasing is built |

**The concept files above are frozen originals.** The copies this app follows
are in **`knowledge/`**, kept in step with the shared knowledge base (§20):
`knowledge/design-convention.md`, `knowledge/multi_currency_concept.md`,
`knowledge/ar_ap_open_item_concept.md` and `knowledge/Core_UI_Reference.md`.
`tax_concept.md` stays in the repository root as the living copy. Where this
file says "follow `<concept>.md`", read the `knowledge/` copy.

Outside this repository, read-only, consulted when needed:

| Where | What |
| --- | --- |
| `D:\Claude Code\Budget-Project` (SIBA 3.0, `main` @ `3b33094`) | The framework being carried over: code, `CLAUDE.md`, `prisma/schema.prisma`, `SIBA DBML/`, tests |
| `D:\Claude Code\Budget-Project\Initialization\SIBA Multi Currency Concept.md` | How SIBA applied the multi-currency convention — background for the carried engine |
| `..\simulation-notes.md` | How each simulation step was designed and why |
| `..\..\CLAUDE.md` §6, decisions S11–S22 | The sales-flow decisions the simulation embodies |

### 1.2 Authority when sources disagree

1. **The user's decisions in §12** win over everything.
2. **SIBA's framework** decides *how* things are built — stack, architecture,
   books, posting engine, multi-currency, UI system, security (§3–§11 here,
   SIBA's `CLAUDE.md` behind them).
3. **The simulation** decides *what* the sales process does — documents,
   lifecycles, tax arithmetic, journal lines, screen content.
4. Where 2 and 3 conflict, **nothing is resolved silently**: the clash is
   written into §18 with a recommendation and **the user decides**. Only then
   does it move into §12.

### 1.3 Relation to the parent `Simulation-Project/CLAUDE.md`

The parent file governs single-file HTML simulations. This folder is a real
application and a project of its own, not a numbered simulation (§12 P21), so
the parent's tech stack and folder numbering **do not apply here** — SIBA's
stack does. Its UI rules (Indonesian copy, P1–P12, status map, icon set) still
hold, because they are the same convention. Decisions S11–S22 there are the
sales behaviour the simulation implements, and carry over through it.

### 1.4 Scope

- **Carried over from SIBA** — see §13.
- **Built new** — master data (Phase 2) and the sales process (Phase 3), in
  the order the user instructs. Other ERP modules come after sales.
- **Stock** — the stock books are built (P120): quantity per warehouse, location
  (where the warehouse keeps them, P136), lot and status, value per item at moving average (P114), with Kartu Stok, Saldo
  Stok, Kartu Nilai Persediaan and Nilai Persediaan. **Knowingly not built
  yet:** any document that brings stock in (stock arrives by `db:stock-inject`),
  transfers between warehouses or statuses, and stock opname.
- **Knowingly ignored until stated otherwise** — items the user sets aside are
  added to this line.
- **Not carried from SIBA** — the two-company structure and everything
  Budget-related (§12 P9, P10).

### 1.5 Current status

| Area | State |
| --- | --- |
| Project guideline (this file) | Written 29/09/2026; clash decisions recorded 29/09/2026 |
| Implementation plan | `IMPLEMENTATION-PLAN.md` — Phase 1 done 29/09/2026; Phase 2 done for sales 29/09/2026 (Partner customer side, Satuan, Termin, Gudang, Jenis PPh, Item, sales defaults); Phase 3 started: Sales Order built 29/09/2026 (P49–P53); Uang Muka Penjualan built 29/09/2026 (P54–P58); tax arithmetic moved to `tax_concept.md` (half up, per-line chain, snapshotted PPN setting) 29/09/2026 (P59, P60); settings split into System Default and Account Mapping 29/09/2026 (P61); Sales Order lifecycle Draft → Diajukan → Open → Ditutup, form rework, advance layout, dropdown keyboard and percent field 30/09/2026 (P63–P65); Penerimaan Kas & Bank with its first purpose, Penerimaan Uang Muka Penjualan, settling several bills per receipt 30/09/2026 (P66–P70); AR items and Buku Piutang with the Buku Piutang, Umur Piutang and Uang Muka Customer reports 30/09/2026 (P71–P75); the receipt reworked to cash-first lines picked from a dialog, and Buku Piutang's Sertakan Uang Muka switch 30/09/2026 (P76, P77); the Sales Order renamed the Customer Order 01/10/2026 (P78); the Sales Order built as the Customer Order's dated child 01/10/2026 (P79); deployed on Vercel with a Neon database 01/10/2026 (P80); the Sales Order's lines picked from the Customer Order in a dialog, and document lines trimmed to what the user acts on 01/10/2026 (P81, P82); the payment menu reviewed against mainstream ERPs and its roadmap set 02/10/2026 (P83–P86); the sales process concept gathered in `Sales-Process-Concept.md` (U1–U10, agreed, not yet built) 03/10/2026; the Delivery Order built 03/10/2026 (P93); the Delivery Note built 03/10/2026 with a stand-in inventory and Harga Pokok (Sementara) (P94); stock picking by lot on the Delivery Note, from a stand-in lot list, 04/10/2026 (P95); the Faktur Penjualan planned (`Sales-Process-Concept.md` §9, U16–U22) and its first step, the AR item's revised shape, built 04/10/2026 (P96); the Faktur Penjualan built 04/10/2026, with the Customer Order closing itself once fully delivered (P97); Penerimaan dari Customer, paying advance bills and Fakturs in one receipt, 04/10/2026 (P98); the Pajak module — Faktur Pajak Keluaran and Bukti Potong PPh, made by posting, their upload and BPPU recorded by the user — 04/10/2026 (P100); reframed as internal records, the faktur without an upload lifecycle and its NSFP an optional, correctable reference (P101); a QA and performance pass on volume data (P102); the old ERP design reviewed and its standalone-document concept adopted, P106–P113 decided 05/10/2026, the Delivery Note made standalone under Logistik (P106); the advance bill and the Invoice moved to Finance (P107); sales in the base unit only (P108); `-NP` number series for documents without PPN (P109); a ledger number per posting in every book (P110); unrounded prices, the Invoice's gross and discount and the cumulative partial-bill split (P111, P112); settlement PPN as full PPN less the advance's (P113, KB choice point); moving-average stock valuation agreed for the logistics module, unit costs at six decimals (P114); the inclusive split stated (P115); AR items keep balances only, the Invoice item born at its face with the Uang Muka applied in three entries, the advance's PPN recalculated, PPh calculated when needed (P116–P119); the stock books built on the user's stock DBML — quantity per warehouse / lot / status and moving-average value per item, each a ledger and a balance, the Delivery Note issuing from them, stock brought in by `db:stock-inject`, four reports under a new Persediaan menu — replacing the stand-in 06/10/2026 (P120); the purchasing module planned and agreed in `Purchasing-Concept.md` (B1–B33) 06/10/2026 (P121), step 1 built — Jenis PPh per side, Supplier on with purchase defaults, the Pembelian settings and accounts per Kategori Item — 06/10/2026 (P122); step 2, the Purchase Request (Barang and Jasa menus, base unit, Tanggal Dibutuhkan per line, Draft → Open), 06/10/2026 (P123); step 3, the Purchase Order (from Open requests, merged per item, shares earliest need first, approval), 06/10/2026 (P124); step 4, the Receipt Note (stock in by lot, expense otherwise, GR/IR at the PO's DPP), 06/10/2026 (P125); step 5, Uang Muka Pembelian (the AR bill mirrored), 06/10/2026 (P126); step 6, AP items / Buku Hutang and the Pengeluaran paying AP advance bills, 06/10/2026 (P127); step 7, the Invoice Pembelian (receipt lines at the PO price, supplier total within the tolerance, PPh at the invoice) and paying it, 06/10/2026 (P128); step 8, Buku Hutang, Umur Hutang, Uang Muka Supplier and the AP reconcile checks — the purchasing plan built — 06/10/2026 (P129); a starter chart with its mappings as its own seed (P130); Logistik merged into Persediaan and the menu put in business-flow order 06/10/2026 (P131); each advance bill keeps what it was paid, so a receipt or payment never reads another 07/10/2026 (P132); one document, one item — one Uang Muka item per advance bill raised by each payment, and the Invoice keeping what it was paid — 07/10/2026 (P133); one calculation path for full and partial payments 07/10/2026 (P134); Kartu Stok and Saldo Stok grouped per Barang or per Gudang over item × warehouse cards 07/10/2026 (P135); warehouse locations — Gunakan Lokasi per Gudang, `ref_warehouse_location`, the bucket warehouse · location · lot · status — 07/10/2026 (P136); the Perizinan flow planned and agreed in `Perizinan-Concept.md` 08/10/2026 (P137) and built the same day — Jenis Perizinan, Pengajuan with Realisasi, Uang Muka Perizinan, Biaya Perizinan and Invoice Perizinan, the AR scope pair, the receipt and payment learning them (P138–P144) |
| Code | Phase 1 carried and adapted: one company, no Budget, Control Account set by the user, `PREFIX/YYYY/MM/NNNN` numbering, dashboard placeholder. `npm run build`, `npm run lint` and `npm test` pass on PostgreSQL 18; the Phase 1 walk-through (fiscal year, accounts, Partner, Cash & Bank with opening balance, manual journal, General Ledger, Trial Balance) checked in a browser and in Postgres |
| Schema | Baseline migration, removal of rate layers (P37), Partner addresses / contacts / tax identity and the region reference (P39–P42), the reference masters Satuan / Termin / Gudang / Jenis PPh (P43, P44), Item with unit conversions and Kategori Item (P46–P48), the customer's sales defaults (P51), Sales Order `sal_order(_line)` (P49–P53), Uang Muka Penjualan `sal_advance` (P54–P58), PPN rate snapshots on SO / advance and per-line DPP Nilai Lain (P60), the SO's new statuses with Gudang and Kirim Diminta dropped (P63), the cash & bank transaction `fin_cash_bank_tx(_line, _line_wht)` (P66), AR items `fin_ar_item` and Buku Piutang `fin_ar_ledger` (P71–P75); the Sales Order renamed in place to the Customer Order `sal_customer_order(_line)` (P78), and the new Sales Order `sal_order(_line)` (P79); the Delivery Order `sal_delivery_order(_line)` (P93); the Delivery Note `sal_delivery_note(_line)`, delivered quantities on Sales Order and Delivery Order lines, and the temporary `tmp_item_cost` / `tmp_stock_movement` (P94); the Delivery Note's picks `sal_delivery_note_pick` and the temporary lot list `tmp_stock_lot` (P95); the AR item's revised shape — `ar_item_no`, source = what it is about, tax columns (P96); the Faktur Penjualan `sal_invoice(_line, _advance_deduction)` and delivered quantity on Customer Order lines (P97); `DBML/erp.dbml.md` in step; the tax documents `tax_faktur(_line, _ref)` and `tax_withholding_slip` (P100), the faktur's status dropped (P101); the Delivery Note renamed in place to `log_delivery_note(_line, _lot)` with purpose and a weak source pair (P106); the advance bill and the Invoice moved to Finance as `fin_ar_advance` and `fin_ar_invoice(_line, _advance_deduction)` (P107); `ledger_no` + `line_no` on Buku Piutang, the Cash Bank Book and the stock movement (P110); `fin_ar_item.original_amount` with its tax columns dropped and the event `AdvanceApplied` (P116, P117); the stock books `log_stock_tracking`, `log_stock_ledger` / `_balance`, `log_stock_valuation_ledger` / `_balance` and `sys_stock_status`, the temporary `tmp_` tables dropped (P120); `ref_withholding_tax.usage` with `prepaid_account_id` renamed `account_id`, the supplier's `purchase_term_id / purchase_price_mode`, and `acc_item_category_account` (P122); the Purchase Request `pur_request(_line)` (P123); the Purchase Order `pur_order(_line)` and `pur_order_line_request` (P124); the Receipt Note `log_receipt_note(_line, _lot)` (P125); Uang Muka Pembelian `fin_ap_advance` (P126); AP items `fin_ap_item` and Buku Hutang `fin_ap_ledger` (P127); the Invoice Pembelian `fin_ap_invoice(_line, _advance_deduction)` (P128); `paid_amount` on `fin_ar_advance` and `fin_ap_advance` (P132); the event `AdvanceReceived`, `paid_amount` on `fin_ar_invoice` and `fin_ap_invoice`, one Uang Muka item per bill by a partial unique index (P133); `ref_warehouse.use_location`, `ref_warehouse_location`, `location_id` on the stock ledger and balance and on the Receipt / Delivery Note lot rows, the bucket and pick keys unique NULLS NOT DISTINCT (P136) |

---

## 2. Core Principles

1. **SIBA builds it; the simulation specifies sales.** Reuse SIBA's modules,
   components and rules as they are. Build new only what SIBA does not have.
2. **Carry over verbatim, then change by decision.** A SIBA file is copied
   unchanged first; any deviation is a recorded decision (§12), never a quiet
   edit during the copy.
3. **The design system is finished work.** `globals.css` is SIBA's, byte for
   byte. New classes only for what SIBA lacks, in a clearly marked additions
   block, built from SIBA's tokens.
4. **Registry over pages** for master data; **bespoke modules** for documents
   with a lifecycle — exactly as SIBA splits them.
5. **Validate on the server.** The UI narrows; the Server Action enforces.
6. **Post is the boundary, and it is one transaction.** A Draft touches no
   book, no journal, no tax document. Post writes everything or nothing.
7. **A posted document is permanent.** No edit, delete or reversal; a
   correction is a new document (retur, pengembalian, faktur pengganti).
8. **Books are append-only.** Journal and Cash Bank Book are written side by
   side at Post; neither is derived from the other.
9. **A document that is not a transaction posts no journal** (SO, advance bill,
   Pengajuan Perizinan, tax documents).
10. **Every write is audited**, and every lifecycle step names its event.
11. **Master data is never deleted.** Deactivate instead.
12. **Indonesian UI, English code.**
13. **One installation, one company.** No company table, no `company_id`.
14. **Nothing assumes a business row exists.** Demo data from the simulation is
    for development only and never reaches the seeder.

---

## 3. Architecture

SIBA's architecture, unchanged:

```
Browser
  ├─ Server Components  ──► src/lib/erp/*.ts (server-only) ──► Prisma ──► PostgreSQL
  └─ Client Components  ──► Server Actions (src/app/actions/*) ──► Prisma ──► PostgreSQL
                                     └─ revalidatePath() (re-renders the page in the action's own response)
```

- **No REST/GraphQL layer.** Reads through Server Components, writes through
  Server Actions.
- **One authorization gate** (`auth.ts`): pages `requireAuth` /
  `requirePermission`, actions `actorOrDeny` / `authorizeAction`.
- **Serialization boundary:** Prisma `Decimal` / `Date` pass through
  `serialize()` before reaching a client component.

### 3.1 The module contract (from SIBA, in force)

1. A module's tables are named only by that module (data module + its Server
   Action count as one).
2. Dependencies point one way. Planned direction for sales:
   `Sales documents → Penerimaan / Pengeluaran Kas & Bank → books`; where a
   sales document needs to know what was paid (a paid bill refusing
   Batalkan), the action or page layer composes the two; tax documents depend on the
   documents that raise them, never the reverse.
3. **The books depend on nothing** but the shared kernel (`journal`,
   `cash-bank`, `fx`, `currency`, `document-number`, `period`, …).
4. A reference into **master** data is a foreign key; a reference into another
   module's **document** is the weak `(doc_type_id, doc_id)` pair. Within one
   module (e.g. SO → Surat Jalan → Faktur Penjualan) foreign keys are fine.
5. `tests/module-boundaries.test.ts` enforces it.

### 3.2 Planned sales modules (detail comes per instruction)

| Module | Owns | Posts |
| --- | --- | --- |
| Customer Order (`CO/…`) | `sal_customer_order(_line)` | nothing |
| Sales Order (`SO/…`, child of the Customer Order) | `sal_order(_line)` | nothing |
| Uang Muka Penjualan (Finance menu, `ARA/…`; a Finance module since P107) | `fin_ar_advance` | nothing (bill only) |
| Delivery Order (`DO/…`, from the Customer Order's Open Sales Orders) | `sal_delivery_order(_line)` | nothing |
| Delivery Note (Persediaan, `SJ/…`; standalone by purpose, P106 — `sales_delivery` from an issued Delivery Order) | `log_delivery_note(_line, _lot)` | journal Dr HPP / Cr Persediaan at the moving average the stock books release (P120) |
| Inventory (a book: kernel only; documents call it, P120) | `log_stock_tracking`, `log_stock_ledger`, `log_stock_balance` (one bucket per warehouse · location · lot · status, P136), `log_stock_valuation_ledger`, `log_stock_valuation_balance`; reports read through `stock-report.ts` | never a journal — the issuing or receiving document posts, and writes the books beside |
| Invoice Penjualan (Finance › Invoice, `INV/…`, whole lines of one Customer Order's posted Delivery Notes; a Finance module since P107) | `fin_ar_invoice(_line, _advance_deduction)` | journal Dr Piutang · Dr Uang Muka / Cr Penjualan · Cr PPN; the Invoice AR item (P97) |
| Nota Retur | `sal_return(_line)` | journal + faktur pajak |
| Pengajuan Perizinan (Penjualan › Perizinan, `PRZ/…`, realisasi `RLZ/…`, P139) | `sal_permit_request(_line)` | nothing |
| Uang Muka Perizinan (Finance › Uang Muka, `UMP/…`, P141) | `fin_ar_permit_advance` | nothing (bill only); paid by Penerimaan dari Customer → Cr Uang Muka Perizinan |
| Invoice Perizinan (Finance › Invoice, `INP/…`, P143) | `fin_ar_permit_invoice(_advance_deduction)` | journal Dr Piutang / Cr Pendapatan Perizinan · PPN Keluaran; the Invoice AR item; a one-line faktur |
| Penerimaan / Pengeluaran Kas & Bank (Finance › Kas & Bank, `BKM/…`, `BKK/…`; *Penerimaan dari Customer* pays advance bills and Fakturs, P98) | `fin_cash_bank_tx(_line, _line_wht)` | Cash Bank Book + journal (Cr Uang Muka · PPN for a bill, Cr Piutang for a Faktur); Pembayaran on Invoice items; the figures tax documents are made from |
| AR items (a book: kernel only; documents call it) | `fin_ar_item`, `fin_ar_ledger` (Buku Piutang) | never a journal — the receipt and the Faktur post, and write their AR items beside |
| Purchase Request (Pembelian, `PR/…`, P123) | `pur_request(_line)` | nothing |
| Purchase Order (Pembelian, `PO/…`, from Open requests, P124) | `pur_order(_line)`, `pur_order_line_request` | nothing |
| Receipt Note (Persediaan, `RN/…`; standalone, purpose `purchase_receipt`, P125) | `log_receipt_note(_line, _lot)` | stock books by lot; journal Dr Persediaan / Beban, Cr Barang Diterima Belum Ditagih |
| Uang Muka Pembelian (Finance › Uang Muka, `APA/…`, P126) | `fin_ap_advance` | nothing (bill only) |
| Pengeluaran Kas & Bank (Finance › Kas & Bank, `BKK/…`; *Pembayaran ke Supplier*, P127) | `fin_cash_bank_tx(_line, _line_wht)` Out, beside the Penerimaan | Cash Bank Book Out + journal (Dr Uang Muka Pembelian · PPN Masukan / Cr Kas & Bank · Hutang PPh for a bill); AP items |
| Invoice Pembelian (Finance › Invoice, `PI/…`, P128) | `fin_ap_invoice(_line, _advance_deduction)` | journal Dr Barang Diterima Belum Ditagih · PPN Masukan · Selisih / Cr Hutang Usaha · Hutang PPh; the Invoice AP item |
| AP items (a book: kernel only) | `fin_ap_item`, `fin_ap_ledger` (Buku Hutang) | never a journal |
| Pajak (`FPK/…`, `BPU/…`, P100) | `tax_faktur(_line, _ref)`, `tax_withholding_slip` | never a journal — made inside the receipt's and the Invoice's posting through their `afterPost` hook |

Table prefixes follow SIBA (`sys_`, `ref_`, `m_`, `acc_`, `fin_`) plus
`sal_` (sales), `pur_` (purchasing), `log_` (standalone logistics documents, P106) and `tax_` (tax documents). Later ERP modules take their own
prefix when they arrive.

---

## 4. Technology Stack

Identical to SIBA 3.0.

| Concern | Choice |
| --- | --- |
| Language | TypeScript (strict) |
| Framework | Next.js 16.3.5, App Router, Turbopack — **read `node_modules/next/dist/docs/` before writing Next code; `AGENTS.md` is managed by `next dev`** |
| UI | React 19.2 |
| ORM | Prisma 7.10 with `@prisma/adapter-pg` (driver adapter required) |
| Database | PostgreSQL 18, local |
| Styling | SIBA's `globals.css`, plain CSS, no utility framework |
| Fonts | `next/font` — Plus Jakarta Sans + JetBrains Mono |
| Auth | SIBA's own: `bcryptjs` + `node:crypto`, database sessions, no auth library |
| Validation | Hand-written in Server Actions |
| Tests | `node:test` via `tsx` (`npm test`), against a real seeded database |
| Lint | ESLint 9 + `eslint-config-next` |

Path alias `@/*` → `./src/*`. No new dependency without saying why.

**Runs locally, and is also deployed on Vercel with a Neon database** (P80),
as SIBA is: Vercel project `erp` in the same account as SIBA, building
`main` of `FauzanDjibran/Sales-Process`; Neon database `erp-postgres`
(Singapore, Free plan), which sets `DATABASE_URL` on the project. Vercel only
builds — migrations and the seed are run from this machine with the
`db:neon-*` scripts (§6). The functions run in Vercel's Singapore region
(`vercel.json`, P102), beside the database. Ports are chosen so SIBA and this
app can run side by side:

| Run | Command | Port |
| --- | --- | --- |
| Development (hot reload) | `npm run dev` | 3100 |
| Local run — production build | `npm run build`, then `npm start` | 3110 |

Package name `erp`; database name `erp`.

---

## 5. Repository Structure (target)

```
Initialization/        Read-only source material (§1.1)
Claude-ERP.md          This file
CLAUDE.md              One line: imports Claude-ERP.md (auto-loaded by Claude Code)
IMPLEMENTATION-PLAN.md Phased plan; updated as phases complete
AGENTS.md              Managed by `next dev` — keep, never put context in it
DBML/erp.dbml.md       Current schema as DBML, updated with every migration
prisma/                schema.prisma, migrations/, seed.ts (system data only)
scripts/               seed-showcase.ts — dev-only demo data from the simulation
src/
  app/(auth)/login, app/(app)/<module>/…, app/actions/*
  components/ui, shell, master, report, accounting, finance, sales, logistics, tax
  lib/format.ts        The only place a date, amount or rate is formatted
  lib/erp/             SIBA's lib/siba/, renamed: registry, nav, permissions,
                       books, workflows, fx, tax engine
tests/                 Carried SIBA suites + one suite per new module
.claude/skills/        run-erp (adapted from SIBA's run-siba)
```

---

## 6. Development Workflow

Same commands as SIBA once Phase 1 lands: `npm run dev`, `npm run build`,
`npm start`, `npm run lint`, `npm test`, `npm run db:seed` (idempotent, system
data only), `npm run db:seed-accounts` (the starter chart with Account Mapping, Kategori Item and Jenis PPh accounts, P130; additive, safe for production), `npm run db:seed-showcase` (dev demo data from the simulation,
`scripts/seed-showcase.ts`: additive, matched on label / name), `npm run
db:reset` (**destructive**; drops, migrates, then runs `db:seed` — Prisma 7
seeds nothing on its own without a config file), `npm run db:fresh`
(**destructive**; `db:reset` plus the showcase), `npx prisma migrate dev`.
Against the deployed Neon database (P80), through `scripts/with-remote.mjs`,
which reads `.env.neon` (gitignored) and always connects unpooled: `npm run
db:neon-migrate` (`prisma migrate deploy`; run after every push that adds a
migration), `npm run db:neon-seed` (refuses without `ERP_ADMIN_PASSWORD` in
`.env.neon`), `npm run db:neon-seed-showcase`, `npm run db:neon-reset`
(**destructive**, needs `-- --confirm`; seeds nothing, so `db:neon-seed`
follows).
`git_command.md` is the user's command reference; keep it in step.

- **Validate before reporting done:** `npm run build`, `npm run lint`,
  `npm test`; for UI, exercise it in a browser; for write paths, check the rows
  in Postgres. Anything touching money, tax, auth or posting needs a test.
- **State plainly what was not verified.**
- **Windows gotchas (from SIBA):** PowerShell 5.1 `Set-Content -Encoding utf8`
  writes a BOM that breaks CSS/TS — use the Write tool. Postgres CLI lives in
  `C:\Program Files\PostgreSQL\18\bin`. `npm` is `npm.cmd`.

---

## 7. Coding Conventions (from SIBA)

| Thing | Convention |
| --- | --- |
| Prisma model | PascalCase + `@@map` to snake_case table |
| Prisma field | **snake_case** — the registry references columns as strings |
| TS file | kebab-case |
| Component | PascalCase |
| Function / variable | camelCase |
| Route segment | kebab-case slug |

- Server Components by default; `"use client"` only for interactivity.
- DB-reading pages: `export const dynamic = "force-dynamic"`.
- Server Actions return `{ ok: true, … } | { ok: false, errors }`.
- **No `router.refresh()` after a Server Action.** A successful action calls
  `revalidatePath`, which re-renders the current page inside the action's own
  response; a client refresh on top is a second full render (and a third
  after `router.push`), which is slow on the deployed database.
- Route params are Promises in Next 16.
- Comments explain **why**. Modules touching the DB import `"server-only"`.
- Business arithmetic (PPN, DPP Nilai Lain, withholding, allocation) lives in
  **pure, client-safe modules** so a form previews exactly what Post computes —
  the pattern SIBA uses for `fx.ts` and `transfer-valuation.ts`.

---

## 8. UI / UX Conventions

**Follow `knowledge/design-convention.md` in full** — it is SIBA's
convention and the simulation already conforms to it. The table in SIBA's
`CLAUDE.md` §8 applies unchanged, with one exception: payment direction
is always **Penerimaan / Pengeluaran** (§12 P17). The rules most often at stake:

- Sticky page header; **every action in `.ph-act`**, danger → neutral →
  primary, one primary rightmost; row menus the reverse.
- The app draws its own controls: `Combobox`, `Select`, `DateInput`,
  `MoneyInput`, `RateInput`, `MultiSelect` — never native `<select>`, date or
  number inputs.
- Forms from `FormBody` / `FormSection` / `FormRow` / `Field` only; 12
  columns; help on the label line; no summary side card; no `.ph-sub` on forms.
- Read-only is text (`.ro`); locked fields show a `Terkunci` chip.
- A document's heading is its number (`.docno`) + status badge; before saving,
  a placeholder (`Sales Order Baru`).
- A field waiting on another reads `Pilih <apa> dulu…`; pickers read
  `Pilih <apa>…`.
- **Consequences before commitment:** every Post / Konfirmasi / Batalkan goes
  through `ConfirmDialog` stating what will happen — for posting, the journal
  lines it will write.
- One status → label → class map; one icon set through `<Icon>`.
- Dates `dd/mm/yyyy`; `.` thousands, `,` decimals; all through `lib/format.ts`.
- Mono font for codes, document numbers, money and rates — never names.
- `RecordHistoryCard` is the last card on every saved record's form.
- **Form layout (P38):** header card → tabs for the rest (only when there is
  more than one section or collection) → history card. A collection tab is a
  table whose rows are added and changed in a panel dialog; the dialog changes
  the form, and the record's own Simpan writes it.
- Every growing list has the `Pager`.

**UI patterns the simulation adds** (carried as the simulation built them, into
the additions block): the `.impact` calculation box (DPP → DPP Nilai Lain →
PPN → total, and *Estimasi Penerimaan*), the decision-option list (`.optlist`,
`.chk.on`) used when a price mode changes, `.cardfoot.multi`, and `.ro .rx`.
Documents show **their own figures only** and link to related documents
(`Referensi`), never embed them (parent S13/S14).

---

## 9. Data / Database Conventions (from SIBA)

| Rule | Detail |
| --- | --- |
| Primary keys | `Int @id @default(autoincrement())` |
| Timestamps | `Timestamptz(6)`; `created_at`, `updated_at` |
| Authorship | `created_by Int`, `updated_by Int?`, no FK |
| Company | **None** — no company table and no `company_id` column anywhere (P9) |
| Money | `Decimal(18, 2)`, face and base measure per SIBA's multi-currency rules |
| Rates | `Decimal(18, 6)` |
| Percentages (discount, PPh rate) | `Decimal(9, 4)` — new; SIBA has none |
| Quantities | `Decimal(18, 4)` — new; SIBA has none |
| Calendar dates | `@db.Date`, UTC midnight, shown `dd/mm/yyyy` |
| Master status | `ActiveStatus` (Active / Inactive) |
| Deletion | None on master data; a document is cancelled, never deleted |
| System codes | `<prefix>.<4 digits>`, generated |
| Document numbers | `PREFIX/YYYY/MM/NNNN`, series per prefix per month, for every document and journal (P15) |
| Audit | Every create/update → `audit_log`, with `event` for lifecycle steps |

- **Migrations:** `npx prisma migrate dev` only; never edit an applied one;
  never `db push`. **Every migration updates `DBML/erp.dbml.md` in the same
  change.**
- **Seed:** system data only, idempotent, deletes nothing — plus the starter
  reference rows of P62, matched on label and never overwritten.
- **A balance is never a column on a master table**; it comes from its book.
- **Tax arithmetic in whole rupiah, rounded half up** (P59, `tax_concept.md`
  §7): PPN by the chain `round(12 % × round(DPP × 11/12))`, PPh
  `round(base × rate)`, the largest line absorbing allocation remainders;
  stored as `Decimal(18,2)`.

---

## 10. Business / Domain Rules

### 10.1 Carried from SIBA (in force once Phase 1 lands)

SIBA `CLAUDE.md` §10 rules on accounts, journals and multi-currency apply
unchanged unless a §12 decision says otherwise — notably: every journal
balances or nothing is written (47); a journal is append-only and immutable
(48); dated by its document, never ahead (49); lineage-numbered chart of
accounts, frozen numbers, parent accounts not postable (44–46, 77–78); an
account requiring a Partner names its Partner Category (15); manual journals
drafted then posted, never on a control account (81–83); fiscal-period lock,
closing and Opening Balance snapshot (95–96); multi-currency (66–76); reports
read-only and reconciling (39–43); audit events and record history (63–65);
auth and RBAC (9–13); the Cash Bank Book (22, 29, P31).

**Changed from SIBA:**

- **Control Account is set by the user** on the account form (P16), not
  recomputed from structure (SIBA rule 79–80). `is_postable` stays derived
  from the tree.
- Everything resting on the two companies (rules 1, 8's per-company scope,
  38, 57–62), on Budget (18–20, 25–28, 34–36, 50) and on subject books
  (52–56) is **not carried** (P9, P10, P25).
- Opening balances start empty (P27).
- **No rate layers** (P37): a foreign Cash & Bank resource is one pool at
  its moving average. Money leaving is valued at the average when it is
  posted, a backdated movement included.

### 10.2 Sales domain (from the simulation — implemented step by step)

Recorded here as the specification; each becomes enforced when its step is
built. Parent-decision numbers in brackets.

1. **Customer Order** (the Sales Order until P78; Barang only, P49) starts from the customer; its Termin
   and mode harga default from the customer (P51), and it names one of the
   customer's addresses (P53). **Kena PPN, then Include / Exclude PPN, are
   explicit user decisions** on the SO header; the mode is asked only when
   Kena PPN (P52, P63). No warehouse and no delivery date (P63). Draft →
   Ajukan → Diajukan → Setujui → Open → Ditutup; Batalkan (Draft) and Tolak
   (Diajukan) are final; Salin — no credit limit (P50, P63). Posts nothing.
   Closes by Tutup Pesanan with a reason, refused while a Sales Order drawn
   from it is still running, or by itself once every line is delivered
   (P97) [S15, S22]. It is the basis of the advance and the
   invoice (P78). Its quantity is released to PPIC in dated parts by **Sales
   Orders** (P79): quantity and Tanggal Kirim only, Draft → Diajukan → Pra-SO
   → Open → Ditutup, never more than the Customer Order line in total.
2. **PPN arithmetic** follows `tax_concept.md` (P59): half-up whole rupiah,
   PPN = round(12 % × round(DPP × 11/12)), an inclusive price's difference
   absorbed in the DPP. The simulation's floor (⌊DPP × 11/100⌋,
   ⌊gross × 11/111⌋) is superseded. PPN or not is decided on the transaction line (P45, P48), not by a tax-code table or the Item.
3. **Withholding is flagged per SO line** and inherited downstream; its type
   decides the rate (PPh 22 1,5 % goods to a collector, PPh 23 2 % services),
   taken from the Jenis PPh master (P44) and picked by the user per line (P61; formerly defaulted from the item's Tipe,
   P48). The SO offers only items marked Dapat Dijual (P46).
   WAPU buyers collect PPN themselves (kode transaksi 02 for government) [S20].
4. **Uang Muka Penjualan** is its own document (P54–P58, P64), drawn from one
   Open SO under Finance › Uang Muka. One global value, typed as % or
   Nominal in the SO's price mode; PPN follows; the PPh estimate follows the
   SO lines' Jenis PPh. Terbitkan and Batalkan post nothing; the SO's value
   caps its live bills; a closed SO takes no new bill [S11, S16, S21].
5. **Penerimaan / Pengeluaran Kas & Bank** (the simulation's Pembayaran) is one
   table for every movement of money, in two menus (P66). Its *tujuan* — a
   catalogue in code — decides what it settles and how it posts; the tujuan and
   the partner decide which documents one transaction may settle, and it may
   settle several (P67); one customer purpose will settle advance bills and
   invoices together (P83). Each line takes the cash received and withholding
   explains the shortfall by rule (P76); the bank charge is the company's
   (P68). It writes nothing off — the bill's owner does, by closing it (P84) —
   and takes no overpayment: unmatched money has its own purpose (P85)
   [S12, S14, S17, S20].
6. **Tax documents are created automatically** by the transaction that gives
   rise to them and never post a journal: Faktur Pajak Keluaran (uang muka at
   receipt; pelunasan / normal at invoice, dated the delivery date; upload to
   Coretax by the 15th of the next month) and Bukti Potong PPh (awaiting the
   customer's BPPU) [S18].
7. **Delivery Order, then Delivery Note** replace the Surat Jalan (C28). The
   **Delivery Order** (P93) instructs one warehouse to send goods of one
   Customer Order, its lines taken from that order's Open Sales Orders; it
   may be partial, carries no prices and posts nothing. The **Delivery Note**
   (P94) is what the goods leave on: drawn from an issued Delivery Order, it
   issues the goods through the stock books at the moving average, refusing
   short stock (P114, P120) — and posts Dr HPP / Cr Persediaan, never
   Piutang. Every line leaves by lot, picked on the note in full before it
   posts (P95); only a Barang with Kelola Stok can leave (P120). The Faktur will take its lines whole
   [S19].
8. **Faktur Penjualan** (P97) bills one Customer Order: whole lines of its
   posted Delivery Notes, priced from the order; it deducts the order's own
   Uang Muka the user picks, so PPN is acknowledged once: Dr Piutang (net),
   Dr Uang Muka (advance DPP) / Cr Penjualan (full DPP), Cr PPN Keluaran (on
   the net DPP), and creates the Invoice AR item [S20].
9. **Leftover advance** is refunded via Pembayaran (Pengembalian Uang Muka),
   never moved to another SO; tax corrected by Faktur Pengganti or Pembatalan;
   the bukti potong goes to Perlu Pembetulan [S22].
10. **Nota Retur** from a posted invoice: reduces revenue and PPN in the retur
    period; the open AR first, the paid part to Kredit Pelanggan (refunded via
    Pembayaran) [S22].
11. **Perizinan** (makloon product registration): Pengajuan → Uang Muka
    Perizinan → Realisasi → Biaya Perizinan (payment, no tax) → Invoice
    Perizinan with advance deduction. Pengajuan and realisasi post nothing.
12. **Per-customer positions** (Piutang, Uang Muka) sit on accounts that
    require a Partner, so every such journal line names the customer, and
    **per document in AR items** (P71): an Invoice item per Faktur, one Uang
    Muka item per bill raised by each payment (P133), each moved only through Buku Piutang and
    reconciling with its account. The simulation's Kredit Pelanggan balance
    concept is ignored unless the user states otherwise.

**To verify with a tax consultant** (from the simulation notes, not blockers):
kode transaksi 04 for DPP Nilai Lain and 02 for government buyers; PPh 22 rate
for goods to a government treasurer; NSFP format; faktur pengganti vs
pembatalan rules; non-PKP nota retur in Coretax.

---

## 11. Security Rules (from SIBA, unchanged)

Authentication everywhere but `/login`; authorize in the Server Action; ask for
a permission, never a role; no default permissions; nobody edits their own
access; the app always keeps an administrator; bcrypt + opaque SHA-256 session
tokens; indistinguishable login failures; denials reveal nothing; never commit
`.env` or credentials. SIBA `CLAUDE.md` §11 is the full text. Company-access
permissions are not carried (P9).

New permissions follow SIBA's naming: `MENU_<AREA>_ACCESS` for a menu, and
`<ENTITY>_<ACTION>` for an action (e.g. `SALES_ORDER_APPROVE`,
`SALES_INVOICE_POST`, `TAX_FAKTUR_EDIT`).

---

## 12. Decisions

Newest last. Later entries override earlier ones and say so.

| # | Date | Decision |
| --- | --- | --- |
| P1 | 29/09/2026 | **Goal.** Turn the PRJ.001 simulation (`actual-simulation-v2.html`) into a real, locally-run application with SIBA 3.0's tech stack, workflow and accounting framework. |
| P2 | 29/09/2026 | **Order of work:** (1) import and implement everything carried over from SIBA as is; (2) develop the master data as needed; (3) develop the sales process as the user instructs, step by step. |
| P3 | 29/09/2026 | **SIBA's design convention is carried over in full**, and SIBA's stylesheet byte for byte. |
| P4 | 29/09/2026 | **Clashes between SIBA's concepts and this app's are validated with the user before anything is built on them** (§18). |
| P5 | 29/09/2026 | **Stock is knowingly ignored until stated otherwise.** |
| P6 | 29/09/2026 | **This file is the main project guideline**, overriding the parent `Simulation-Project/CLAUDE.md` where they differ. |
| P7 | 29/09/2026 | **The guideline is named `Claude-ERP.md`**, to tell it apart from SIBA's `CLAUDE.md`. A one-line `CLAUDE.md` imports it so Claude Code still loads it at session start. |
| P8 | 29/09/2026 | **The project is an ERP; sales is achieved first.** Other ERP modules follow once sales is done. |
| P9 | 29/09/2026 | **One installation, one company** (C1). There is no company table and no `company_id` column; SIBA's two-company structure, Company access, Company filter, Funding Request and intercompany bridge are not carried. |
| P10 | 29/09/2026 | **Budget is not carried** (C2). Everything related to Budget is skipped — Budget, Budget Month, approval, realization, Budget Category and the mappings and Purposes resting on it, and SIBA's Cash Bank Transaction that realizes Budgets. |
| P11 | 29/09/2026 | **Master data is created through the application** (C5): full list / detail / create / edit / deactivate. The seeder seeds system data only; the simulation's demo data goes into a dev-only showcase script. |
| P12 | 29/09/2026 | **Partner, and accounts requiring a Partner, carry over from SIBA** (C4). Per-customer positions sit on partner-requiring accounts. What each master holds is discussed when Phase 2 starts; the Partner concept evolves from SIBA's (C6). |
| P13 | 29/09/2026 | **SIBA's multi-currency engine is used**, governed by the same multi-currency concept documents as SIBA (C7). Sales documents are rupiah only for now. |
| P14 | 29/09/2026 | **Chart of accounts is SIBA's lineage-numbered tree** (C10). |
| P15 | 29/09/2026 | **Document numbers use the simulation's format** `PREFIX/YYYY/MM/NNNN` for every document and journal (C8). Replaces SIBA's `CBT-0001` style. |
| P16 | 29/09/2026 | **Manual journal follows SIBA** (C9), **but Control Account is chosen by the user** on the account form, as it was before SIBA made it derived. The manual journal still refuses a control account. Overrides SIBA rules 79–80 for `is_control_account`; `is_postable` stays derived. |
| P17 | 29/09/2026 | **Payment direction reads Penerimaan / Pengeluaran** (C13), never Uang Masuk / Uang Keluar. |
| P18 | 29/09/2026 | **Surat Jalan posts cost of goods at a placeholder value until stock exists** (C12): Dr HPP / Cr Persediaan, no stock check. |
| P19 | 29/09/2026 | **Cash Bank Transfer and Debit / Credit Note are on hold** (C14): neither is carried now; discussed later. |
| P20 | 29/09/2026 | **Go-live opening balances are decided when needed** (C11). |
| P21 | 29/09/2026 | **This is a new ERP project** (C15), not part of PRJ.001 and not a numbered simulation. |
| P22 | 29/09/2026 | **Standalone project.** SIBA is used only during initialization, as the source to carry working parts from so development can begin. After that nothing here depends on SIBA, imports from it or tracks its changes. **Development works exactly the way SIBA was developed** — same workflow, discipline, conventions and documentation habits (§6, §15, §16, §19). |
| P23 | 29/09/2026 | **Initial carry-over is exactly:** the Accounting module minus the Budget mapping (chart of accounts tree, account types / categories / subcategories, journal and manual journal, General Ledger, Trial Balance, Laba Rugi, Neraca, Fiscal Year, closing, Opening Balance); `m_partner`; `ref_currency`; `m_cash_bank`; the user & role concept; the System Default concept; and Profil Saya. **Anything else from SIBA is brought over only after the user confirms it** (§18). |
| P24 | 29/09/2026 | **Pembayaran purposes are not part of initialization** (C3). They are designed when the Pembayaran menu is built. |
| P25 | 29/09/2026 | **Only the journal line and the General Ledger carry partner positions** (C4b). The Chart of Accounts keeps SIBA's partner concept (an account may require a Partner, naming its Partner Category), and per-partner balances are read from journal lines and the General Ledger. SIBA's subject books (`sub_ledger`) are not carried. A separate customer-credit balance concept is ignored unless the user states otherwise. |
| P26 | 29/09/2026 | **Initial masters are `m_item` and `m_partner`** (C6); everything else is a reference master (currency, unit of measure, …). What each holds is agreed when it is built. |
| P27 | 29/09/2026 | **Opening balances follow SIBA's concept and start empty** unless stated otherwise (C11). Replaces P20's "decided when needed". |
| P28 | 29/09/2026 | **Company identity lives in its own Company Setting menu** (C16) — seller name, NPWP, address and whatever else it will hold, discussed when that menu is built. There is still no company table in SIBA's sense (P9). |
| P29 | 29/09/2026 | **SIBA's application foundation is carried as is** (C17): shell and navigation, `components/ui`, `globals.css` and icons, `format.ts`, sign-in / sessions / `proxy.ts`, audit log and record history, the entity registry and its pages, error / forbidden pages, health and startup checks. |
| P30 | 29/09/2026 | **Partner Category is carried, and for now holds only Customer and Supplier** (C18), seeded as system data. `m_partner` requires one; an account requiring a Partner names the one it takes. |
| P31 | 29/09/2026 | **The Cash Bank Book is carried whole** (C19): ledger, balance, Saldo Awal at registration, rate layers, and the Buku Kas & Bank, Saldo Kas & Bank and Posisi Layer Kurs reports. *Rate layers and their report removed by P37.* |
| P32 | 29/09/2026 | **Also carried** (C20, C21): the test harness and the suites for what is carried, `run-siba` as `run-erp`, `truncate-transactions`, the CI workflow, and a dashboard placeholder until a sales dashboard is designed. Not carried: backfill scripts, Neon / standalone scripts, SIBA's showcase seed, SIBA's dashboard composition. |
| P33 | 29/09/2026 | **Commit straight to `main`.** Each completed step is committed to `main` and pushed as it lands; no feature branch. Replaces "commit or push only when the user asks" in §16. |
| P34 | 29/09/2026 | **The registry's multi-reference field type is removed.** Only Budget Category used it; it returns if a master needs a set of references. |
| P35 | 29/09/2026 | **Fiscal-year closing keeps its own record, one per year.** `acc_fiscal_closing` stays, without a company column; closing writes it and the year's Closed status in one transaction. |
| P36 | 29/09/2026 | **The stack matches SIBA's versions, PostgreSQL 18 included**, in development, tests and CI. |
| P37 | 29/09/2026 | **A foreign Cash & Bank resource is valued at its moving average; SIBA's rate layers are removed.** Money arriving joins the resource at the kurs it was received at; money leaving is released at the resource's carrying rate (`base_balance ÷ balance`) and takes no typed kurs; emptying a resource releases its remaining base exactly. **Backdating stays, and a backdated movement is valued at the average as it stands when it is posted** — the book does not replay history; this is the accepted concept. `cash_bank_layer`, the Posisi Layer Kurs report and its permission are dropped. Amends P31. |
| P38 | 29/09/2026 | **The ERP's form layout: a header card, then tabs, then the record history.** Whenever a record has more than one section or collection to fill in, everything beyond the header card goes into tabs (the UI reference's §7.8 pattern: accent underline, record count on a collection tab, a marker on a tab holding an error). A form with one section has no tabs. A collection tab lists its rows in a table and adds or changes one row in a panel dialog. Overrides design convention D22 (no tabs) and §8.9 (no record editing in a modal) for forms. Built into the registry: `Entity.tabs`, `Field.tab` / `section`. Existing forms keep their layout until they are next changed. |
| P39 | 29/09/2026 | **A Partner has addresses and contact persons, saved with it.** An address is a kelurahan / desa chosen top-down (provinsi → kota / kabupaten → kecamatan → kelurahan), the street typed by hand, a note, and two flags: **Penagihan** (the faktur target) and **Pengiriman** (the shipping target). Only the kelurahan is stored; the rest and the kode pos follow from it. **At least one address, flags optional.** It is shown as one line: `Provinsi, Kota, Kecamatan, Kelurahan, Alamat, Kode Pos`. A contact is Nama, Posisi, Nomor Telepon and Email, all required; contacts are optional. Both are part of the Partner — one transaction, one audit entry — and a removed row is deleted. |
| P40 | 29/09/2026 | **Indonesian regions are system reference data** (`sys_region_province / city / district / village`, kode pos per kelurahan), seeded from `prisma/data/region.tsv.gz`, which is converted from cahyadsn/wilayah and cahyadsn/wilayah_kodepos (Kepmendagri 2025, MIT). The seed matches on the Kemendagri code, updates names in place and never deletes. Indonesia only for now. |
| P41 | 29/09/2026 | **Partner is built customer-first; Supplier starts inactive.** The seeded Supplier category is deactivated (one-time, in the migration; a fresh install seeds it Inactive), so it can be switched back on when purchasing arrives. The target is one Partner master for both roles: the tax identity is shared, and role-specific tax behaviour shows only for its role. |
| P42 | 29/09/2026 | **The Partner's tax data has its own Pajak tab.** *Identitas Pajak* is Tipe Wajib Pajak (Badan / Orang Pribadi / Instansi Pemerintah), Jenis Identitas (NPWP / NIK), the 16-digit number (stored without separators), Nama sesuai NPWP / NIK, and Status PKP. Rules: only an Orang Pribadi may use a NIK; a PKP uses its NPWP. *Perlakuan Pajak Penjualan*, for Customers only, is: customer withholds PPh 23; customer collects PPh 22; Pemungut PPN = Bukan Pemungut / Instansi Pemerintah (kode 02, only for an Instansi Pemerintah). NITKU is deferred (C23). Credit limit, default Include / Exclude PPN, sales block and the Sales Order defaults are deferred (C24). |
| P43 | 29/09/2026 | **Reference masters for sales: Satuan, Termin Pembayaran and Gudang**, registry entities under Master › Referensi with the usual list / detail / create / edit / deactivate and their own permissions. Satuan is a unit only (Label, Nama); conversions between units belong to the Item. Termin carries Jumlah Hari (a whole number, 0 = Tunai), from which a due date is counted. Gudang is Label and Nama only while stock is ignored *(and sits under Master › Entitas since P62; Satuan and Termin get starter rows from the seed)*. **Not built:** Price Group (prices are typed by the user on the document), Salesperson (typed by hand on the document), Jenis Perizinan (Perizinan set aside for now). Kategori Barang is decided with the Item. |
| P44 | 29/09/2026 | **Jenis PPh is a user-managed master, seeded with the common types.** Label, Nama, Tarif (percent, `Decimal(9,4)`), Objek Pajak and the PPh Dibayar Dimuka account (postable, optional until a document books a withholding). The seed creates PPH22 1,5 %, PPH23 2 %, PPH23-15 15 % *(and PPH42-SEWA 10 %, dropped by P60)* once, matched on the system code, so a user's edits are never overwritten; users add their own. An account a Jenis PPh uses cannot be deactivated. Amends P11 (the seeder writes system data only) for these starting rows. |
| P45 | 29/09/2026 | **No Kode Pajak table.** Whether a line carries PPN is a yes / no, so it is an enum on the transactions that need it, not a master. Supersedes the simulation's `TAX_CODES` (`PPN-STD` / `NON-PPN`) and §10.2 rule 2's "tax codes". *Amended by P48: it is decided on the transaction, not on the Item.* |
| P46 | 29/09/2026 | **The Item master (`m_item`).** Header: Tipe Item, Kategori Item, Satuan Dasar, Label, Nama, and the flags Dapat Dijual, Dapat Dibeli, Kelola Stok and Memiliki Kadaluarsa; then one tab, **Konversi Satuan** — the item's other units and their factor to the base unit (`m_item_uom`, `Decimal(18,4)`, more than 0, each unit once, never the base unit), saved with the Item in one transaction and one audit entry. **Tipe Item** is an enum, `Barang` / `Jasa` (Aset may follow). Kelola Stok and Memiliki Kadaluarsa apply to Barang only and are stored flags while stock is ignored (P5). **Not on the Item:** price (P43), group, variants, customer-owned goods, purchasing setup, photo, NIE BPOM / izin edar, HPP standar (decided at Surat Jalan), Coretax kode barang / unit codes (with Faktur Pajak). Perizinan is not an Item. |
| P47 | 29/09/2026 | **Kategori Item is system data without a menu** (`sys_item_category`): Label, Nama and Tipe Item, seeded — Barang: Bahan Baku, Bahan Kemas, Barang Setengah Jadi, Barang Jadi, Barang Dagangan, Barang Habis Pakai; Jasa: Jasa Pemeliharaan, Jasa Konsultasi, Jasa Pengiriman, Jasa Maklon, Jasa Lain-lain. An item takes only a category of its own type; changing the type clears the choice. The account mapping per category is its own menu, later. |
| P48 | 29/09/2026 | **An Item carries no tax treatment.** Kena / Tidak Kena PPN and the Jenis PPh are decided on the transaction line. A line may start from a rule on the item's Tipe (Barang → PPh 22 for a collector customer, Jasa → PPh 23 for a withholding one), and the user can change it. Amends P45. |
| P49 | 29/09/2026 | **The Sales Order is SO Barang only.** Its lines offer Items of Tipe Barang marked Dapat Dijual. Jasa sales are a later, separate matter. Numbered `SO/YYYY/MM/NNNN`. |
| P50 | 29/09/2026 | **No credit control on sales.** A customer has no credit limit, there is no Menunggu Persetujuan / Setujui / Tolak, and no sales block. The Sales Order lifecycle is Draft → Konfirmasi → Dikonfirmasi, with Batalkan and Salin; Selesai and Tutup Pesanan arrive with the Surat Jalan. Supersedes the simulation's plafon kredit, approval and Blocked status (§10.2 rule 1). Closes C24 together with P51. |
| P51 | 29/09/2026 | **A customer carries two sales defaults, in a Penjualan tab**: Termin Pembayaran Default and Mode Harga Default (Include / Exclude PPN). Both are optional, customer-only, and only pre-fill a new Sales Order, which can change them. No default Gudang or salesperson. A tab whose fields are all out of play for the record (Penjualan on a supplier) is not shown. |
| P52 | 29/09/2026 | **The Sales Order's tax and line rules.** *Kena PPN* (Ya / Tidak) and the mode harga are decided **once per Sales Order**, in its header — amends P48's "per line". PPN arithmetic stays the simulation's (12 %, DPP Nilai Lain 11/12, floor, largest line absorbs rounding) in one client-safe tax module. **Jenis PPh is per line** (empty = not withheld), pre-filled for a customer marked Pemungut PPh 22 from the System Default *Jenis PPh untuk Pemungut PPh 22* (seeded to PPH22, changeable in Pengaturan), and editable. **Diskon is per line in two modes**, % or nominal, chosen by a toggle. **Salesperson** is optional free text; **Gudang** is picked on the SO. |
| P53 | 29/09/2026 | **A Sales Order names one customer address**, any of them regardless of its Penagihan / Pengiriman flags, by id — not a copied text. An address a document uses is protected: it cannot be removed from the Partner. Replaces the simulation's separate Identitas Faktur and Alamat Kirim on the SO. |
| P54 | 29/09/2026 | **The AR advance is Uang Muka Penjualan, under Finance › Uang Muka** (route `/finance/advance/sales`, table `sal_advance`). It is a bill: the anchor a customer's payment and, later, the invoice deduction name. It is **always drawn from one confirmed Sales Order**. It is designed to print later as the billing document sent to the customer (proforma). The simulation's separate Uang Muka Perizinan menu may later become a purpose of this same menu if the two stay close enough; that is decided when Perizinan returns. |
| P55 | 29/09/2026 | **The advance's value is typed as % or Nominal**, with the same toggle as a Sales Order line's discount, in the order's price mode (DPP when Exclude, PPN included when Include). PPN, DPP and DPP Nilai Lain follow from it by the simulation's arithmetic, in `sales-tax.ts` (`computeAdvance`). The PPh estimate shares the advance's DPP over the order's lines by the Jenis PPh each carries, so Barang lines withheld under PPh 22 count too. The flat option reads **Nominal**, not Rp, on the SO discount as well — a currency symbol would mislead once multi-currency documents exist. |
| P56 | 29/09/2026 | **The advance bill's header.** The Sales Order is chosen once and locked; customer, address, PO, mode harga and Kena PPN follow from it, read-only. The bill has its own Tanggal, Jatuh Tempo (default + 7 days), Rekening Pembayaran (a rupiah Bank, printed), Uraian (required, the printed line, pre-filled from the SO and PO) and Catatan. **The order's lines are not copied**: a strip shows the order's value, what other bills drew from it, and what is left. |
| P57 | 29/09/2026 | **The advance bill's lifecycle:** Draft → Terbitkan → Diterbitkan; Batalkan with a reason from Draft or Diterbitkan. It posts nothing at any step. Numbered `ARA/YYYY/MM/NNNN`. The live bills on one order never exceed its value; this is checked at save and at Terbitkan with the order's row locked. **A Sales Order with a live bill cannot be cancelled**: the bill is cancelled first. |
| P58 | 29/09/2026 | **AR and AP advances mirror each other in engine and design but keep their own tables.** The AP advance, when it comes, reuses the arithmetic, the lifecycle shape and the screen layout, with the other side's words and its own table and prefix. Neither bill stores what is paid or used; that belongs to the open items (C22). |
| P59 | 29/09/2026 | **The tax concept's first decisions** (`tax_concept.md` §11). Tax figures round **half up to whole rupiah** (PER-11/PJ/2025 art. 129), replacing the simulation's floor. PPN follows the chain `round(12 % × round(DPP × 11/12))`. An inclusive price's difference is absorbed in the DPP. The PPN rate and the DPP Nilai Lain factor become **dated settings** a user changes when the law changes. PPN is one decision per document, and a non-taxable transaction never produces a faktur pajak downstream. No transaction codes and no WAPU for now: basic private-sector faktur first. A faktur record is fully derived. There is one bukti potong per payment per Jenis PPh; a slip that never arrives stays awaiting. A read-only periodic tax report is part of the plan. Amends P52 and P55 on rounding; the built Sales Order and advance are reworked to it once C26's open points close. |
| P60 | 29/09/2026 | **The tax concept is settled** (`tax_concept.md` §11), closing C26. **PPN is computed per line** and the document's figures are the sum of its lines, as the faktur pajak carries them. In the ERP each line stores its DPP, DPP Nilai Lain and PPN, but **the line table does not grow columns for them**: they surface in the totals box and the faktur. An inclusive price absorbs the difference in DPP, and where no exact split exists the total is one rupiah below the typed price. **The PPN rate and the 11/12 factor are one system-wide setting each** (Pengaturan), with no effective dates; every transaction snapshots both when it is saved and carries them. **No manual PPh amount at payment:** a *Potong PPh* switch, on by default, applies the rule's figure; off means no PPh and no bukti potong. A different amount withheld by the customer is not modelled. **Final PPh (4(2)) is out of scope** until needed. Amends P59 on the dated settings. |
| P61 | 29/09/2026 | **Settings are split into two menus over one store** (`sys_setting`, one catalogue in code). **System Default** (Pengaturan › Sistem) is application-wide configuration: the **Base Currency**, shown locked because it is a constant the books are measured in (`currency.ts`), and the Pajak card (PPN rate, DPP Nilai Lain factor); later defaults such as a transit warehouse join it. **Account Mapping** (Accounting › Pengaturan, permissions `MENU_ACCOUNT_MAPPING_ACCESS` / `ACCOUNT_MAPPING_VIEW` / `ACCOUNT_MAPPING_EDIT`) says where each kind of posting lands: Account Selisih Kurs and the two Laba/Rugi equity accounts today. A mapping is added only when the document that posts it is built (Piutang, Uang Muka, PPN Keluaran with Pembayaran / Faktur; Hutang, PPN Masukan with purchasing). PPh accounts stay on each Jenis PPh (P44); item accounts go to the Kategori Item mapping (C25). **Currency Default is removed**: a new record's Currency starts on the base currency. **The Jenis PPh pointer for PPh 22 collectors is removed**: Jenis PPh is a plain master and nothing pre-fills a line's Jenis PPh. Amends P52 and P23 (default currency). |
| P62 | 30/09/2026 | **The system seed carries starter reference data**, so a fresh or reset installation is usable on day one: currencies **IDR** (base) and **USD**; Satuan **PCS, UNIT, SET, PAK, BOX, LSN, KRT, BTL, GR, KG, ML, L**; Termin **TUNAI, NET7, NET14, NET30, NET45, NET60**; and, as before (P44), Jenis PPh **PPH22, PPH23, PPH23-15**. Each starter row is matched on its label (case-insensitive) and created only when missing, with the next free code; it is user data from then on and never overwritten. Gudang stays unseeded (it is the company's own), and **moves from Master › Referensi to Master › Entitas**. Amends P11 and P43 for these rows. |
| P63 | 30/09/2026 | **The Sales Order's lifecycle is Draft → Diajukan → Open → Ditutup.** *Ajukan* (`SALES_ORDER_SUBMIT`, formerly Konfirmasi) locks the order and freezes its figures and PPN snapshot; a submitted order is **not taken back**. *Setujui* / *Tolak* share one permission, `SALES_ORDER_APPROVE` — whoever holds it may approve, their own order included. *Tolak* (reason) and *Batalkan* (Draft only, reason) are final; a rejected order is re-entered with Salin. *Tutup Pesanan* (`SALES_ORDER_CLOSE`, reason) closes an Open order even with quantity undelivered, and is allowed while it has an issued advance bill; the Surat Jalan will close an order itself once everything is delivered. Labels: Draft · Diajukan · Open · Ditutup · Dibatalkan · Ditolak. The reason of the final step is one column, `status_reason`. Existing Dikonfirmasi orders became Open. **The SO no longer carries a Gudang** — a company's warehouses are its own stores (bahan baku, bahan kemas, …) and the one goods leave from is chosen on the Surat Jalan — **nor a Kirim Diminta date**, which belongs to a delivery schedule derived from the SO (C27). **Mode Harga is asked only when Kena PPN**; an order without PPN is stored Exclude. Each line picks its item from a dropdown like every other field, each item once per order. The expected PPh deduction (*Estimasi Penerimaan*) is a separate box left of the order's figures, because it is information, not part of the document. Supersedes P50's "no Menunggu Persetujuan / Setujui / Tolak" and its lifecycle; amends P52 (Gudang on the SO) and P57 (the SO-cancel guard, now moot: only a Draft is cancelled and only an Open SO takes a bill). |
| P64 | 30/09/2026 | **The advance bill reads like its Sales Order.** Its header shows the order's side in the SO's own sections and places — Customer, Pesanan (with the Sales Order picker), Harga & Pajak — then its own Tagihan section. The **Dasar Uang Muka** card shows the order as **one line**: the bill's Uraian (typed there, printed on the bill), the order's total and its DPP, with the total DPP under it; the value drawn is typed below (% or Nominal), with the room left as the field's help, and the figures in two boxes as on the SO. It follows the simulation's Uang Muka Perizinan. Only an **Open** SO takes a bill (P63). Amends P56's summary strip. |
| P65 | 30/09/2026 | **Every dropdown answers the keyboard, and every percent says so.** Combobox, Select and MultiSelect move a highlight with ↓ / ↑ (Home / End outside a search box), pick with Enter, and close on Esc or Tab; the highlight starts on the current value and follows the mouse. MultiSelect stays open after each pick. **A percent field** (`PercentInput`) shows `%` inside the box after the figure and refuses any keystroke that would take it past 100, so it only ever holds 0–100: discount %, advance %, Jenis PPh tarif, Tarif PPN. |
| P66 | 30/09/2026 | **Penerimaan and Pengeluaran Kas & Bank are one document in one table** (`fin_cash_bank_tx`, direction In / Out), shown as two menus under Finance › Kas & Bank with their own permissions (`CASH_RECEIPT_VIEW` / `_CREATE` / `_EDIT` / `_POST` / `_CANCEL` now; the Pengeluaran set with its first purpose). **Transfer is its own menu**, out of scope for now. Lifecycle **Draft → Posting → Posted**; Batalkan only a Draft; a posted one is corrected by a new document. **Purposes are a catalogue in code** (`cash-bank-purposes.ts`): each names its direction, partner category, the documents it settles and how it posts; the accounts come from Account Mapping (new: *Uang Muka Penjualan*, *PPN Keluaran*, *Beban Bank*) and each Jenis PPh. The first purpose is **Penerimaan Uang Muka Penjualan**: Dr Kas & Bank, Dr Beban Bank, Dr PPh Dibayar Dimuka per Jenis PPh / Cr Uang Muka Penjualan per bill (DPP part, naming the customer), Cr PPN Keluaran; the Cash Bank Book entry is written in the same transaction. **One transaction may settle several documents.** Each line stores what it cleared (*Dilunasi*), its DPP / PPN parts and its PPh per Jenis PPh — the figures the Faktur Pajak Uang Muka and the Bukti Potong will be made from when the Pajak menu is built. **A bill's paid state is read from posted lines** (Belum Dibayar / Sebagian / Lunas) until the open items are built after payment (C22), and **a bill a posted receipt settled refuses Batalkan**. Rupiah only; no overpayment. Closes C3's modelling question. |
| P67 | 30/09/2026 | **Tujuan, then Partner, decide what one transaction may settle**: only documents of the purpose's kind, owed by that one partner. Once both are chosen, **every open document of the partner is listed with a tick box**; a ticked one starts on its full Sisa, and lowering *Dilunasi* makes a partial payment. *Dana Diterima* follows the ticked documents until the user types it; **Alokasikan Dana** then spends the typed money on the ticked documents oldest first, leaving the rest open. The document posts only when Σ Dilunasi = Dana Diterima + Biaya Bank + Σ PPh; an unexplained difference is named and refused. PPh shares are positional and cumulative (`tax_concept.md` §7.5), with a *Potong PPh* switch per line (P60). |
| P68 | 30/09/2026 | **A bank charge on a receipt is the company's.** Typed once per transaction, it goes to Beban Bank and still clears the bills; leaving it out keeps the difference open on the bill, which is how a customer is made to bear it. No tolerance rule for now. |
| P69 | 30/09/2026 | **One Bukti Potong per bill, per payment, per Jenis PPh** — the unit the customer's BPPU refers to in Coretax (one base document per slip). A receipt settling two bills withheld under PPh 23 yields two slips; a bill paid in two instalments yields one per instalment. Amends P59's "one bukti potong per payment per Jenis PPh". |
| P70 | 30/09/2026 | **Numbering: `BKM/YYYY/MM/NNNN` for every Penerimaan, `BKK/…` for every Pengeluaran**, cash or bank alike. |
| P71 | 30/09/2026 | **The open-item concept applies to AR as AR items**, in tables of its own (`fin_ar_item`, `fin_ar_ledger`); AP will have its own. The mainstream shape: the **Invoice is the main item and the Uang Muka a special one**. **Shipment creates no Piutang** — the Surat Jalan posts HPP / Persediaan only (P18); Piutang is born at the Faktur Penjualan. Two types for now, shown as **Uang Muka** and **Invoice**; the type is how items are told apart. Each item stores its direction (Invoice raises Piutang Usaha, Uang Muka lowers it) without showing it. Wording: **AR Item**, **Buku Piutang** (the ledger), **Piutang Usaha** (the position). The AR items are a book, like the journal and the Cash Bank Book: kernel imports only, called by the documents inside their posting transaction. Amends P25: partner positions are also kept per document in AR items, which reconcile with the General Ledger. |
| P72 | 30/09/2026 | **An AR item holds its own balance, and Buku Piutang is append-only.** One table for the item and its balance: `current_balance` equals the sum of the item's Buku Piutang entries, written in the same transaction as each. **There is no allocation step or table**: a payment moves an Invoice item directly (event *Pembayaran*, naming the receipt), and a Faktur uses its order's Uang Muka at its own posting (event *Dipakai Invoice*, naming the Faktur and the Invoice item that took it). An item never goes below zero. **No reversal event**: a correction is a new document (§2 rule 7). |
| P73 | 30/09/2026 | **What each item is worth.** An **Uang Muka** item is created by a posted receipt, one per bill per receipt, at the bill line's **DPP part** — the amount the Uang Muka Penjualan account was credited with — so the items reconcile with that account; it names the receipt, the bill and the Sales Order. An **Invoice** item is created by the Faktur at the **net Piutang** (after the advances it uses) with its due date, reconciling with the Piutang account. **An invoice uses only its own Sales Order's Uang Muka** (S22): the Faktur Pajak Pelunasan names the Faktur Pajak Uang Muka of that order, and a leftover is refunded, not moved. Closes C22. The advance *bill* stays outside the AR items (a request, like SAP's noted item); its Belum Dibayar / Sebagian / Lunas keeps reading the receipt lines, in the bill's gross terms. Existing posted receipts were backfilled into Uang Muka items by the migration. |
| P74 | 30/09/2026 | **Only Uang Muka and Invoice items for now.** Refund of a leftover advance, Nota Retur, DN/CN and unapplied receipts are modelled when they are built; no item type or event is added for them in advance. |
| P75 | 30/09/2026 | **Three AR reports under Finance › Laporan**, each with its own view permission: **Buku Piutang** (one customer over a period: every entry signed on Piutang Usaha, with the position before and after and the open Invoice and Uang Muka behind it), **Umur Piutang** (open Invoice items per customer in the buckets Belum Jatuh Tempo / 1–30 / 31–60 / 61–90 / > 90 days from the due date, beside the Uang Muka still held and the net position, with the open invoices listed) and **Uang Muka Customer** (open Uang Muka items per customer and Sales Order, checked against the Uang Muka Penjualan account in the General Ledger). Each reads Buku Piutang as of its date, so a past date is reported as it stood. |
| P76 | 30/09/2026 | **A receipt line takes the cash actually received; the PPh follows from it**, as the simulation's *Dana Diterima di Bank* does. The user types, per bill, what the customer paid for it (*Diterima*). Money that reaches the bill's remainder less its remaining PPh clears the bill, the gap being the PPh; less money is a partial payment that settles the smallest part whose cash, after its own positional PPh share, is exactly the money, and the rest stays open (`tax_concept.md` §4.5). *Potong PPh* per line (P60) says whether the gap is PPh at all. **The header's money follows from the lines**: Total Diterima = Σ Diterima, Biaya Bank is typed, Dana Masuk ke Bank = Total Diterima − Biaya Bank; there is no typed Dana Diterima and no balance check. **The page shows only the bills being paid**: *Pilih Tagihan* opens the partner's open bills in a dialog (dates, total, paid, sisa, *Pilih semua*, and an optional *Bagikan Dana* that spreads one transfer oldest first), and each line shows only the bill, its Sisa, Diterima, PPh and what is left after it. Supersedes P67's checklist, typed Dilunasi, *Alokasikan Dana* and balance rule; amends P68 (the charge comes off what reached the bank, while the bill is cleared by what the customer sent). |
| P77 | 30/09/2026 | **Buku Piutang holds Invoice items by default; a *Sertakan Uang Muka* switch puts the Uang Muka entries in.** Mainstream ERPs keep a customer's down payments out of the receivables line until they are cleared against an invoice (SAP's special G/L down payments are shown only when asked for; Odoo, NetSuite and Dynamics show unapplied payments and deposits apart from open invoices). So the book's position is Piutang Usaha from invoices, and the Uang Muka still held is stated under it with the net position. The switch is off by default and lives in the URL (`advance=1`). Amends P75. |
| P78 | 01/10/2026 | **The Sales Order of P49–P63 is renamed the Customer Order (CO)**, numbered `CO/YYYY/MM/NNNN`, under Sales › Customer Order (`/sales/customer-order`). It is the commercial agreement — quantity, price, PPN, PPh, address, PO — and stays **the basis of every financial document**: Uang Muka Penjualan and, later, the Faktur Penjualan are drawn from it, and AR items name it. Its rules and lifecycle are unchanged (Draft → Diajukan → Open → Ditutup). The rename is in place: tables `sal_customer_order(_line)`, enum `CustomerOrderStatus`, `sal_advance.customer_order_id`, `fin_ar_item.customer_order_id / _no`, permissions `CUSTOMER_ORDER_*` (role grants kept), document type and audit trail; existing `SO/…` numbers became `CO/…`, while text already written into posted records (journal lines, Cash Bank Book notes, a bill's Uraian) is left as written. The name **Sales Order** passes to the CO's child document (P79). Amends P49–P53, P57, P63, P64, P73. |
| P79 | 01/10/2026 | **The Sales Order is a dated part of a Customer Order, released to PPIC** (`sal_order(_line)`, `SO/YYYY/MM/NNNN`, Sales › Sales Order). A Customer Order of 10.000 PCS delivered over five months becomes five Sales Orders of 2.000, each with its own **Tanggal Kirim**, so planning sees what is due when, not the whole agreement. It becomes the basis of material purchasing and, later, of production orders. **Quantity only**: no price and no tax — those, and every financial document, stay on the Customer Order; a Sales Order may later show some of the Customer Order's information for reference. It **posts nothing and is not an AR item** (AR items stay Uang Muka and Invoice, P74). **Rules:** drawn from one **Open** Customer Order, chosen once and locked; it may carry several items, and one Customer Order may have many Sales Orders. Each line takes a quantity of one Customer Order line, once per Sales Order, in that line's unit; the Sales Orders on a line never hold more than the line — every one but a Cancelled or Rejected one counts, a Closed one included — checked at save and at Ajukan with the Customer Order's row locked. The delivery address is any of the customer's addresses, starting on the Customer Order's. A line left without a quantity in the form is simply not part of the Sales Order *(superseded by P81: lines are picked, and a blank quantity is refused)*. **Lifecycle:** Draft → *Ajukan* → Diajukan → *Setujui* (the approval) → **Pra-SO** (may be used to buy material, not to produce) → *Konfirmasi* (moving it along) → **Open** (may also be produced) → *Tutup* (reason, from Pra-SO or Open) → Ditutup. *Batalkan* (Draft, reason) and *Tolak* (Diajukan, reason) are final and give the quantity back. Permissions `SALES_ORDER_VIEW / _CREATE / _EDIT / _SUBMIT / _APPROVE` (Setujui and Tolak) `/ _CONFIRM / _CANCEL / _CLOSE`. **The Customer Order cannot be closed while a Sales Order drawn from it is Draft, Diajukan, Pra-SO or Open.** Its page shows its schedule — per line, what the Sales Orders hold and what is left — and links to each Sales Order. Purchasing and production are out of scope, so Pra-SO and Open differ only in name for now. Closes C27. |
| P80 | 01/10/2026 | **ERP is also deployed on Vercel with Neon, as SIBA is**, in the same Vercel account: project `erp` building `main` of `Sales-Process`, database `erp-postgres` (Neon Free, Singapore like SIBA's), connected for Production and Preview. SIBA's `scripts/with-remote.mjs` and its `db:neon-migrate` / `db:neon-seed` / `db:neon-seed-showcase` / `db:neon-reset` scripts are carried; the launcher also refuses to seed without `ERP_ADMIN_PASSWORD`, so the deployed administrator never gets the development password. Vercel's build keeps the default `npm run build`, whose `prebuild` generates the Prisma client. Amends P32 (Neon scripts not carried) and §4's local-only running; the standalone build stays not carried. |
| P81 | 01/10/2026 | **A Sales Order's lines are picked from its Customer Order in a dialog.** A new Sales Order starts with no lines. *Tambah Item* opens the Customer Order's lines with what helps choose — Qty CO, what other Sales Orders already hold (*Sudah di-SO*) and the *Sisa* — a line with nothing left shown but not pickable. Terapkan makes the ticked ones lines; a line already on the page keeps its quantity, an unticked one leaves. The line itself holds only what the user acts on: the item (read), the quantity with its unit, and its ceiling as a hint. **Every line was picked on purpose, so a blank quantity is refused on its row**, not dropped. Supersedes P79's auto-filled lines and its "a line left without a quantity is not part of the Sales Order". |
| P82 | 01/10/2026 | **A document line shows only what the user acts on, readably.** The line table keeps a floor width and scrolls inside its card rather than squeezing the item column. Quantity and unit share one cell, read as `10 PCS`; the unit is a picker only when the item has more than one, otherwise text. The discount is always a field beside its % / Nominal toggle — empty means no discount, so there is no separate "no discount" state to switch off. Jenis PPh's empty choice reads *Tanpa PPh*. A picker inside a line row opens a list wider than itself (up to 440 px) instead of clipping codes and names. Amount headings align right over their figures. |
| P83 | 02/10/2026 | **One customer purpose settles every kind of open customer document.** When the Faktur Penjualan is built, Penerimaan Uang Muka Penjualan and Pelunasan Faktur become one purpose, **Penerimaan dari Customer**: *Pilih Tagihan* lists the customer's open advance bills and open invoices together, and one receipt — one line on the bank statement — may settle any mix of them. Each line still posts by its document's kind (an advance bill as today, an invoice against Piutang Usaha). Amends P66–P67's one-kind-per-purpose. |
| P84 | 02/10/2026 | **The payment menu never writes anything off.** A receipt records only the money that came and the PPh that explains a gap (P76); what stays unpaid stays open on the bill. Writing off a remainder is the decision of **the document's owner, not the cashier**: it happens when the owner closes the bill or its open item (an advance bill, later an invoice / AR item), with a reason. Its posting (none for an advance bill, whose unpaid part was never booked; a write-off journal for an invoice's Piutang) is designed with the close action. Confirms P68's "no tolerance rule" for the payment menu. |
| P85 | 02/10/2026 | **No overpayment; money that cannot be matched goes to a deliberate purpose.** A receipt line never takes more than its bill's remainder (unchanged). Money the cashier cannot match to a bill — an unknown payer, or a customer paying more than they owe — is recorded on its own purpose, **Penerimaan Belum Teridentifikasi**, posted to a suspense account from Account Mapping, so it has a place in the books by an explicit choice rather than by spilling over a receipt. How it is later cleared to a customer's bills is C31. Amends P74 (unapplied receipts). |
| P86 | 02/10/2026 | **The payment menu's roadmap, compared with mainstream ERPs** (SAP, Dynamics 365, NetSuite, Odoo, Accurate, Jurnal): one engine and one table stay; still to come, in order — the Pengeluaran menu and the Lain-lain purposes both ways (lines straight to accounts, partner optional); printing Bukti Kas Masuk / Keluar and a proof-of-transfer attachment; then, with the Faktur, P83–P85, Pengembalian Uang Muka and the Pajak records; then Transfer (C14), Rekonsiliasi Bank with statement import and Giro Mundur; then, with purchasing, supplier payments, the PPh the company withholds, Setoran Pajak and a payment run; then foreign-currency payments with realised selisih kurs. **Reversal of a posted payment (C29), approval of Pengeluaran (C30) and menu layout and shortcuts (C32) are set aside** by the user. |
| P87–P92 | — | **Not used.** These numbers appear in the desktop work-in-progress AR code (one item per bill, raised by each payment), which contradicts the agreed concept (`Sales-Process-Concept.md` U1, U9: one AR item per bill per receipt) and is parked unmerged on branch `wip-ar-p87-p92`. They are left free so its comments do not collide with a decision here. |
| P93 | 03/10/2026 | **The Delivery Order** (`sal_delivery_order(_line)`, `DO/YYYY/MM/NNNN`, Sales › Delivery Order), the first half of C28: the instruction to the warehouse. **Its header names one Customer Order; each line is a quantity of one line of that order's Sales Orders**, so one Delivery Order may ship from several Sales Orders of the same Customer Order. Only **Open** Sales Orders are shipped from (a Pra-SO may only buy material). **One warehouse (Gudang) and one delivery address per Delivery Order**, both on its header — the warehouse is chosen here, no longer on a Surat Jalan (amends P63); the address may be any of the customer's and starts, with the ship date (*Tanggal Kirim*), on the first Sales Order picked. Lines are picked in a dialog showing Sales Order, due date, Qty SO, *Sudah di-DO* and *Sisa*, as P81; a blank quantity is refused on its row. The Delivery Orders on a Sales Order line never hold more than the line — every one but a Cancelled one counts, a Closed one included — checked at save and at Terbitkan with the Customer Order's row locked. **Lifecycle, no approval:** Draft → *Terbitkan* → Diterbitkan → *Tutup* (reason) → Ditutup; *Batalkan* (Draft only, reason) is final and gives the quantity back. Permissions `DELIVERY_ORDER_VIEW / _CREATE / _EDIT / _ISSUE / _CANCEL / _CLOSE`. **It posts nothing**: no journal and no stock movement; the Delivery Note will. **A Sales Order cannot be closed while a Delivery Order drawing on it is Draft or Diterbitkan.** The Sales Order's page shows *Perintah Kirim* — per line what the Delivery Orders hold and what is left — and links to each. An address a Sales Order or a Delivery Order uses is now protected like a Customer Order's (P53). |
| P94 | 03/10/2026 | **The Delivery Note** (`sal_delivery_note(_line)`, `SJ/YYYY/MM/NNNN`, Sales › Delivery Note), the second half of C28, closing it; designed in `Sales-Process-Concept.md` §5.8 and U11–U14. **Made from one issued Delivery Order**, chosen once and locked; its Customer Order, customer, Gudang and address are copied from it and shown, never chosen. The user sets Tanggal Kirim (the day the goods leave, not before the Delivery Order's date), No. Kendaraan, Pengemudi and Catatan, and picks lines from the Delivery Order in a dialog (*Qty DO*, *Sudah Dikirim*, *Sisa*), as P81; a Delivery Order may leave in several notes, and the notes on a line — Draft and Posted — never hold more than it. **Lifecycle:** Draft → *Posting* → Posted (final: never edited or cancelled; a return will be its own document); *Batalkan* (Draft only, reason) gives the quantity back. Permissions `DELIVERY_NOTE_VIEW / _CREATE / _EDIT / _POST / _CANCEL`. **Posting**, one transaction under the Customer Order's lock: issues each line's base quantity (qty × the Customer Order line's unit factor) through the **inventory module**, which returns the unit cost and the cost (whole rupiah), stored on the line; writes **one journal, Dr HPP / Cr Persediaan per line**, dated Tanggal Kirim — **no Piutang, no revenue, no PPN**; its confirmation shows that journal and names any item without a Harga Pokok and any missing mapping. **The inventory module is a stand-in** (U11): `issueStock(item, warehouse, base qty, date, document)` as real stock will be called, backed by two **temporary** tables only it names — `tmp_item_cost` (one Harga Pokok per item per base unit, kept in **Master › Sementara › Harga Pokok (Sementara)**, `ITEM_COST_VIEW` / `_EDIT`) and `tmp_stock_movement` (one row per issue, as a stock card); stock is always sufficient; an item without a Harga Pokok refuses posting; a change applies to later issues only. `m_item` gets no cost column; when stock is built the contract stays and the temporary tables go. **Accounts** come from Account Mapping's new card *Pengiriman Barang* — *Account HPP* and *Account Persediaan* — until the Kategori Item mapping (C25, U12). **Delivered quantity is stored on the order lines** (`delivered_qty` on Sales Order and Delivery Order lines), written by posting through each module's own function, because a module may not read the Delivery Note's tables (the mainstream "qty delivered" on the order line). With it, **a Delivery Order and a Sales Order close themselves once every line is delivered** (status Ditutup, no reason, audit event *Ditutup — seluruhnya terkirim*), and **closing either by hand releases what never left**: a closed Delivery Order holds only its delivered quantity on the Sales Order line, a closed Sales Order only its delivered quantity on the Customer Order line (U14; replaces "a closed one keeps its whole quantity" of P79 and P93). **A Delivery Order cannot be closed while a Delivery Note on it is Draft.** The Delivery Order's page shows *Pengiriman* (per line Qty DO / Dikirim / Sisa, and the notes); the Sales Order's *Perintah Kirim* gains *Terkirim*. An address a Delivery Note uses is protected (P53). Amends P18 (placeholder cost → the stand-in's Harga Pokok) and P63 (Gudang chosen on the Delivery Order, P93). |
| P95 | 04/10/2026 | **The Delivery Note picks stock by lot** (`Sales-Process-Concept.md` U15). **Every Barang with Kelola Stok leaves by lot**: its Delivery Note line holds picks (`sal_delivery_note_pick`: lot, quantity in the line's unit, and the lot number and expiry copied as printed), each lot once, together never more than the line. **A Draft may be picked in part; Posting needs every such line picked in full**, and its confirmation names the lines that are not and keeps *Ya, Posting* disabled (as for a missing Harga Pokok or mapping). Any other item takes no pick. The form's line gains a **Lot** column: *Pilih Lot* opens the item's lots in the note's warehouse, earliest expiry first, with a quantity each and *Isi FEFO* to put the rest on the earliest; a lot expiring before Tanggal Kirim is flagged, not refused. **The lots come from the inventory module** — today a stand-in lot list, **`tmp_stock_lot`** (lot number and expiry per item and warehouse, expiry required when the item has Memiliki Kadaluarsa, **no quantity**: stock stays always sufficient), kept in **Master › Sementara › Lot (Sementara)** (`STOCK_LOT_VIEW` / `_EDIT`; add, deactivate, reactivate). A pick names its lot by id **without a foreign key**, so real stock can replace the list behind the same contract. An inactive lot is no longer offered and a Draft that picked it does not post until changed; the stored note still reads it. **At Posting each pick is issued on its own** — `issueStock` takes the lot, and `tmp_stock_movement` gains `lot_id` / `lot_no`, one row per lot — and stores its cost; the line's cost is the sum of its picks'. The Faktur still takes the line whole. |
| P96 | 04/10/2026 | **The AR item takes its agreed shape** (`Sales-Process-Concept.md` U1, U9), the first step of the Faktur Penjualan. **Every item is numbered `ARI/YYYY/MM/NNNN`** in the month of its date. **Its source is the document it is about** — the advance bill for an Uang Muka, the Faktur for an Invoice — and **what created it is named only by its Create entry** (the receipt for an Uang Muka); `ref_doc_type_id`, `ref_doc_id`, `ref_no` and `customer_order_no` are dropped, and `customer_order_id` stays as the settlement scope. **An item carries its own tax document's figures** (`tax_dpp`, `tax_dpp_other`, `tax_ppn`, `tax_invoice_no`): an Uang Muka its Faktur Pajak Uang Muka — the receipt line's DPP and PPN parts, and DPP Nilai Lain by the chain on that DPP at the bill's snapshot; none for a bill without PPN. One item per bill per receipt stays. The migration moved existing items to the shape (source → the bill, numbers in date order, tax figures from their receipt lines). The AR reports show the item number, the bill, the receipt and the Customer Order, whose number the report page composes from the order module (§3.1). Amends P71–P73. |
| P97 | 04/10/2026 | **The Faktur Penjualan** (`sal_invoice(_line, _advance_deduction)`, `INV/YYYY/MM/NNNN`, Sales › Faktur Penjualan), built as planned in `Sales-Process-Concept.md` §9 (U16–U22). **One Customer Order per Faktur**, Open or Closed, chosen once and locked; customer, Termin, Kena PPN, mode harga and the PPN snapshot are the order's (U16, U18, U20). **Its lines are whole lines of the order's posted Delivery Notes**, picked in *Pilih Surat Jalan* (grouped by note, a note or a line at a time), each billed by at most one live Faktur (U17); a line is priced from its order line — a percent discount on the quantity billed, a nominal one shared by quantity, and **the bill that completes an order line takes what is left of its amount**, so the Fakturs of a line add up to it exactly. **Dates (U19):** Tanggal Faktur is typed (the journal date, not before the latest Tanggal Kirim); **Tanggal Pajak** is the latest Tanggal Kirim of the notes billed, and **Jatuh Tempo** is that date plus the order's Termin days. The billing address is any of the customer's (starting on one flagged Penagihan); Rekening Pembayaran is a rupiah bank, printed. **Uang Muka (U8):** *Pilih Uang Muka* lists the order's open Uang Muka AR items (number, receipt, bill, faktur pajak no, balance, what other Draft Fakturs reserve); the DPP used is typed per row, up to what is free of the item and in total up to the Faktur's DPP; a Draft reserves it. **Arithmetic** (`computeInvoice` in `sales-tax.ts`): the Uang Muka used is shared over the lines by DPP (largest absorbs), and each line's PPN is the chain on its DPP after the advance, so the document is the sum of its lines (P60) and PPN is on the net DPP (U7). **Lifecycle:** Draft → *Posting* → Posted (final); *Batalkan* (Draft, reason) frees its lines and Uang Muka. Permissions `SALES_INVOICE_VIEW / _CREATE / _EDIT / _POST / _CANCEL`. **Posting**, one transaction under the order's lock: rechecks everything, writes **Dr Piutang Usaha (net, naming the customer) · Dr Uang Muka Penjualan per Uang Muka used / Cr Penjualan (full DPP) · Cr PPN Keluaran**, dated Tanggal Faktur, creates the **Invoice AR item** at net Piutang with the due date (none when nothing is left to pay), writes *Dipakai Invoice* on each Uang Muka item naming it, and stores its full and net figures. Its confirmation shows that journal and states any reason it cannot post. **Accounts:** Account Mapping's new card *Faktur Penjualan* — *Account Piutang Usaha*, *Account Penjualan* (U22). **The Customer Order closes itself once fully delivered** (U21): `delivered_qty` on its lines, written through the Sales Order as Delivery Notes post; billing comes after and a closed order is still billed. The Delivery Note shows *Ditagih* per line and the Customer Order its Fakturs, each composed by the page from the invoice module. An address a Faktur uses is protected (P53). Amends §10.2 rule 8 (one posted Surat Jalan → whole lines of several posted Delivery Notes of one Customer Order). |
| P98 | 04/10/2026 | **Penerimaan dari Customer** (`Sales-Process-Concept.md` §7.8, U23–U28), the third step of the Faktur and P83 built. **One customer purpose settles advance bills and Fakturs together**: the catalogue's `sales_advance` becomes `customer_receipt` (*Penerimaan dari Customer*), existing receipts renamed by migration with their postings unchanged; the menu stays *Penerimaan*. *Pilih Tagihan* lists the customer's issued advance bills and posted Fakturs with a type badge, oldest due first — the order *Bagikan Dana* spends in. A line names its document by kind (`doc_type`: `sal_advance` / `sal_invoice`) and is typed the same way for both (Diterima, Potong PPh; §7.3). **A Faktur's open amount is its Invoice AR item's balance** (U23), so what settled it before is its total less that balance; **its PPh is per Jenis PPh on its net DPP, after the Uang Muka** (U24), from its lines' Jenis PPh. **Posting a Faktur line** writes Dr Kas & Bank · Dr PPh Dibayar Dimuka / **Cr Piutang Usaha** for all it settles, naming the customer, with no PPN (booked at the Faktur; its DPP / PPN split is stored for information only, U25), records **Pembayaran** on the Invoice item, and keeps one Bukti Potong row per Faktur, per payment, per Jenis PPh (P69); an advance-bill line posts as before. Posting locks the advance bills and the Fakturs' Invoice items before reading them again (U28); Drafts reserve nothing. **The Faktur shows its standing** (U26) — Belum Dibayar / Sebagian / Lunas and *Lewat jatuh tempo*, from its Invoice item — on its page with the receipts that paid it, and in the Faktur list. Closes C3's Pelunasan Faktur. |
| P99 | 04/10/2026 | **The sales invoice is named *Invoice Penjualan*** in the application (menu, pages, buttons, messages, Account Mapping card, permissions' names, document type), so that *Faktur* alone means the **faktur pajak**. Code names (`sal_invoice`, `SALES_INVOICE_*`), the `INV/…` prefix and every posted record are unchanged; the document type is renamed by migration and the seed matches it on its table. Where this file and `Sales-Process-Concept.md` say *Faktur Penjualan* (P97, P98, §9), read *Invoice Penjualan*. |
| P100 | 04/10/2026 | **The Pajak module: Faktur Pajak Keluaran and Bukti Potong PPh as records** (menu Pajak › Dokumen Pajak, `/tax/faktur` and `/tax/withholding-slip`), learnt from the simulation's Faktur Pajak and Bukti Potong pages and built the way the app builds documents. **Made by the posting, never by hand**, in the same transaction: a posted Penerimaan makes a **Faktur Uang Muka** for each advance bill it paid with PPN (dated the receipt, at the line's DPP / PPN, naming the bill and the Uang Muka AR item) and a **Bukti Potong** for each PPh row (one per document, per payment, per Jenis PPh, P69; masa = the receipt's month); a posted Invoice Penjualan makes a **Faktur Pelunasan** when it used Uang Muka, otherwise a **Faktur Normal**, dated its tax date (the latest Tanggal Kirim), carrying its lines with DPP, Uang Muka, net DPP, DPP Nilai Lain and PPN per line, and naming each Faktur Uang Muka it deducts with the DPP deducted (`tax_faktur_ref`). No faktur for a non-taxable document, nor for an Invoice its Uang Muka covered whole (Q10). Numbered `FPK/…` and `BPU/…`. The source modules take an `afterPost` hook that the Server Action fills with the tax module's function, so the dependency stays one way (§3.1). **Every figure is copied and never edited**; the buyer / withholder identity (Tipe, NPWP / NIK, Nama sesuai identitas, the Customer Order's address) is copied at posting. **Lifecycle:** a faktur is *Menunggu Upload* → **Catat Upload** (`TAX_FAKTUR_UPLOAD`: the 17-digit NSFP Coretax gave, unique, and the upload date, not before the faktur) → *Dilaporkan*, final; the NSFP is written back to the Uang Muka AR item and the Invoice (`tax_invoice_no`). A slip is *Menunggu Bukti Potong* → **Catat Bukti Potong** (`TAX_SLIP_RECEIVE`: the BPPU's number and date) → *Diterima*, final. *Terlambat* (a faktur past the 15th of the next month) and *Perlu Ditagih* (a slip past the 20th) are flags, not states. Each register has the simulation's tiles (Menunggu / Terlambat or Perlu Ditagih / Dilaporkan or Diterima) acting as filters. Permissions `MENU_TAX_ACCESS`, `TAX_FAKTUR_VIEW`, `TAX_SLIP_VIEW` and the two above. The receipt and the Invoice link to their tax documents in Referensi. Documents posted before P100 are made by `npm run db:tax-backfill` (idempotent). **Not built:** Coretax XML export, NITKU (C23), faktur pengganti / pembatalan and Perlu Pembetulan (3.8), WAPU and transaction codes (P59). |
| P101 | 04/10/2026 | **The Faktur Pajak and the Bukti Potong are internal records, not a Coretax workflow** (the user: their main function is the company's own record). They stay **documents, one per event** — no report form. **A Faktur Pajak has no lifecycle**: it is complete from the posting that made it, shown *Tercatat*; *Menunggu Upload* / *Dilaporkan* and the locking *Catat Upload* are dropped. The **NSFP is an optional reference**: *Isi NSFP* fills it in with the upload date if known (optional), *Ubah NSFP* corrects it, and emptying it clears it — 17 digits and unique when given; each change is in the history (events *NSFP diisi / diubah / dihapus*) and is written to the Uang Muka item and the Invoice. The figures never change. The register's tiles and filter read *Faktur Tercatat* (with its PPN), *NSFP Belum Diisi* and *Lewat Tanggal 15* (no NSFP past the 15th — a reminder, not a state); its Status column becomes the faktur's kind, and it lists newest first. **The Bukti Potong keeps Menunggu → Diterima**, because a slip in hand is what lets the PPh be credited, and **its number and date may be corrected once received** (*Ubah Bukti Potong*, event *dikoreksi*). Permission `TAX_FAKTUR_UPLOAD` is renamed `TAX_FAKTUR_EDIT` (*Isi / Ubah NSFP*) in place, keeping role grants; `tax_faktur.status` and its enum are dropped and `reported_date` / `reported_by` become `nsfp_date` / `nsfp_by`, keeping what was recorded. Amends P100 and `tax_concept.md` §5.2. |
| P102 | 04/10/2026 | **Performance on the deployed database** (from a QA pass on ±1.400 Customer Orders with their full flow). Every query to Neon is a network round trip, so the rules are about how many a page makes. **(1) The Vercel functions run in Singapore** (`vercel.json`, `regions: ["sin1"]`), beside the Neon database; Vercel's default region is Washington, which put an ocean between every query and the database. **(2) Nested `include`s load in one statement** (Prisma preview feature `relationJoins`): a document page fell from 120+ queries to 15–35, and every page's sign-in check from ±6 to 1. **(3) A saved document's page loads only its own source** — a Sales Order, Delivery Order, Delivery Note or Invoice locks its source once saved, so its view and edit pages no longer load every open Customer Order or issued Delivery Order. **(4) Pickers and lists read ids or numbers before whole documents**: *Invoice Baru* loads only the Customer Orders with an unbilled posted note line; the receipt's *Pilih Tagihan* only bills not yet paid; the Delivery Note's lots are one read for all sources; the document lists name their Customer / Delivery Order by number (`…NumbersByIds`) instead of loading it. Lists still send every row to the browser and page there; that is the next limit as the books grow (§17). |
| P103 | 04/10/2026 | **A Post confirmation's journal comes from a dry run of the document's own posting path**, as the shared design convention says (`knowledge/design-convention.md` §9.1) and as SIBA does (`JournalPreview`, SIBA `c8aca61`). The user's answer **A** to the knowledge base's deviation check: the per-document preview functions built so far (`previewCashReceiptPosting`, `deliveryNotePreview`, `invoicePreview`) compute what posting *would* write separately, so they can drift from what Post actually writes. They are to be replaced by running the posting path inside a transaction that is rolled back, returning its journal lines and any refusal. The confirmation stays as it is to the user, and *Ya, Posting* is still disabled until the preview loads or while a refusal stands. *Built 04/10/2026:* `transitionCashReceipt` / `transitionDeliveryNote` / `transitionInvoice` take `{ dryRun: true }` and throw `PostingDryRun` (`journal.ts`) after the whole posting, the tax `afterPost` hook included; `components/ui/journal-preview.tsx` loads it when the dialog opens, so a Draft's page no longer computes a preview. A refusal is now Posting's own (first) message instead of a list; the Delivery Note dialog no longer lists lots and unit costs beside the journal. Tests prove the preview writes nothing and equals the posted journal. |
| P104 | 04/10/2026 | **A picker narrowed on purpose says why it is empty; an overdraw prints its figures as money.** Carried from SIBA (Knowledge-Base SYNC-PLAN 2A.8, 2A.9). `Combobox` takes `emptyText`, shown while nothing is typed; a search that matches nothing still reads *Tidak ada pilihan yang cocok* (SIBA `98e064e`). The five source pickers use it: Delivery Note (*Belum ada Delivery Order yang diterbitkan*), Delivery Order, Invoice Penjualan, Sales Order and Uang Muka Penjualan, each naming its own rule. *Saldo Cash & Bank tidak mencukupi* formats both figures (SIBA `15d9933`). That an overdraw comes back as a refusal rather than an error is for the Pengeluaran menu, the first document that spends from a Cash & Bank. |
| P105 | — | **Reserved** for the multi-currency sales work (Kurs KMK, Revaluasi Piutang), parked unmerged on branch `wip-multi-currency` on 05/10/2026; recorded here if it lands. P106–P110 are built on `main` without it. |
| P106 | 05/10/2026 | **Documents that serve more than one flow are standalone, chosen by a purpose** (from the user's earlier ERP design, reviewed 05/10/2026). Such a document belongs to no business module: its header names a **purpose** — a catalogue in code, like the cash & bank purposes (P66) — and its **source** by the weak pair `source_doc_type_id` / `source_doc_id` (+ `source_no`); each line names its source line by `source_doc_line_id` (weak) and **carries its own item, unit, factor and quantities**, because a line of another purpose has another source. The purpose decides the source kind, the partner category, which open lines may be picked, how Post books it and what it writes back to the source; the document reaches a source only through the source module's named functions (§3.1). One number series per document whatever the purpose (amended by P109). **Logistics documents deal with quantity and stock cost only — never a selling price or tax**: the value and the tax belong to the invoice (the user's earlier design booked AP and tax at the logistics event; the tax update moves them to the invoice). **The Delivery Note becomes the first one** — `log_delivery_note(_line, _lot)` in a new Logistik menu, its first purpose **`sales_delivery`** (source: an issued Delivery Order), its behaviour unchanged from P94–P95; `purchase_return` follows with purchasing. A Receipt Note (`sales_return`, `purchase_receipt`) comes when Nota Retur or purchasing is built. Payment is already such a document (`fin_cash_bank_tx`). *Built 05/10/2026:* migration `delivery_note_standalone` renamed the tables in place (ids, journals, stock movements, audit trail and Invoice lines kept), dropped the foreign keys to the Delivery Order and Customer Order, and copied item / unit / factor onto every line; the purpose catalogue is `delivery-note-purposes.ts`; the Delivery Order module answers `lockDeliveryOrderScope`, `customerOrderIdsOfDeliveryOrders` and `deliveryOrderIdsOfCustomerOrders`; menu Logistik (`MENU_LOGISTICS_ACCESS`, granted to every role that could see Delivery Notes), route `/logistics/delivery-note`. |
| P107 | 05/10/2026 | **The Sales module holds only orders — Customer Order, Sales Order, Delivery Order. What bills or settles money belongs to Finance**: the advance bill becomes `fin_ar_advance` and the Invoice Penjualan `fin_ar_invoice(_line, _advance_deduction)`, under the Finance menu; code names follow (`ar-advance`, `ar-invoice`), while permission codes, document prefixes and posted records stay as they are (as P99). A Customer Order or a Delivery Note is now another module's document to them, named by id without a foreign key (§3.1). **The tax snapshot stays**: every document still copies price mode, Kena PPN, the PPN rate and the DPP Nilai Lain factor from its order (P60). *Built 05/10/2026:* migration `ar_documents_to_finance` renamed `sal_advance` and `sal_invoice(_line, _advance_deduction)` in place (ids, document types, audit trail and every journal, receipt line, AR item and tax document naming them kept) and dropped their foreign keys to the Customer Order and its lines; `SALES_INVOICE_*` moved to the Finance module (roles that could see Invoices keep `MENU_FINANCE_ACCESS`); route `/finance/invoice/sales`; `lib/erp/ar-advance.ts`, `ar-invoice.ts` and their workflows, actions and tests renamed to match. |
| P108 | 05/10/2026 | **Sales sells in the item's base unit.** A Customer Order line's unit is the item's Satuan Dasar, shown as text, never chosen; the conversions on the Item serve buying. Sales Order, Delivery Order, Delivery Note and Invoice quantities are therefore base quantities. Amends P82 (the unit picker on a sales line). *Built 05/10/2026:* the Customer Order offers each item its base unit only and the server refuses any other (*Penjualan memakai satuan dasar barang*); `uom_id` / `uom_factor` stay on the line (always the base unit, factor 1) so every document downstream keeps reading them. No line in the local or deployed database used another unit, so nothing was converted and no migration was needed. |
| P109 | 05/10/2026 | **Documents with and without PPN are numbered in separate series, in the same table.** A Customer Order without PPN is numbered with the marker **`-NP`** — `CO-NP/YYYY/MM/NNNN` — and every document that follows its tax status does the same: `SO-NP`, `DO-NP`, `SJ-NP` (purpose `sales_delivery`), `ARA-NP`, `INV-NP`. Each is its own monthly series. A Draft Customer Order whose Kena PPN changes takes a number from the other series at its next save. Not affected: Penerimaan (`BKM`, one receipt may pay both), the journal, tax documents (PPN only) and AR items. Amends P15 and P106's one series. *Built 05/10/2026:* `taxSeriesPrefix` in `document-number.ts`; the Customer Order passes its Kena PPN down through the sources each document reads (`SalesOrderSource.isTaxable`, the Delivery Order's and the Delivery Note's sources), and the advance bill and the Invoice use their own copied `is_taxable`. Documents numbered before keep their numbers; no migration. |
| P110 | 05/10/2026 | **Every book entry carries a ledger number; the movements of one posting share it.** Buku Piutang (`fin_ar_ledger`, `BP/YYYY/MM/NNNN`), the Cash Bank Book (`cash_bank_ledger`, `CBL/…` — its existing per-entry number becomes the shared one) and the stock movement (`tmp_stock_movement`, `MS/…`) get `ledger_no` + `line_no`: one number per posting per book, a line per movement, as in the user's earlier design. Existing entries are numbered by migration, grouped by their document. *Built 05/10/2026:* migration `ledger_numbers`; each book's writer takes its position from the posting it belongs to — a document posts once, so the entries naming the same source share its number, the first taking the next in its month's series (read from line-1 rows, whose id order is their number order); an opening balance stands alone. Buku Piutang shows the number under each entry's date; `db:reconcile` gains a 30th check (one number per posting per book, lines 1..n, each number one posting). |
| P111 | 05/10/2026 | **Unit prices are kept unrounded; the Invoice stores its own gross and discount.** A Customer Order line's price, and the Invoice line and faktur line that copy it, are `Decimal(18,6)`, so a price per base unit (P108) loses nothing; every amount made from it — gross, discount, DPP, PPN, total — is still rounded to whole rupiah. Each Invoice line stores its gross, its discount and the order line's discount type and value, and the header their sums, with amount = gross − discount on both; the screen shows a Diskon column and, when there is a discount, Jumlah bruto and Diskon above the DPP. *Built 05/10/2026:* migration `invoice_gross_discount` widened the prices and filled existing lines (gross = qty × price rounded, discount = gross − the stored amount); `formatPrice` in `format.ts` shows a unit price with the decimals it has. |
| P112 | 05/10/2026 | **Partial billing splits gross and discount cumulatively** (`tax_concept.md` §7.5), not by a stored unit discount: an Invoice line takes the order line's gross and discount up to and including what it bills, each rounded once, less those up to what posted Invoices billed before it. So no drift builds between partial Invoices (at most Rp1 at any point), the Invoice that completes the line lands on its stored figures exactly, and an order closed short is billed exactly its share. "Before" counts **posted** Invoices only, in posting order; a Draft's figures are provisional and are worked out again when it posts. Replaces P97's "the bill that completes an order line takes what is left of its amount" and the per-bill proportional share of a nominal discount. A unit discount is not stored: it would itself be a rounded intermediate. `db:reconcile` checks gross, discount and amount of every fully billed order line. |
| P113 | 05/10/2026 | **Settlement PPN is full PPN less the advances' PPN** — the user's answer **C** to the deviation check on `tax_concept.md` §3.5 (U7's net-DPP rule): a second concept, recorded as the choice point `settlement-ppn` of the KB's `accounting/tax-indonesia` 2.1, with `net-dpp` as the main path and **this ERP on `full-less-advance`**. Each Invoice line carries its DPP Nilai Lain and PPN on its **full** DPP; the Uang Muka's DPP and the PPN of the part of each item used are deducted **once, at header level** (the user's choice over per line) — `ppn_amount` = Σ lines' PPN − `advance_ppn_amount`. An item's PPN used is its cumulative share of the item's `tax_ppn` (§7.5, `advancePpnUsed`), so the uses of one advance add up to exactly the PPN its faktur uang muka carries. The advance's DPP is still shared over the lines (§7.4), only for the PPh, which stays on the DPP after the advance per Jenis PPh (§4.4). It **assumes the 12 % rate and the 11/12 factor do not change**: an Invoice whose snapshot differs from an advance bill it deducts is **refused** at save and at Posting (the user's choice). The journal keeps its shape (Cr PPN Keluaran = the net PPN). The faktur pelunasan carries its lines at full DPP and PPN and `advance_ppn` on its header; each `tax_faktur_ref` records `ppn_deducted`. Invoices posted before keep their net-DPP figures (advance PPN 0); the screens show them as posted. Supersedes U7 and P97's "PPN on the net DPP" for this ERP. `db:reconcile` checks the identity and that no advance's PPN is deducted beyond its faktur. |
| P114 | 05/10/2026 | **Stock is valued at moving average, kept as quantity and value; the average is derived** — the design the logistics module is built on, agreed with the user 05/10/2026. **One pool per plant + item (+ variant)** stores only **Q** (quantity, base unit) and **V** (value, whole rupiah); they are the truth. A **receipt** adds its own quantity and value (from its source document). An **issue** of q releases **r = round(V × q / Q)** — multiply first, divide last, in exact decimals, rounded once — and **the issue that empties the pool releases V whole**, so a pool always ends at 0 / 0 and never keeps a stray rupiah; **an issue beyond Q is refused** (no negative stock). **The average V ÷ Q is derived**: shown, cached on the balance row for lists, never multiplied by anything; a unit cost stored on a movement or a document is a description of that movement (its value ÷ its quantity, `Decimal(18,6)`) and is **never read back into a calculation**. Each ledger row stores its quantity and value changes and the balances after them, so Σ value changes = V, and the stock valuation report reads V (= Persediaan in the General Ledger). The pool row is locked while a posting releases from it. **Rules around it:** a backdated movement is valued at the pool as it stands when posted, with no replay (as P37 for cash); a **sales return comes back at the value it left at** (the Delivery Note lot row's stored value), a purchase return leaves at its receipt's value, any difference to a variance account; an increase without a value of its own (opname, a found item) takes round(V × q / Q), and with Q = 0 the user types a value; an invoice price differing from the receipt adjusts V for the part still in stock (Q unchanged) and goes to HPP / variance for the part already issued. **Left for purchasing:** whether free or bonus quantity enters at 0, and the exact split of a price difference. *Built now 05/10/2026 (the parts the stand-in can carry):* unit costs on `tmp_item_cost`, `tmp_stock_movement` and the Delivery Note's line and lot rows widened to `Decimal(18,6)`; the stand-in's cost is round(base qty × Harga Pokok) in exact decimals (a Harga Pokok may carry six decimals); a Delivery Note line's unit cost is derived from its value (Σ lots ÷ base qty). `issueStock` keeps its contract: the real inventory module will answer it with r from the pool. |
| P115 | 06/10/2026 | **The inclusive split, stated** (`tax_concept.md` §3.4): the DPP of an inclusive total is **estimated as Total ÷ (1 + rate × factor)** — universal for any rate and factor — and then **corrected** to the largest DPP whose DPP + chain PPN does not exceed the total, because the chain rounds twice and the rounded estimate can overshoot (a typed 15: estimate 14 gives 16; the split is 13 + 1). This is what `inclusiveSplit` already does (P60); no code change. Harvested into the KB's tax concept 2.2. |
| P116 | 06/10/2026 | **An AR item keeps balances only.** It stores **`original_amount`** — what it was born at, fixed (an Uang Muka its DPP received, an Invoice its face) — beside `current_balance`; **`tax_dpp`, `tax_dpp_other`, `tax_ppn` and `tax_invoice_no` are dropped**. Its tax lives on its tax document: a page that shows an advance's faktur NSFP asks the tax module (`fakturNsfpByArItemIds`), and *Isi NSFP* no longer writes into the AR item. The **Uang Muka item is created only by a payment, at the DPP received** (P73, confirmed): the advance bill creates nothing in the books or the AR items; a receipt line names the **document** it pays (bill or Invoice), and the open amount is read from the bill's posted receipt lines for a bill (a noted item, as SAP's down-payment request) and from the AR item for an Invoice. Amends P96 and U9. |
| P117 | 06/10/2026 | **An Invoice's AR item is born at its face and the Uang Muka it deducts is applied inside its posting**, in three Buku Piutang entries: the Uang Muka item lowered by the **DPP used** (*Dipakai Invoice*, naming the Invoice item), the Invoice item **created at its face** (full DPP + full PPN), and the Invoice item lowered by **the DPP used plus the PPN of that part** (*Uang Muka Diterapkan*, `AdvanceApplied`, naming the Uang Muka item). The two sides differ by the advance's PPN, which was never in Piutang (it went to PPN Keluaran at the receipt). The item is created **always**, even when its Uang Muka covers it whole (it ends at 0). **The journal moves the same way**: Dr Piutang (face) / Cr Penjualan (full DPP) · Cr PPN Keluaran (full PPN); per Uang Muka used: Dr Uang Muka Penjualan (DPP) · Dr PPN Keluaran (its PPN) / Cr Piutang (both) — every account nets exactly as before, and Piutang moves line for line with the Invoice item. A receipt still settles an Invoice on its **net** total against the item's balance, so the Uang Muka applied is never taken for an earlier payment. Invoices posted before keep the item they were posted with (born at net, nothing applied; none when fully covered). Replaces P73's and P97's "Invoice item at net Piutang". |
| P118 | 06/10/2026 | **The Uang Muka's PPN at the Invoice is recalculated from its DPP** (the user's option **b**): the PPN of the part used = the chain on the DPP used so far less the chain on what was used before (§7.5, `advancePpnUsed`), at the Invoice's rates (equal to the bill's by P113's guard). The uses of one advance add up to the chain on its whole DPP. **Accepted limit:** an advance paid in instalments has fakturs uang muka whose PPN is a positional share of the bill, which can differ from the chain on its DPP by Rp1, so the PPN deducted can differ from those fakturs by Rp1. Amends P113 (which shared the stored `tax_ppn`) and the KB option text (tax concept 2.2). |
| P119 | 06/10/2026 | **PPh is calculated when needed, never kept on the open item.** A payment's PPh is the positional share (§7.5) of the document's PPh per Jenis PPh — for an advance bill from the bill, for an Invoice on its **net DPP after the Uang Muka** (§4.4), the advance's PPh having been withheld at its own payment. The AR item records one *Pembayaran* for cash + PPh; the PPh actually withheld stays on the receipt line (`fin_cash_bank_tx_line_wht`), the source of the Bukti Potong and of Dr PPh Dibayar Dimuka. Confirms P76, P98 (U24). |
| P120 | 06/10/2026 | **The stock books** (the user's stock DBML, analysed against SAP, Odoo and ERPNext; lifts P5). **Two books, each a ledger and a balance, written side by side in the posting of the document that moves the goods**, by the inventory module (`inventory.ts`, a book: kernel imports only): **quantity** — `log_stock_ledger` / `log_stock_balance`, one bucket per warehouse, lot and status, never negative — and **value** — `log_stock_valuation_ledger` / `log_stock_valuation_balance`, one moving-average pool per item, company-wide (one company, one valuation area), on P114's rules. Every quantity row has one valuation twin with the same value change. **Only a Barang with Kelola Stok enters the books, always by lot**; an item without it is an expense when acquired and never stocked (the user: such a Barang is not sold), so the inventory refuses to issue one and a Delivery Note line of one cannot post. **Lots** (`log_stock_tracking`) are **unique per item**, not globally (the user's choice over the DBML), made by the receipt that first brings them in, which a later receipt of the same number adds to; expiry is the lot's and must match. **Statuses** are system data (`sys_stock_status`: Tersedia, Karantina, Diblokir); only Tersedia is used today. **Choices against the DBML, confirmed by the user:** value in whole rupiah `Decimal(18,2)` (P114), quantity `Decimal(18,6)`, `posting_date` a date (rows of one day in posting order), no `variant_id` / `location_id` until their masters exist, the ledgers append-only (no `updated_*`), `source_no` beside every weak source pair. Ledger numbers per posting per book (P110): `MS/…` and `MN/…`. Pool before bucket, each row locked (`FOR UPDATE`) while a posting moves it; CHECK constraints keep balances non-negative. **No receiving document yet: stock comes in by `npm run db:stock-inject -- file.csv --apply`** (and `db:neon-stock-inject`), every row through `receiveStock`, each run one source `INJ/YYYY/MM/NNNN` (document type *Injeksi Stok*), all or nothing, **writing no journal**. **The Delivery Note issues from the books**: the lot picker lists the lots with stock in the warehouse and what each holds, *Isi FEFO* fills lot by lot up to what each holds, and Posting refuses short stock naming the lot and both figures; a note whose stock is carried at no value posts without a journal. **The stand-in is dropped** (`tmp_item_cost`, `tmp_stock_lot`, `tmp_stock_movement`, their menus and permissions): posted notes keep their stored costs, lots and journals; lot ids continue after the stand-in's, so a Draft naming an old lot finds none and is re-picked. **Four reports under a new Persediaan menu** (`MENU_INVENTORY_ACCESS`, one view permission each, granted to every role that could see Delivery Notes), read from the ledgers so a past date reports as it stood: **Kartu Stok** (one item, a warehouse or all, a period: movements by date with a running balance), **Saldo Stok** (per item, warehouse, lot and status as of a date), **Kartu Nilai Persediaan** (one item's pool over a period, with the pool and average after each row) and **Nilai Persediaan** (quantity, value and average per item as of a date, against the Persediaan account in the General Ledger). Each warns when a balance table no longer equals its ledger. `db:reconcile` gains four stock checks. Amends P5, P18, P94, P95. |
| P121 | 06/10/2026 | **The purchasing module is planned and agreed in `Purchasing-Concept.md`** (B1–B33), mirroring sales with the roles reversed: **Purchase Request** (Barang / Jasa, base unit, Tanggal Dibutuhkan per line, Draft → Open with no approval) → **Purchase Order** (from Open requests only; one supplier; the sales tax arithmetic; another unit allowed; **PR lines of one item and unit merged into one PO line** with a link table recording each request's share, earliest need first, partial or exceeding; approval Ajukan → Setujui) → **Receipt Note** (standalone, purpose `purchase_receipt`, one PO each; Kelola Stok lines enter the stock books **split into lots made here**, every other Barang line and every **Jasa** line (service acceptance) is an expense; Dr Persediaan / Beban / Cr *Barang Diterima Belum Ditagih* at the PO's DPP) → **Uang Muka Pembelian** (the AR bill mirrored) → **Pengeluaran Kas & Bank** (*Pembayaran ke Supplier*, `BKK/…`, advance bills and invoices together) → **Invoice Pembelian** (whole lines of one PO's posted receipts, **always at the PO price — no invoice without a receipt and no adjustment**, the PO's advances deducted as P113 / P117 / P118; the supplier's total typed at the foot and **the difference posted to *Selisih Tagihan Supplier* within a tolerance** — a System Default, default Rp 100 — and **refused beyond it**, PPN Masukan and PPh staying ours) → **AP items / Buku Hutang** and their three reports. **The company's PPh 23 is booked at the invoice** (at payment for an advance), at 100 % higher without an NPWP — `tax_concept.md` §4.3b, the deviation check's option **B**, because the withholder knows the figure at the invoice and the law makes it due at the earliest of payment, accrual or due date. **Accounts per Kategori Item** (Persediaan, HPP, Beban), falling back to Account Mapping, closing C25. No correction of any kind on our own documents; the tax module (Faktur Pajak Masukan, Bukti Potong issued) is out of scope. Built in the eight steps of its §12, each recorded when it lands. |
| P122 | 06/10/2026 | **Purchasing, step 1 — the masters** (`Purchasing-Concept.md` B1–B5a). **A Jenis PPh belongs to one side** (the user; Odoo's tax usage, SAP's separate customer and vendor withholding codes, Accurate): a **Penggunaan** *Penjualan* / *Pembelian* chosen at creation (`ref_withholding_tax.usage`), its one account renamed `account_id` — *PPh Dibayar Dimuka* (asset) for sales, *Hutang PPh* (liability) for purchases; existing rows became sales ones; a Customer Order offers and accepts only sales Jenis PPh; the seed adds **PPH23-BELI** 2 % (matched on its label). Amends P44 and the concept's B4 (one record with two accounts). **Supplier is switched on** (migration and seed; ends P41's switch-off) and a supplier carries **purchase defaults** in a *Pembelian* tab — Termin and Mode Harga (`m_partner.purchase_term_id / purchase_price_mode`), as P51. **Account Mapping gains a *Pembelian* card** — Barang Diterima Belum Ditagih, Hutang Usaha, Uang Muka Pembelian, PPN Masukan, Selisih Tagihan Supplier — and **System Default a *Pembelian* card** with *Toleransi Selisih Tagihan Supplier*, seeded at Rp 100. **Accounts per Kategori Item** (`acc_item_category_account`, Accounting › Pengaturan › *Account Kategori Item*, on the Account Mapping permissions; closes C25): Persediaan, HPP and Beban for a Barang category, Beban only for a Jasa one, each postable, active and a leaf; an account a category uses cannot be deactivated. **The Delivery Note posts each item to its category's HPP and Persediaan, falling back to Account Mapping's** *Pengiriman Barang* card where the category names none, so nothing that posted before changes. The *Pembelian* menu arrives with the Purchase Request (step 2). |
| P123 | 06/10/2026 | **Purchasing, step 2 — the Purchase Request** (`pur_request(_line)`, `PR/YYYY/MM/NNNN`, `Purchasing-Concept.md` B6–B8). **Two menus over one table**, Pembelian › Permintaan › *Purchase Request Barang* and *Purchase Request Jasa* (`/purchasing/request/goods`, `/service`); a request holds one kind, fixed at creation. Lines take items of its kind marked Dapat Dibeli, **in the item's base unit**, with a **Tanggal Dibutuhkan per line** (not before the request; the header's date is the default) — one item may be asked for on several dates, never twice for one. Header: Tanggal, Dibutuhkan, Peminta (free text), Gudang Tujuan (Barang only), Catatan. **No supplier, price or tax.** **Lifecycle without approval:** Draft → *Ajukan* → Open → *Tutup* (reason) → Ditutup; *Batalkan* (Draft, reason) is final. **It closes itself once every line is fully ordered** (event *Ditutup — seluruhnya dipesan*): `ordered_qty` per line is written by the Purchase Order through `recordPurchaseRequestOrdered`, and may exceed the line (B15). Posts nothing. Menu Pembelian (`MENU_PURCHASING_ACCESS`), permissions `PURCHASE_REQUEST_VIEW / _CREATE / _EDIT / _SUBMIT / _CANCEL / _CLOSE`. One number series (no `-NP`: a request carries no tax). |
| P124 | 06/10/2026 | **Purchasing, step 3 — the Purchase Order** (`pur_order(_line)`, `pur_order_line_request`, `PO/…` and `PO-NP/…`, `Purchasing-Concept.md` B9–B16). **Two menus over one table**, Pembelian › Pesanan › *Purchase Order Barang* / *Jasa* (`/purchasing/order/goods`, `/service`), one kind per order. **One supplier**, Termin and Mode Harga starting on its purchase defaults (P122); Tanggal Kirim Diharapkan, Gudang Tujuan (Barang, optional), No. Penawaran Supplier. **Kena PPN only for a PKP supplier.** **Lines come only from Open Purchase Requests** of the order's kind (*Tambah dari PR*: request, Dibutuhkan, Qty PR, Sudah di-PO, Sisa); **request lines of one item join one line in its base unit** (B9), whose unit may then be any of the item's conversions (B14); a line must cover at least one request line, each request line once per order. **The line's base quantity is shared over its requests earliest Tanggal Dibutuhkan first**, stored in `pur_order_line_request.base_qty`; what goes beyond them is shown *melebihi PR* and belongs to no request (B15). The Customer Order's tax arithmetic (B11); Jenis PPh only of usage *Pembelian*, **doubled for a supplier without an NPWP / NIK** (B12, `purchaseWithholdingRate`), shown in *Estimasi Pembayaran*. **Lifecycle** Draft → *Ajukan* → Diajukan → *Setujui* → Open → *Tutup Pesanan* → Ditutup; *Tolak* and *Batalkan* final, with a reason. **A Draft reserves nothing; Ajukan** locks the requests, rechecks (a request no longer Open refuses it), recomputes the shares and writes them to the request lines (`recordPurchaseRequestOrdered`), so a fully ordered request closes itself; **Tolak gives every share back and Tutup gives back what was never received**, latest need first, reopening a request that had closed itself (event *Dibuka kembali*). Permissions `PURCHASE_ORDER_VIEW / _CREATE / _EDIT / _SUBMIT / _APPROVE` (Setujui and Tolak) `/ _CANCEL / _CLOSE`. Posts nothing. `received_qty` and closing on full receipt come with the Receipt Note. No Salin yet. |
| P125 | 06/10/2026 | **Purchasing, step 4 — the Receipt Note** (`log_receipt_note(_line, _lot)`, `RN/…` and `RN-NP/…` following its PO, Logistik › Receipt Note, `Purchasing-Concept.md` B17–B22). **Standalone** (P106), purpose `purchase_receipt`, source **one Open Purchase Order** by the weak pair, chosen once and locked; many notes per order. Header: Tanggal Terima (not before the PO), **Gudang** (Barang, starting on the PO's Gudang Tujuan; none for a Jasa receipt), No. Surat Jalan Supplier, Catatan. Lines picked from the PO (*Qty PO*, *Sudah Diterima*, *Sisa*) in the PO line's unit; **no over-receipt** — Draft and Posted notes hold their quantity. **A Kelola Stok line comes in as one or more lots made here** (lot number typed, or generated at posting as `<RN number>-<line>-<seq>`; expiry required at posting for Memiliki Kadaluarsa; together exactly the line to post); **any other Barang and every Jasa is an expense** (the service acceptance). **Value = the cumulative share of the PO line's DPP** for the quantity received after what posted receipts brought in (`cumulativeShare`, P112's rule), each lot the cumulative share of its line; PPN never enters. **Posting**, under the PO's lock: `receiveStock` per lot (the supplier as the lot's source partner), **Dr Persediaan** (the Kategori Item's, else Account Mapping's) **or Dr Beban** (the Kategori Item's; refused without one) **/ Cr Barang Diterima Belum Ditagih** naming the supplier, dated Tanggal Terima; the confirmation shows it by dry run (P103). It writes `received_qty` on the PO lines through `recordPurchaseOrderReceived`, and **a PO fully received closes itself** (*Ditutup — seluruhnya diterima*). **A PO with a Draft Receipt Note cannot be closed by hand.** Permissions `RECEIPT_NOTE_VIEW / _CREATE / _EDIT / _POST / _CANCEL`. The PO's page lists its Receipt Notes and shows what each line received. |
| P126 | 06/10/2026 | **Purchasing, step 5 — Uang Muka Pembelian** (`fin_ap_advance`, `APA/…` and `APA-NP/…`, Finance › Uang Muka › *Uang Muka Pembelian*, `/finance/advance/purchase`, `Purchasing-Concept.md` B23): **the AR advance bill mirrored** (P58) — code `ap-advance.ts`, its workflow, actions, form and list derived from the AR ones with the other side's words. Drawn from one **Open Purchase Order** (`purchaseAdvanceSources`, the PO module's answer), chosen once and locked; supplier, price mode, Kena PPN and the PO's frozen PPh rates (doubled without an NPWP, B12) follow from it. One value typed as % or Nominal in the PO's price mode; PPN by the chain; the PPh estimate per Jenis PPh shown as *Estimasi Pembayaran*. The bill keeps the supplier's proforma number (*No. Tagihan Supplier*) instead of a bank to print. **The PO's value caps its live bills**, checked under the PO's lock. Lifecycle Draft → ***Catat*** → Diterbitkan; *Batalkan* (Draft or Diterbitkan, reason) refused once a posted payment settled it — the cash & bank module answers, as for the AR bill. **Posts nothing.** Permissions `PURCHASE_ADVANCE_VIEW / _CREATE / _EDIT / _ISSUE / _CANCEL`. Paying it is step 6. |
| P127 | 06/10/2026 | **Purchasing, step 6 — AP items and the Pengeluaran Kas & Bank** (`Purchasing-Concept.md` B24–B26, B32). **AP items** (`fin_ap_item`, `API/…`) and **Buku Hutang** (`fin_ap_ledger`, `BH/…`, P110) are the AR items mirrored — `ap-item.ts`, a book (kernel imports only); an item keeps balances only (P116), the Uang Muka born by a payment at its DPP, the Invoice by the Invoice Pembelian (step 7); item type, direction and event reuse the AR enums. **The Pengeluaran** is the Out half of the one cash & bank document (P66) — same tables, written by `cash-payment.ts` beside `cash-bank-tx.ts` as one module — under Finance › Kas & Bank › *Pengeluaran* (`/finance/cash-bank/payment`, `BKK/…`, permissions `CASH_PAYMENT_VIEW / _CREATE / _EDIT / _POST / _CANCEL`), its form, list and picker mirrored from the receipt's. Its first purpose, **`supplier_payment`** (*Pembayaran ke Supplier*), settles AP advance bills now and Invoices Pembelian from step 7 (P83 mirrored). **A line takes the cash paid**; the PPh **the company withholds** explains the gap by the receipt's rule (P76); *Potong PPh* per line; the bank charge is the company's and **leaves the bank with the payment** (*Dana Keluar dari Bank* = paid + charge). **Posting an advance-bill line**: **Dr Uang Muka Pembelian** (its DPP part, naming the supplier) · **Dr PPN Masukan** · Dr Beban Bank / **Cr Kas & Bank** · **Cr Hutang PPh** per Jenis PPh (its account, P122), the Cash Bank Book Out in the same transaction — **an overdraw is refused** (*Saldo Cash & Bank tidak mencukupi*, P104) — and an **AP item Uang Muka** per bill per payment at its DPP part, scoped to its PO. A paid bill refuses Batalkan (the same `settledDocumentRefusal`, its message now *melalui Kas & Bank*). The Bukti Potong the company issues is out of scope (the tax module, B33). A Penerimaan link that names a Pengeluaran is sent to its page. |
| P128 | 06/10/2026 | **Purchasing, step 7 — the Invoice Pembelian** (`fin_ap_invoice(_line, _advance_deduction)`, `PI/…` and `PI-NP/…`, Finance › Invoice › *Invoice Pembelian*, `/finance/invoice/purchase`, `Purchasing-Concept.md` B28–B31). **One Purchase Order** (Open or Closed), chosen once and locked; its lines are **whole lines of that PO's posted Receipt Notes**, each billed by at most one live invoice, **always at the PO price**: a line's DPP is its receipt's value (the PO's DPP for the quantity, already cumulative), so **Barang Diterima Belum Ditagih clears exactly** — no invoice without a receipt, no price adjustment (B29a). The supplier's document: **No. Invoice Supplier** (required; one live invoice per supplier number — the duplicate guard), Tanggal Invoice Supplier (**Jatuh Tempo** = it + the PO's Termin), No. Faktur Pajak Supplier (optional reference); our Tanggal is the journal date, not before the latest receipt. **Total Tagihan Supplier** (optional) is compared with our total (net DPP + PPN): the difference goes to *Selisih Tagihan Supplier* **within the tolerance** (System Default, P122); **beyond it the invoice saves but refuses to post**, naming both totals. **Uang Muka** of the PO's AP items picked with the DPP typed, its PPN recalculated by the chain (P113, P118) and refused when the rates differ from the advance's. **The company's PPh is booked here**, per Jenis PPh on the DPP after the advance (B31, `tax_concept.md` §4.3b). Arithmetic `computePurchaseInvoice` in `ap-invoice-workflow.ts` (client-safe, `computeInvoice` beneath). **Posting**, under the PO's lock: Dr Barang Diterima Belum Ditagih (full DPP) · Dr PPN Masukan (full PPN) · Dr/Cr Selisih Tagihan Supplier / **Cr Hutang Usaha (face = full DPP + full PPN + difference − PPh)** · Cr Hutang PPh; per Uang Muka: Dr Hutang Usaha (DPP + its PPN) / Cr Uang Muka Pembelian · Cr PPN Masukan; the **Invoice AP item** born at its face with *Dipakai Invoice* / *Uang Muka Diterapkan* (P117 mirrored). **The Pengeluaran pays it** on its AP item's balance in cash only (Dr Hutang Usaha / Cr Kas & Bank, *Pembayaran*), its PPh having been booked here (B27). Its standing (Belum Dibayar / Sebagian / Lunas, Lewat jatuh tempo) shows in the list; the PO's page lists its receipts and invoices. Permissions `PURCHASE_INVOICE_VIEW / _CREATE / _EDIT / _POST / _CANCEL`. |
| P129 | 06/10/2026 | **Purchasing, step 8 — the AP reports and their checks** (`Purchasing-Concept.md` B33), closing the purchasing plan of P121. **Three reports under Finance › Laporan**, the AR reports (P75, P77) mirrored, each with its own view permission: **Buku Hutang** (`REPORT_AP_LEDGER_VIEW`; one supplier over a period, every entry signed on Hutang Usaha — an invoice and an advance used raise it, an advance paid, an advance applied and a payment lower it — with *Sertakan Uang Muka*), **Umur Hutang** (`REPORT_AP_AGING_VIEW`; open Invoice items per supplier in the aging buckets from their due date, beside the Uang Muka paid and the net position) and **Uang Muka Supplier** (`REPORT_SUPPLIER_ADVANCE_VIEW`; open Uang Muka items per supplier and PO, checked against the Uang Muka Pembelian account per supplier). Each reads Buku Hutang as of its date; the data functions live in `ap-item.ts` (the book), the bodies are the AR components with the supplier's words. **`db:reconcile` gains seven AP checks** (43 in all): every AP item equals its entries; Invoice items equal Hutang Usaha and Uang Muka items equal Uang Muka Pembelian, per supplier; **Barang Diterima Belum Ditagih equals posted receipts less posted invoices, per supplier**; PO received quantity equals posted receipts and never exceeds the line; a receipt line billed at most once; no AP advance bill paid beyond its total. |
| P130 | 06/10/2026 | **A starter chart of accounts with its mappings is a seed of its own**, `npm run db:seed-accounts` / `db:neon-seed-accounts` (`scripts/seed-accounts.ts` over `scripts/lib/starter-accounts.ts`): 34 postable accounts under the seeded skeleton for sales, purchasing, stock and tax — the partner accounts naming Customer (Piutang Usaha, Uang Muka Penjualan) or Supplier (Hutang Usaha, Barang Diterima Belum Ditagih, Uang Muka Pembelian) — then **every Account Mapping key**, **each Kategori Item's Persediaan / HPP / Beban** (a Jasa category Beban only) and **each starter Jenis PPh's account** (PPh Dibayar Dimuka for the sales ones, Hutang PPh 23 for PPH23-BELI). Unlike the showcase it is not demo data and may run on a real installation: an account is created only when no account has its name, and a pointer is filled only where it is empty, so a chart the user built keeps every choice. `db:seed` stays system data only (P11). **The showcase runs it first**, then adds the demo banks and, for purchasing, four suppliers with purchase defaults and nine bought items (raw and packaging materials by lot, a Barang without stock, two services). |
| P131 | 06/10/2026 | **Logistik and Persediaan are one module, *Persediaan*** (the user; Odoo's Inventory, SAP's Inventory Management, NetSuite and Accurate keep goods movements and stock reports together). Its groups are **Operasi Gudang** — Receipt Note, then Delivery Note (inbound before outbound) — and **Laporan** (the four stock reports). Routes move from `/logistics/…` to `/inventory/…`, components from `components/logistics` to `components/inventory`; the tables keep their `log_` prefix and the documents stay standalone by purpose (P106). `MENU_LOGISTICS_ACCESS` is dropped: migration `inventory_menu_merges_logistics` gives `MENU_INVENTORY_ACCESS` to every role that held it, and the document permissions move to the *Persediaan* group of the role matrix. **The menu follows the business flow**, as mainstream ERPs order their modules: Dashboard → Penjualan → Pembelian → Persediaan → Finance → Pajak → Accounting → Master → Pengaturan — operations first, then money, tax and the books, with master data and settings last; the role matrix follows the same order. Inside Finance the groups follow the documents' order: Uang Muka → Invoice → Kas & Bank → Laporan. Amends P106, P120, P125. |
| P132 | 07/10/2026 | **A receipt or payment never reads another one; the document it pays carries what it was paid** (the user). Each advance bill keeps **`paid_amount`** (`fin_ar_advance`, `fin_ap_advance`): what posted Penerimaan / Pengeluaran lines settled of it, cash + PPh. A line's `before` — the base of the positional shares that split it into DPP, PPN and PPh (`tax_concept.md` §7.5, unchanged) — is read from it, and the posting adds the line's `settled_amount` to it (`recordSalesAdvancePaid` / `recordPurchaseAdvancePaid`) with the bill locked; it never goes below 0 or above the total (CHECK constraints). An Invoice already worked this way through its AR / AP item's balance. The bill's open amount, its Belum Dibayar / Sebagian / Lunas and its refusal of Batalkan read the bill itself, so `settledByDocuments` and `settledDocumentRefusal` are gone and the advance module no longer takes a guard from the payment module. Same figures as before: migration `advance_paid_amount` backfilled each bill from its posted lines, and `db:reconcile` checks `paid_amount` = Σ posted lines. Amends P66 and P73 (*a bill's paid state is read from posted lines*) and P127. |
| P133 | 07/10/2026 | **One document, one item; the document keeps what it was paid** (`One-Doc-One-Item-Plan.md`, the user's answers D1–D6; **built 07/10/2026**). **One Uang Muka item per advance bill** (D1), born by the bill's first posted payment at its DPP part and raised by each later payment with a new event **`AdvanceReceived`** (*Uang Muka Diterima*) (D2); its `original_amount` is the total received and grows (D3, amends P116 for this type); a unique index on the item's source makes it a rule. **Fakturs Uang Muka are still made at each payment** (D4); an Invoice's deduction from the item is shared over them **oldest first**, `ppn_deducted` positionally, and the PPN used stays the chain cumulative over the bill's item (P118). **The Invoice keeps `paid_amount`** like the advance bill (P132): the receipt reads the document, posts to it and to the item's *Pembayaran* in one transaction, and `db:reconcile` proves `total − paid = item balance` — the user's answer **B** to the deviation check on `ar_ap_open_item_concept.md` §3 (*source documents should not own their outstanding balance*), changing the concept for every project, queued for the KB from cloud. **No data is merged: the database is reset** (D5, the user's consent), and the migration refuses data with two Uang Muka items on one bill. *Built 07/10/2026:* migration `one_item_per_document` (event `AdvanceReceived`, `paid_amount` with CHECKs on `fin_ar_invoice` / `fin_ap_invoice`, partial unique indexes on an Uang Muka item's source); `receiveAdvance` / `payAdvance` in the books; `recordSalesInvoicePaid` / `recordPurchaseInvoicePaid` and `unpaid…InvoiceIds` in the invoice modules; the receipt and the payment lock the document, then its item; the faktur pelunasan's refs drawn oldest first (`positionalShare` in `sales-tax.ts`); several NSFPs per item read joined; `db:reconcile` 48 checks. Supersedes U1 / P73's "one Uang Muka item per bill per receipt" and §10.2 rule 12's wording; amends P96, P116, P132. |
| P134 | 07/10/2026 | **One calculation path for every payment, full or partial** (the user). `settleBillFromCash` no longer branches on "cash clears the bill" or "Potong PPh off": it always estimates Tagihan Terlunasi = round(Diterima × Outstanding / Uang Pelunas), capped at the Outstanding, then checks it and moves it a few rupiah to the smallest part whose cash is exactly the money. Money equal to Uang Pelunas estimates exactly the Outstanding (nothing smaller shares its cash while the PPh is under half the bill), and with the switch off the estimate is the money itself, so every figure is unchanged — proven against the former code on 100.000 random bills and by tests. `tax_concept.md` §4.5 is unchanged (same rule, one way of computing it). `Simulasi-Cash-Bank-Tx.md` shows the full path for the lunas cases too. |
| P135 | 07/10/2026 | **Kartu Stok and Saldo Stok answer two questions — *di gudang mana barang ini ada?* and *barang apa saja di gudang ini?* — as the same item × warehouse cards grouped the other way round** (`Stock-Reports-Plan.md`; SAP's MMBE / MB52, Odoo's group-by, ERPNext's Stock Balance). Both reports take **several Barang and several Gudang as chips** (none = all; `items=`, `warehouses=`) and a **Kelompok** — *Per Barang* | *Per Gudang* (`group=`) — and show the General Ledger's rolled-up blocks with *Buka / Tutup Semua*. **Per Barang:** one block per item with its total (one unit, so it adds up), a row per warehouse. **Per Gudang:** one block per warehouse whose summary is the **count of items** — quantities of different items are never added up — a row per item with its unit. **Saldo Stok:** each row its quantity, the lots behind it folded (expiry, status only when not Tersedia), the row's code opening its Kartu Stok for the month to date (§7.7). **Kartu Stok:** each row a card with awal · masuk · keluar · akhir, opening into its movements; **the running balance is per item per warehouse** — worked out by the report, the ledger storing a balance only per bucket (warehouse, lot, status) — replacing the balance across all warehouses; a card with an opening and no movement stays, one with neither is left out; **no Nilai column** (value is the item's pool, on Kartu Nilai Persediaan); an item is no longer required. **No value per warehouse** (the pool is per item company-wide, P114, P120) and **no Kategori Item filter yet** (the user). The valuation reports are unchanged. No schema change. |
| P136 | 07/10/2026 | **Warehouse locations** (`Warehouse-Location-Plan.md`, the user's answers L1–L6; SAP's per-warehouse bins, Dynamics' *Bin Mandatory*). **A Gudang carries *Gunakan Lokasi*** (`ref_warehouse.use_location`): **off**, every stock row's location is null, as before; **on**, every stock row in it names **one of its own locations**, kept in **`ref_warehouse_location`** — a flat list per warehouse (L2), each with its **own code (`loc.NNNN`), label and name, the name required** (L6), the label unique within its warehouse and **shown as `<gudang>-<lokasi>`**, e.g. `GD-CKR-A-01`, composed in one client-safe place (`warehouse-location.ts`) and never stored. The locations are a **Lokasi** tab on the Gudang form, shown while the switch is on, saved with the Gudang (P38). **Rules:** the switch changes only while the warehouse holds no stock and no Draft Receipt or Delivery Note names it (L1); on needs one active location; a location stock has moved through, or a note names, is never removed, only deactivated; one holding stock is not deactivated. **The stock bucket becomes warehouse · location · lot · status** — `location_id` on `log_stock_ledger` and `log_stock_balance`, the bucket key unique **NULLS NOT DISTINCT** (hand-written in the migration; Prisma declares the `@@unique`) so a warehouse without locations still has one bucket per lot — and **`inventory.ts` enforces the rule** on every receipt and issue (a location of its own, active for goods coming in; none in a plain warehouse). The value pools are unchanged (per item, P114). **Documents:** the **Receipt Note** puts each lot row in a location (L3; a Draft may leave it empty, posting may not; one lot may be split over locations, once in each); a **Delivery Note pick is a lot in a location**, the picker listing each lot in each location with what it holds, FEFO then location; `db:stock-inject` takes a `location` column. Delivery Order, Purchase Request and Purchase Order name a warehouse only. **Reports:** in Saldo Stok and Kartu Stok **Gudang and Lokasi are two columns** on the bucket and movement rows (the location's own label, its name under it; `—` without one); the Kartu Stok balance stays per item × warehouse (P135); no *Per Lokasi* grouping (L5). The table is `ref_warehouse_location` (L4). `db:reconcile` (49 checks) matches buckets on location and gains a check (held stock in a location warehouse names one of its own locations, elsewhere none). Not built: moving stock between locations (C34), a location tree, capacity. |
| P137 | 08/10/2026 | **The Perizinan flow is planned and agreed in `Perizinan-Concept.md`** (Z1–Z23, QZ1–QZ10), from the simulation's Perizinan route. **Internal documents show the full list of permits; external documents carry one description line** (Z1): the **Pengajuan Perizinan** (`sal_permit_request(_line)`, `PRZ/…`, Sales; approval Ajukan → Setujui as the Customer Order; Kena PPN a decision; one Jenis PPh picked per Pengajuan) lists each permit at its estimate, and its **Realisasi** (`RLZ/…`, on the same document) at its real price, permits added; **Uang Muka Perizinan** (`fin_ar_permit_advance`, `UMP/…`) and **Invoice Perizinan** (`fin_ar_permit_invoice`, `INP/…`) are **their own header-only Finance documents** whose one line is their Uraian — **no Item represents a permit or the service**, so the goods invoice line stays free to carry its own item, unit and quantity for Nota Retur. **Jenis Perizinan** is its own reference master (`ref_permit_type`), its *Harga Estimasi Standar* the default of a Pengajuan line, which the user changes freely. Billed **at cost** (the realised DPP is what *Biaya Perizinan* pays, a new lump Pengeluaran purpose `permit_cost`, no tax). **Penerimaan dari Customer** stays one menu and purpose and learns the two documents. **`fin_ar_item.customer_order_id` is replaced by a weak scope pair** (Customer Order or Pengajuan), `tax_faktur` the same. Account Mapping gains a *Perizinan* card. Pengembalian Uang Muka is later. Built in the eight steps of its §13, each recorded when it lands. Amends §10.2 rule 11. |
| P138 | 08/10/2026 | **Perizinan, step 1 — the masters** (`Perizinan-Concept.md` Z2, Z22). **Jenis Perizinan** (`ref_permit_type`, Master › Referensi, `PERMIT_TYPE_VIEW / _CREATE / _EDIT / _ACTIVATE / _DEACTIVATE`): Label, Nama, Kategori (Regulatori · Laboratorium · Sertifikasi · Kekayaan Intelektual), Harga Estimasi Standar (before PPN, optional) and Uraian Default — the starting values of a Pengajuan line. **Account Mapping gains a *Perizinan* card**: Uang Muka Perizinan, Pendapatan Perizinan, Biaya Perizinan; the starter chart (P130) adds the three accounts (Uang Muka Perizinan under 2.1.4 naming Customer, Pendapatan Perizinan under 4.1.1, Biaya Perizinan under 5.1.1) and maps them. The showcase seeds the simulation's seven permits. |
| P139 | 08/10/2026 | **Perizinan, steps 2–3 — the Pengajuan Perizinan and its Realisasi** (`Perizinan-Concept.md` Z3–Z8). `sal_permit_request(_line)`, `PRZ/…` / `PRZ-NP/…`, Penjualan › Perizinan › *Pengajuan Perizinan* (`/sales/permit`), permissions `PERMIT_REQUEST_VIEW / _CREATE / _EDIT / _SUBMIT / _APPROVE / _REALIZE / _CANCEL`. Header as the Customer Order's (customer, address, Termin, Kena PPN, mode harga, PO, salesperson) plus **Produk yang Didaftarkan** and **one Jenis PPh** (sales usage, picked); lines are Jenis Perizinan picked in *Pilih Perizinan*, each once, at an estimate starting on its standard price (grossed up by the chain when Include). **PPN once on the total** (`computePermitTotals` in `sales-tax.ts`). Draft → *Ajukan* (re-check, figures and PPN snapshot frozen) → Diajukan → *Setujui* → **Disetujui** (`Open`); *Tolak* and *Batalkan* (Draft, or Disetujui through a caller's guard) with a reason. **Realisasi on the same document** (`/sales/permit/[id]/realization`): estimates locked, a realised price per permit (0 = not done), permits not estimated added at estimate 0 with a price, Tanggal and Catatan Realisasi, figures `realized_*`; *Realisasikan* gives `RLZ/YYYY/MM/NNNN` → **Terealisasi**, still correctable until an Invoice or a cost payment names it (the action's guard, built with those steps). The page shows Estimasi · Realisasi · Selisih and both figure boxes. Posts nothing. Document type *Pengajuan Perizinan*; an address it uses is protected (P53). |
| P140 | 08/10/2026 | **Perizinan, step 4 — the AR scope** (`Perizinan-Concept.md` Z20). **`fin_ar_item.customer_order_id` is replaced by the weak pair `scope_doc_type_id` / `scope_doc_id`** — the agreement an item is settled within, a Customer Order or a Pengajuan Perizinan — and `tax_faktur.customer_order_id` likewise; migration `ar_scope` moved every existing value to the pair under the Customer Order's document type. `ar-item.ts` takes `scope` when an item is made and its readers return `scopeTable` / `scopeId` beside `orderId` (set only for a Customer Order), so the goods flow reads as before; `advanceItemsForInvoice` filters by `scope: { table, ids }`. The faktur pajak page names its agreement through `documentHref`. `db:reconcile`'s "an invoice uses only its own order's Uang Muka" reads the pair. The goods documents keep their own `customer_order_id`. |
| P141 | 08/10/2026 | **Perizinan, step 5 — Uang Muka Perizinan, paid by the same Penerimaan** (`Perizinan-Concept.md` Z9–Z12, Z19, Z21). **`fin_ar_permit_advance`** (`UMP/…` / `UMP-NP/…`, Finance › Uang Muka › *Uang Muka Perizinan*, `/finance/advance/permit`, permissions `PERMIT_ADVANCE_VIEW / _CREATE / _EDIT / _ISSUE / _CANCEL`): the AR advance bill mirrored (P58) in its own table, header-only (its Uraian is the one line), drawn from one **Disetujui or Terealisasi** Pengajuan's **estimate** through `permitAdvanceSources` (shaped like the Customer Order's advance source), carrying the Pengajuan's one Jenis PPh; the live bills never exceed the estimate under the Pengajuan's lock; the form starts on all that is left. `permit-advance.ts` is `ar-advance.ts` with its source swapped; **the advance screens take a `variant`** (`sales` / `permit`) for their words, routes and actions instead of being copied. **Penerimaan dari Customer settles it** as a third document kind, `fin_ar_permit_advance` (badge *UM Perizinan*): the same rule and posting as a goods bill but **Cr Uang Muka Perizinan** (Account Mapping), its Uang Muka AR item scoped to the Pengajuan (P140), `paid_amount` on the bill (P132), and a **one-line Faktur Uang Muka** scoped to the Pengajuan with the buyer's address from it; `cash-bank-purposes.ts` gains `isAdvanceKind`, `SCOPE_OF_KIND` and `SETTLED_DOC_ROUTE`. **A Pengajuan with a live Uang Muka Perizinan refuses Batalkan** (`liveAdvanceRefusal`, composed by the action). Document type *Uang Muka Perizinan*; a CHECK keeps `paid_amount` within the total. |
| P142 | 08/10/2026 | **Perizinan, step 6 — Biaya Perizinan** (`Perizinan-Concept.md` Z8, Z12–Z14). A new Pengeluaran purpose **`permit_cost`** (*Biaya Perizinan*, Out, `BKK/…`, partner category **Customer** — whose permits they are; the real payee goes in the bank reference) that pays a **Terealisasi or Selesai** Pengajuan's **realised DPP** as a lump, in parts if wanted, never beyond it, with **no tax**: Dr **Biaya Perizinan** (Account Mapping) / Cr Kas & Bank, the Cash Bank Book Out beside, an overdraw refused. The Pengajuan is a third paid document kind, `sal_permit_request`, read through `permitCostDocs` and kept paid by `recordPermitCostPaid` (`cost_paid_amount`, P132). **The realisation is fixed once a live cost payment names it**: `saveRealization` takes the action's guard (`permitCostPayments` from the payment module), the realisation page redirects, and *Ubah Realisasi* is no longer offered. The Pengajuan's page gains *Dokumen Terkait* — its Uang Muka Perizinan and cost payments, linked and never embedded. |
| P143 | 08/10/2026 | **Perizinan, step 7 — Invoice Perizinan** (`Perizinan-Concept.md` Z15–Z18, Z21). **`fin_ar_permit_invoice` + `fin_ar_permit_invoice_advance_deduction`** (`INP/…` / `INP-NP/…`, Finance › Invoice › *Invoice Perizinan*, `/finance/invoice/permit`, permissions `PERMIT_INVOICE_VIEW / _CREATE / _EDIT / _POST / _CANCEL`): header-only, its **Uraian the one line** (*Jasa pengurusan perizinan — \<Produk\> · realisasi RLZ/…*), billing one **Terealisasi** Pengajuan, at most one live invoice each. Its figures are **`computeInvoice` over that one line held in memory** (the realised amount once), so full PPN less the advances' (P113), the advance's PPN by the chain (P118, refused when rates differ) and PPh on the net DPP (P119) apply unchanged; `full_ppn_amount` is stored beside `ppn_amount`. Tanggal Pajak = Tanggal Invoice; Jatuh Tempo = it + Termin; the Pengajuan's Uang Muka items are pre-filled oldest first as far as they reach. **Posting** under the Pengajuan's lock: Dr Piutang (face) / Cr **Pendapatan Perizinan** · Cr PPN Keluaran; per Uang Muka: Dr **Uang Muka Perizinan** · Dr PPN Keluaran / Cr Piutang; the Invoice AR item at face scoped to the Pengajuan with *Dipakai Invoice* / *Uang Muka Diterapkan* (P117); **the Pengajuan → Selesai** (`markPermitRequestInvoiced`); a **one-line faktur pajak** (`createTaxDocsForPermitInvoice`, Settlement / Normal, naming the Fakturs Uang Muka it deducts). The confirmation shows the journal by dry run (P103). **Penerimaan dari Customer settles it** as a fourth kind, `fin_ar_permit_invoice` (*Inv. Perizinan*), exactly as a goods Invoice (`isInvoiceKind`). A live invoice also fixes the realisation (Z8). The invoice header buttons take a `variant`. |
| P144 | 08/10/2026 | **Perizinan, step 8 — reports and checks; the flow is built** (`Perizinan-Concept.md` Z19, Z20, Z23). *Uang Muka Customer* and *Buku Piutang* name each item's agreement by its scope — a Customer Order **or** a Pengajuan (`table:id`), and the Uang Muka report checks the items against **both** Uang Muka accounts once a Perizinan advance is held. **`db:reconcile` (54 checks)**: the Uang Muka check is split per bill kind (Uang Muka Penjualan items against their account, Uang Muka Perizinan items against theirs); the advance-line, item-original and Faktur Uang Muka checks take both advance kinds; new checks for the Uang Muka Perizinan paid amount, the Invoice Perizinan paid amount against its item, a Pengajuan's cost paid against its posted Biaya lines and its realised DPP, and one live Invoice per Pengajuan with Selesai exactly when it is posted. The showcase keeps masters only (the seven Jenis Perizinan, P138); Perizinan documents are made through the application. `tests/permit-flow.test.ts` runs the simulation's scenario 2 end to end. Not built (QZ9): Pengembalian Uang Muka for a leftover advance. |
| P145 | 08/10/2026 | **SIBA's accounting improvements made after the carry are ported** (the user, after comparing the Accounting menu with SIBA `2cc93da`; KB `SYNC-PLAN.md` 2A). SIBA's own distinctions — Company, Budget mapping, subject books — stay out (P9, P10, P25). Ported in SIBA's order, each by a three-way merge of SIBA's change onto ERP's file. **First, the Trial Balance on the chart** (SIBA `c47b420`, `243f887`): laid out on the statements' tree and fold (Tipe → Kategori → Kelompok → Account) with their `StatementTitle`; four columns, Saldo signed by the type's normal balance so a heading is a sum; **no account picker** — one checkbox, *Tampilkan account tanpa saldo* (`?all=1`), lists every active account at nil, the totals unchanged; a nil figure reads `Rp 0`, never a dash; debit ≠ kredit and unbalanced journals are one notice each. The figures stay `trialBalanceReport`'s, which the closing checklist reads. Its parameter set is `period` (SIBA's `company-period` without the Company). The date row is `PeriodRow`, shared by the report filters.
| P146 | 08/10/2026 | **One document screen shape, held by tests** (P145's second port; SIBA `1b21009`, `64e588e`). Two shared components: **`DocumentHeader`** (breadcrumb with the module as plain text, the number + status label from the one status map, *Mode Ubah*, the dirty chip, the actions) and **`Amount`** (a figure in mono). **The Journal** is read, created and edited by one `JournalForm` on the same two cards — the header card with the closing note as its `.fnote`, then *Baris Journal* — with Riwayat on view and edit; `JournalDetail` and `JOURNAL_STATUS_BADGE` are gone; Account and Partner read chip + name; the total row speaks only when the sides differ. Its register gains the `No` column, the *Status:* filter and `.ract` row actions. **The Opening Balance** is on the same two-card shape. `DOCUMENT_SCREENS` in `tests/design-system.test.ts` asserts the shape per document — Journal and Opening Balance today; **an ERP document joins once it uses `DocumentHeader` and `Amount`** (the rest is KB SYNC-PLAN 2B.6) — and no breadcrumb opens with a link. The `ui-audit` skill (`.claude/skills/ui-audit`) screenshots a changed screen beside its reference, the Journal.

---

## 13. Carry-over Map

What comes from SIBA during initialization and in which shape (P22, P23).
**Confirmed** parts are copied unchanged first, then adjusted by the decisions
named. **Awaiting** parts are brought over only after the user confirms (§18.2).
After initialization this table is history: the code here is this project's own.

| SIBA part | Status | Shape |
| --- | --- | --- |
| Accounting: account types / categories / subcategories and seeded skeleton, chart of accounts tree | Confirmed (P23) | No `company_id`; Control Account set by the user (P14, P16) |
| Journal engine, register / detail, manual journal | Confirmed (P23) | Numbering `JV/YYYY/MM/NNNN` (P15, P16) |
| General Ledger, Trial Balance, Laba Rugi, Neraca, Report View chrome | Confirmed (P23) | One company |
| Fiscal Year, periods, posting lock, backdating, Fiscal Year Closing, Opening Balance | Confirmed (P23) | One company; opening balances start empty (P27) |
| Budget Category ↔ account mapping | Not carried (P10) | — |
| `m_partner` | Confirmed (P23) | Evolves as a master (P26) |
| `ref_currency`, `fx.ts`, `currency.ts` | Confirmed (P23) | Multi-currency engine (P13) |
| `m_cash_bank` | Confirmed (P23) | With its book (P31) |
| Users, roles, permissions, RBAC, user & role admin | Confirmed (P23) | Permission catalogue trimmed to what exists |
| System Default (catalogue in code, `sys_setting`) | Confirmed (P23) | Keeps default currency, FX difference account, Laba/Rugi equity accounts — one each; bridge and DN/CN keys dropped (P9, P19). *Split by P61 into System Default and Account Mapping; the default currency gave way to the base currency* |
| Profil Saya | Confirmed (P23) | As is |
| Foundation: shell, `components/ui`, `globals.css`, icons, `format.ts`, sign-in / sessions, audit log and record history, entity registry, error pages, health check, startup check | Confirmed (P29) | As is |
| Partner Category | Confirmed (P30) | Customer and Supplier only, seeded |
| Cash Bank Book, rate layers, their three reports | Confirmed (P31) | Ledger, balance and two reports as is; rate layers and Posisi Layer Kurs removed — moving average instead (P37) |
| Dashboard | Confirmed (P32) | Placeholder page |
| Tests, `run-siba` skill, CI, `truncate-transactions` | Confirmed (P32) | Trimmed to what is carried; skill as `run-erp` |
| Subject books (`sub_ledger`) and their report | Not carried (P25) | — |
| Company, Company access / filter, Funding Request, bridge accounts | Not carried (P9) | — |
| Budget, Budget Month, Budget Category, Purpose, Cash Bank Transaction | Not carried (P10) | — |
| Cash Bank Transfer, Debit / Credit Note | On hold (P19) | — |
| Git: `main` only, small per-feature commits, why-first messages | Adopted (§16, P22) | — |

---
## 14. Do Not Do

Everything in SIBA `CLAUDE.md` §14 that concerns a part carried over applies
here. In addition:

- Do **not** build anything listed in §18 before the user decides it.
- Do **not** add a company table, a `company_id` column, or a company picker.
- Do **not** bring back anything Budget-related.
- Do **not** restyle SIBA's classes or edit `globals.css`'s carried part; add
  to the marked additions block only.
- Do **not** put demo data from the simulation in `prisma/seed.ts`.
- Do **not** post a journal from a non-transaction document (SO, advance bill,
  Pengajuan Perizinan, tax documents).
- Do **not** let a Draft write a book, a journal or a tax document.
- Do **not** add an edit, delete or reversal path to a posted document or a
  posted journal.
- Do **not** compute PPN, DPP Nilai Lain or withholding anywhere but the one
  client-safe tax module, and do **not** round any other way than
  `tax_concept.md` states (P59).
- Do **not** show a figure of another document on a document page; link to it.
- Do **not** write the stock books anywhere but `inventory.ts`, nor bring stock
  in by hand-written SQL: use `receiveStock` / `db:stock-inject` (P120).
- Do **not** write *Uang Masuk* / *Uang Keluar*; it is Penerimaan / Pengeluaran.
- Do **not** put project context in `AGENTS.md` or `CLAUDE.md`; it belongs in
  this file. Do **not** delete either.
- Do **not** edit, move or remove `Initialization/`.

---

## 15. Change Discipline (from SIBA)

1. Read before writing — look at how the simulation behaves before building a
   step, and at how SIBA built the nearest equivalent.
2. Smallest change that works; no speculative abstraction.
3. Reuse existing patterns — registry config, Server Action shape, CSS classes.
4. Small, per-feature commits.
5. Validate (§6) before reporting done.
6. Report files changed, what was verified, what was not, and what is open.
7. Surface conflicts — never resolve them silently (§1.2).
8. Clean up test data by fixture teardown, never by reseeding or reset.

---

## 16. Git / Version Control

- **`main` is the only branch** (SIBA's frozen workflow). The repository was
  initialised on `master`; it is renamed to `main` before the first commit.
- Short imperative subject; body explains **why** and names deliberate
  deviations. Attribution trailers per the session's instructions.
- Never commit `.env`, `node_modules/`, `.next/`, `src/generated/`.
- Commit each completed step straight to `main` and push it (P33).

---

## 17. Current Known Issues

- **Statements name no company.** SIBA's statement title printed the
  Company's label; with one company that name belongs to Company Setting
  (P28), which is not built yet, so the Laba Rugi and Neraca titles omit it.
- **A Cash Bank Book row names its document only in its note.** The book may
  import only the shared kernel, so `sourceDocumentNumbers` in `cash-bank.ts`
  still resolves nothing; a posted receipt writes its `BKM/…` number into the
  entry's note instead.
- **A manual journal keeps the number it was drafted with.** It is numbered
  in the series of the month its draft is dated; re-dating the draft into
  another month does not renumber it.
- **Partners created before P39 have no address and no tax identity.** The
  columns are nullable for them; the next save through the form requires both.
- **An address a Sales Order uses can still be edited in place.** Removing
  it is refused (P53), but changing its street or kelurahan changes what the
  order points at. Decide before the Faktur Pajak prints addresses whether a
  used address becomes read-only.
- **A Customer Order keeps the number it was first saved with**, like a manual
  journal: re-dating a Draft into another month does not renumber it.
- **A Customer Order whose Sales Orders were closed short never closes
  itself** (P97): it closes once every line is delivered, so an order whose
  remaining quantity was released is closed by hand with Tutup Pesanan.
- **A Faktur keeps the number it was first saved with**, like the other
  documents: re-dating a Draft into another month does not renumber it.
- **Sales Orders and Delivery Orders closed before P94 now hold nothing.**
  Their delivered quantity starts at 0, so under the new rule a closed one
  releases its whole quantity (development data only).
- **Stock comes in only by injection** (P120): no receiving document, transfer
  or opname exists yet, and an injection writes no journal, so Nilai
  Persediaan differs from the Persediaan account by what was injected (and by
  the HPP of notes posted under the stand-in, which left no stock rows).
- **A Draft takes no stock** (P120): two Drafts may pick the same lot; the one
  posted second is refused if the stock is gone. Nothing is reserved.
- **A location reads by its current labels everywhere** (P136): relabelling a
  warehouse or a location changes how posted notes and reports show it; only
  the lot number is copied onto a note as printed.
- **Stock cannot move between locations yet** (P136, C34): a lot put in the
  wrong location stays there until a transfer document exists.
- **A backdated stock movement is valued at the pool as it stands when posted**
  (P114, no replay), and the Kartu Stok's running balance, read by date, can
  dip below zero between a backdated issue and the receipt posted before it.
- **The Item master does not require Kelola Stok of a saleable Barang.** The
  user confirmed such an item is not sold; the inventory refuses to issue it,
  but nothing stops it being put on a Customer Order.
- **A Delivery Note keeps the number it was first saved with**, like the other
  documents: re-dating a Draft into another month does not renumber it.
- **A journal names its source as the document type and row id** ("Delivery
  Note #21"), not the document's number, for every source document; the
  journal's description carries the number.
- **A Delivery Order keeps the number it was first saved with**, like the
  Sales Order: re-dating a Draft into another month does not renumber it.
- **A Sales Order keeps the number it was first saved with**, like the
  Customer Order: re-dating a Draft into another month does not renumber it.
- **A paid advance bill cannot be cancelled, but its leftover cannot be
  refunded yet.** Pengembalian Uang Muka is a Pengeluaran purpose still to
  come.
- **The advance bill does not print yet.** A printed bill needs the seller's
  identity (Company Setting, P28) and the bank's account number and holder,
  which `m_cash_bank` does not hold; today the account's name carries them.
- **A receipt handles no overpayment, no foreign currency and no WAPU.** Money
  beyond the ticked bills is refused; a customer marked Pemungut PPN is
  treated like any other (P59: no WAPU yet). Yet the Customer Order's and the
  advance bill's *Estimasi Penerimaan* subtract the PPN such a customer
  collects, so their estimate is money a receipt cannot record today.
- **A tax document is not exported to Coretax.** The faktur pajak is an
  internal record (P101); it is entered in Coretax by hand and its NSFP typed
  back with *Isi NSFP*. An XML export, the faktur pengganti / pembatalan and
  Perlu Pembetulan come later.
- **A tax document copies the buyer as it stood at posting.** A Partner whose
  NPWP is corrected later keeps the old one on fakturs already made.
- **Lists send every row to the browser.** Each register pages on the client
  (P102 measured the Journal list at ±390 KB of HTML for ±1.000 journals,
  growing with every row). Server-side paging is the next step as the books
  grow.
- **Sales Orders and advance bills saved before 29/09/2026 keep their
  floor-era figures.** The P59–P60 rework recomputes a Draft at its next save
  and a document at Ajukan / Terbitkan. Anything already confirmed or
  issued keeps what it was stored with (development data only).
- **An installation seeded before P60 still holds PPH42-SEWA.** The seed no
  longer creates it and never deletes; deactivate it by hand if it is not
  wanted.
- **The deployed database needs a reset before P133's migration.** Its
  migration refuses a bill with two Uang Muka items, which every bill paid in
  instalments before P133 has. The user consented to a reset (D5); it is run
  from their machine: `db:neon-reset -- --confirm`, `db:neon-migrate` is part
  of it, then `db:neon-seed` and `db:neon-seed-accounts`.
- **The closing suite no longer covers a loss.** SIBA proved the loss side on
  the second company; with one company only the profit case remains, until a
  fixture year with a loss is added.

---

## 18. Needs Confirmation

**Nothing here is built until the user decides.** On decision an entry moves
to §12.

### 18.1 Deferred by the user (decided later, at the stated point)

| # | Open item | When |
| --- | --- | --- |
| C3 | **Further purposes** — each new *tujuan* (Pengembalian Uang Muka, Penerimaan / Pengeluaran Lain-lain, …; paying Fakturs is built, P98) with its postings. How purposes are modelled and find their accounts is decided (P66) | When the user instructs each |
| C6 | **Contents of each master** — each further reference master (P26). `m_partner` decided in P39–P42, `m_item` in P46–P48 | When that master is built |
| C23 | **NITKU** — the 22-digit place-of-business identity a faktur names (NPWP + 6 digits, `000000` head office). Proposed: one per billing address, since DJP registers a NITKU at an address and a faktur carries both | When Faktur Pajak is built |
| C14 | **Cash Bank Transfer and Debit / Credit Note** (P19) | Later |
| C29 | **Correcting a posted payment.** No document corrects a posted receipt or payment today (a bounced transfer, the wrong customer, the wrong amount). Proposed: a *Pembatalan* document with its own number that posts the exact opposite journal, Cash Bank Book and AR item entries, leaving the original untouched (§2 rule 7). **Not built until the user confirms it is wanted** | When the user decides |
| C30 | **Approval of Pengeluaran** (maker → checker, perhaps above an amount). Receipts need none | At the very end, after the processes work |
| C31 | **Clearing Penerimaan Belum Teridentifikasi** (P85): how money held in suspense is later moved to a customer's bills once identified (e.g. a receipt whose source of funds is the suspense item instead of a bank), and whether the overpaid part of a known customer's transfer is split onto it in the same transaction or a separate one | When that purpose is built |
| C32 | **Menu layout and shortcuts** — grouping purposes, reaching receipts from the Sales menu, *Terima Pembayaran* from a document, list filters and totals. Deferred so later process changes do not redo it | At the end, when the processes work and the focus is convenience |
| C34 | **Documents that move stock** (P120): a receiving document (opening stock with its journal, and later the purchase Receipt Note), stock transfer between warehouses or statuses, and stock opname / adjustment, each through `receiveStock` / `issueStock`. Until then stock is injected | When the user asks |
| C33 | **Running Neon migrations from a cloud session.** A cloud session cannot reach Neon: its outbound proxy carries HTTPS only, and Prisma's migrate and seed need a raw Postgres connection. Proposed: a GitHub Actions workflow (`.github/workflows/neon.yml`) that runs `prisma migrate deploy` and the seed on every push to `main` touching `prisma/`, plus a manual run (migrate / seed / seed-showcase / reset, the last needing a typed `RESET`), using two repository secrets, `NEON_DATABASE_URL_UNPOOLED` and `ERP_ADMIN_PASSWORD`. Vercel keeps only building (P80). **Noted by the user; not built yet.** Until then migrations run from the user's machine with `db:neon-migrate` | When the user asks |

### 18.2 SIBA parts outside the P23 list

All decided 29/09/2026 (P29–P32). Anything else found in SIBA during
initialization is asked about before it is carried.

---

## 19. Context Maintenance Rules (from SIBA)

- Read this file before substantial work; it is authoritative unless the user
  overrides it.
- Update it in the same change as any durable decision.
- Decisions go into §12; open items into §18 until decided, then to §12.
- Keep §1.5 and §17 accurate. No session narration or task history here.
- Never silently remove or overwrite an established decision; surface the
  conflict first.

---

## 20. Shared Knowledge Base

This project adopts concepts from the central knowledge base at
`D:\Claude Code\Knowledge-Base`, governed by its `PROTOCOL.md`. **What is
adopted, at which version and with which choices, is listed in `KNOWLEDGE.md`**
at the root of this repository.

- **Check at the start of substantial work.** Run
  `node "D:/Claude Code/Knowledge-Base/tools/kb-check.mjs" ERP-Project`.
  If it reports anything other than `ok`, tell the user what changed before
  starting (PROTOCOL §5).
- **No access to `D:\Claude Code\Knowledge-Base`** (a cloud session, another
  machine)? Do not skip:
  - treat `KNOWLEDGE.md` and the copies in `knowledge/` as the adopted rules;
  - still run the deviation check;
  - queue every reusable decision, and every edit to a concept document, in
    `KNOWLEDGE.md` → *Harvest queue* as `Queued from cloud`, in the same
    commit (PROTOCOL §5a).
- **Adopted concept copies live in `knowledge/`**, and that is the copy to
  follow. `Initialization/` holds the frozen originals.
- **Deviation check: never deviate silently.** Before recording a decision or
  writing code that contradicts an adopted concept, or the choice recorded for
  it, **stop**:
  1. Quote the rule.
  2. State the deviation.
  3. Make the honest case for the existing rule.
  4. Ask the user to choose: **A** follow the concept, **B** improve it for
     every project, **C** create a second concept (option or variant), or
     **D** keep a local exception.

  For **C**, confirm once more that a second concept is really wanted. Build
  nothing on it until answered (PROTOCOL §4).
- **Harvest.** When a decision recorded here would hold in another project,
  add it to `KNOWLEDGE.md` → *Harvest queue* and offer to fold it into the
  knowledge base (PROTOCOL §3).
- **Edit the KB from here through the protocol only.** Each change needs a
  version bump, a changelog line, a `REGISTRY.md` update, and this project's
  adoption row brought up to date.
