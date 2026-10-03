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
- **Knowingly ignored until stated otherwise** — **stock / inventory
  quantities** (no stock check, no stock card, no warehouse movement; cost of
  goods uses a placeholder value, §12 P18). Other items the user sets aside are
  added to this line.
- **Not carried from SIBA** — the two-company structure and everything
  Budget-related (§12 P9, P10).

### 1.5 Current status

| Area | State |
| --- | --- |
| Project guideline (this file) | Written 29/09/2026; clash decisions recorded 29/09/2026 |
| Implementation plan | `IMPLEMENTATION-PLAN.md` — Phase 1 done 29/09/2026; Phase 2 done for sales 29/09/2026 (Partner customer side, Satuan, Termin, Gudang, Jenis PPh, Item, sales defaults); Phase 3 started: Sales Order built 29/09/2026 (P49–P53); Uang Muka Penjualan built 29/09/2026 (P54–P58); tax arithmetic moved to `tax_concept.md` (half up, per-line chain, snapshotted PPN setting) 29/09/2026 (P59, P60); settings split into System Default and Account Mapping 29/09/2026 (P61); Sales Order lifecycle Draft → Diajukan → Open → Ditutup, form rework, advance layout, dropdown keyboard and percent field 30/09/2026 (P63–P65); Penerimaan Kas & Bank with its first purpose, Penerimaan Uang Muka Penjualan, settling several bills per receipt 30/09/2026 (P66–P70); AR items and Buku Piutang with the Buku Piutang, Umur Piutang and Uang Muka Customer reports 30/09/2026 (P71–P75); the receipt reworked to cash-first lines picked from a dialog, and Buku Piutang's Sertakan Uang Muka switch 30/09/2026 (P76, P77); the Sales Order renamed the Customer Order 01/10/2026 (P78); the Sales Order built as the Customer Order's dated child 01/10/2026 (P79); deployed on Vercel with a Neon database 01/10/2026 (P80); the Sales Order's lines picked from the Customer Order in a dialog, and document lines trimmed to what the user acts on 01/10/2026 (P81, P82); the payment menu reviewed against mainstream ERPs and its roadmap set 02/10/2026 (P83–P86); the sales process concept gathered in `Sales-Process-Concept.md` (U1–U10, agreed, not yet built) 03/10/2026; the Delivery Order built 03/10/2026 (P93) |
| Code | Phase 1 carried and adapted: one company, no Budget, Control Account set by the user, `PREFIX/YYYY/MM/NNNN` numbering, dashboard placeholder. `npm run build`, `npm run lint` and `npm test` pass on PostgreSQL 18; the Phase 1 walk-through (fiscal year, accounts, Partner, Cash & Bank with opening balance, manual journal, General Ledger, Trial Balance) checked in a browser and in Postgres |
| Schema | Baseline migration, removal of rate layers (P37), Partner addresses / contacts / tax identity and the region reference (P39–P42), the reference masters Satuan / Termin / Gudang / Jenis PPh (P43, P44), Item with unit conversions and Kategori Item (P46–P48), the customer's sales defaults (P51), Sales Order `sal_order(_line)` (P49–P53), Uang Muka Penjualan `sal_advance` (P54–P58), PPN rate snapshots on SO / advance and per-line DPP Nilai Lain (P60), the SO's new statuses with Gudang and Kirim Diminta dropped (P63), the cash & bank transaction `fin_cash_bank_tx(_line, _line_wht)` (P66), AR items `fin_ar_item` and Buku Piutang `fin_ar_ledger` (P71–P75); the Sales Order renamed in place to the Customer Order `sal_customer_order(_line)` (P78), and the new Sales Order `sal_order(_line)` (P79); the Delivery Order `sal_delivery_order(_line)` (P93); `DBML/erp.dbml.md` in step |

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
| Uang Muka Penjualan (Finance menu, `ARA/…`) | `sal_advance` | nothing (bill only) |
| Delivery Order (`DO/…`, from the Customer Order's Open Sales Orders) | `sal_delivery_order(_line)` | nothing |
| Delivery Note (replaces the Surat Jalan, C28) | to be designed | HPP / Persediaan at a placeholder cost (P18) |
| Faktur Penjualan | `sal_invoice(_line, _advance_deduction)` | journal + faktur pajak |
| Nota Retur | `sal_return(_line)` | journal + faktur pajak |
| Perizinan | `sal_permit_request(_line)`, its advance and invoice | per simulation |
| Penerimaan / Pengeluaran Kas & Bank (Finance › Kas & Bank, `BKM/…`, `BKK/…`) | `fin_cash_bank_tx(_line, _line_wht)` | Cash Bank Book + journal; the figures tax documents are made from |
| AR items (a book: kernel only; documents call it) | `fin_ar_item`, `fin_ar_ledger` (Buku Piutang) | never a journal — the receipt and the Faktur post, and write their AR items beside |
| Pajak | `tax_faktur(_line)`, `tax_withholding_slip` | never a journal |

Table prefixes follow SIBA (`sys_`, `ref_`, `m_`, `acc_`, `fin_`) plus
`sal_` (sales) and `tax_` (tax documents). Later ERP modules take their own
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
`db:neon-*` scripts (§6). Ports are chosen so SIBA and this app can run side
by side:

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
  components/ui, shell, master, report, accounting, finance, sales, tax
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
data only), `npm run db:seed-showcase` (dev demo data from the simulation,
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

**Follow `Initialization/design-convention.md` in full** — it is SIBA's
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
   from it is still running [S15, S22]. It is the basis of the advance and the
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
   may be partial, carries no prices and posts nothing. The **Delivery Note**,
   still to be designed, is what the goods leave on: it posts Dr HPP / Cr
   Persediaan at a **placeholder cost** until stock exists; no stock check
   (P18) [S19].
8. **Faktur Penjualan** from one posted Surat Jalan; deducts the same SO's
   paid advances before posting, so PPN is acknowledged once: Dr Piutang (net),
   Dr Uang Muka (advance DPP) / Cr Penjualan (full DPP), Cr PPN Keluaran (net)
   [S20].
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
    **per document in AR items** (P71): an Invoice item per Faktur, an Uang
    Muka item per bill per receipt, each moved only through Buku Piutang and
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
`SALES_INVOICE_POST`, `TAX_FAKTUR_UPLOAD`).

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
- Do **not** add stock handling until the user lifts P5.
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
- **A Customer Order, a Sales Order and a Delivery Order close only by
  hand**; closing once everything has left needs the Delivery Note (C28).
- **A closed Sales Order keeps its whole quantity on the Customer Order, and
  a closed Delivery Order its whole quantity on the Sales Order.** Nothing
  yet says how much really left; once the Delivery Note exists, a closed one
  should hold only what it delivered.
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
- **AR items carry no Invoice yet.** Invoice items, the *Pembayaran* and
  *Dipakai Invoice* events, and the Umur Piutang buckets fill in when the
  Faktur Penjualan and the Pelunasan Faktur purpose are built; the engine
  already supports them.
- **A receipt handles no overpayment, no foreign currency and no WAPU.** Money
  beyond the ticked bills is refused; a customer marked Pemungut PPN is
  treated like any other (P59: no WAPU yet).
- **The Faktur Pajak Uang Muka and the Bukti Potong are not records yet.**
  Each receipt line stores their figures (P66, P69); the Pajak menu makes them.
- **Sales Orders and advance bills saved before 29/09/2026 keep their
  floor-era figures.** The P59–P60 rework recomputes a Draft at its next save
  and a document at Ajukan / Terbitkan. Anything already confirmed or
  issued keeps what it was stored with (development data only).
- **An installation seeded before P60 still holds PPH42-SEWA.** The seed no
  longer creates it and never deletes; deactivate it by hand if it is not
  wanted.
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
| C3 | **Further purposes** — each new *tujuan* (Pelunasan Faktur, Pengembalian Uang Muka, Penerimaan / Pengeluaran Lain-lain, …) with its postings. How purposes are modelled and find their accounts is decided (P66) | When the user instructs each |
| C6 | **Contents of each master** — each further reference master (P26). `m_partner` decided in P39–P42, `m_item` in P46–P48 | When that master is built |
| C23 | **NITKU** — the 22-digit place-of-business identity a faktur names (NPWP + 6 digits, `000000` head office). Proposed: one per billing address, since DJP registers a NITKU at an address and a faktur carries both | When Faktur Pajak is built |
| C25 | **Account mapping per Kategori Item** — its own menu naming Penjualan, Retur, HPP and Persediaan accounts per category (P47) | When the first document that posts an item is built (Surat Jalan, Faktur) |
| C14 | **Cash Bank Transfer and Debit / Credit Note** (P19) | Later |
| C28 | **Delivery Note**, the second half of replacing the simulation's Surat Jalan (the Delivery Order is P93). The *Delivery Note* is the document the goods actually leave on, drawn from an issued Delivery Order. Still to decide: numbering, lifecycle, partial delivery against a Delivery Order, closing the Delivery Order / Sales Order / Customer Order once everything has left, and the HPP placeholder of P18 | Next |
| C29 | **Correcting a posted payment.** No document corrects a posted receipt or payment today (a bounced transfer, the wrong customer, the wrong amount). Proposed: a *Pembatalan* document with its own number that posts the exact opposite journal, Cash Bank Book and AR item entries, leaving the original untouched (§2 rule 7). **Not built until the user confirms it is wanted** | When the user decides |
| C30 | **Approval of Pengeluaran** (maker → checker, perhaps above an amount). Receipts need none | At the very end, after the processes work |
| C31 | **Clearing Penerimaan Belum Teridentifikasi** (P85): how money held in suspense is later moved to a customer's bills once identified (e.g. a receipt whose source of funds is the suspense item instead of a bank), and whether the overpaid part of a known customer's transfer is split onto it in the same transaction or a separate one | When that purpose is built |
| C32 | **Menu layout and shortcuts** — grouping purposes, reaching receipts from the Sales menu, *Terima Pembayaran* from a document, list filters and totals. Deferred so later process changes do not redo it | At the end, when the processes work and the focus is convenience |

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
