# Production — restart plan (from erp-0.8)

> A new start on production from `erp-0.8` (`bbf32ca`, P149: sales, purchasing,
> stock, finance, tax; no production). The work from P150–P172 is kept on the
> branch `walet` and is **salvaged file by file**, trimmed to this plan, never
> merged. Every point below was confirmed with the user on 28/10/2026; nothing
> here is open. Decisions on this line are numbered from **P200** so they never
> collide with `walet`'s P150–P172.

## 1. The goal

One simple end-to-end production flow, to be grown later:

```
Gudang ──Stock Issue──► Workstation A ──Eksekusi──► output lots at A
                                     ──Production Transfer──► Workstation B ──Eksekusi──► …
                                     ──Production Release──► Gudang (or Pemusnahan)
Tagihan Biaya (non-material cost, booked on its expense accounts during the month)
Month end: Penutupan Biaya Produksi spreads the month's pool over the month's
executions by Driver and revalues WIP, Persediaan and HPP.
```

During the month production carries **actual material cost only**. Every other
cost is booked outside production and absorbed **at month end**.

## 2. What is decided

| # | Subject | Decision |
| --- | --- | --- |
| R1 | Branch | Current `main` (Walet, with the uncommitted P172 committed as-is) becomes branch **`walet`**, pushed. **`main` is reset to `erp-0.8` and force-pushed**; local and Vercel use it from then on. |
| R2 | Neon | The existing Neon database is **reset** and rebuilt from the new `main` (`db:neon-reset -- --confirm`, `db:neon-seed`, `db:neon-seed-accounts`, showcase). Walet data on Neon is lost; its code stays on `walet`. |
| R3 | Identity | **Lot only.** Production holds goods per **lot · workstation**. No Partai, no Job, no Kode Job. |
| R4 | Stock Issue | **Direct**: Posting moves the lot from the warehouse straight into the workstation. No transit, no Terima / Tolak. |
| R5 | Eksekusi | **Transformation only**: inputs (any lot held at the workstation, any quantity) are consumed; each output is a **new lot**. No pass-through, no mix, no Cara Kerja. |
| R6 | Output value | Σ input value shared over the outputs by **qty × Bobot Nilai** of the item (largest remainder). **Bobot Nilai 0 = an output without value**. An execution whose outputs all weigh 0 is refused. |
| R7 | Production Transfer | **Direct**: Posting moves any quantity of a lot from one workstation to another at round(V × q ÷ Q) (V whole when the bucket empties). No journal. |
| R8 | Production Release | One table, two purposes: **to a warehouse** (same lot into stock, Dr Persediaan / Cr WIP) and **Pemusnahan** (Dr Beban Pemusnahan Produksi / Cr WIP). Any quantity of any lot at the workstation. |
| R9 | Tagihan Biaya | As P156 without Cost Center: Supplier required; each line a **Jenis Biaya** (a master naming its expense account) and an amount; Posting Dr each expense account / Cr **Hutang Biaya Produksi** (Account Mapping), copied to the bill; paid by the Pengeluaran purpose **Pembayaran Biaya Produksi**. |
| R10 | Month pool | The month's **net debit movement on the expense accounts that Jenis Biaya use**, from any journal (Tagihan Biaya, manual journal e.g. depreciation). One pool; no Cost Center. |
| R11 | Allocation | The pool is shared over the month's posted executions by **Driver**, a number typed on each execution, **required > 0**. |
| R12 | Revaluation | Each execution's share goes to its outputs by R6's weights and **follows the lots forward by quantity** to where they stand when the close runs: still at a workstation (**WIP**), consumed by a later execution (passes on to its outputs), released to stock (**Persediaan**, split **sold → HPP vs ending stock** by goods available), or scrapped (**Beban Pemusnahan**). |
| R13 | Close journal | Dr WIP / Persediaan / HPP / Beban Pemusnahan — **Cr Biaya Produksi Dibebankan** (one Account Mapping account). The expense accounts keep the actual cost. |
| R14 | No execution | A month with a pool and no posted execution sends the whole pool to **HPP**. |
| R15 | Close rules | One period at a time, oldest first, only after its last day; **irreversible**; it **locks the period** for production documents, stock movements and journal lines on Jenis Biaya accounts and Biaya Produksi Dibebankan (the close's own rows excepted). |
| R16 | WIP account | A **WIP column on Account Kategori Item**, no fallback: posting is refused naming the category when it is empty. |
| R17 | Numbering | Standard `PREFIX/YYYY/MM/NNNN` (P15). Output lots are generated as `<execution number>-<n>` (the Receipt Note's pattern) and may be typed; a number the item already has is refused. |
| R18 | Extras in scope | Reports **Saldo Produksi**, **Kartu Lot**, **Rekap Produksi**; a **production showcase seed**. |
| R19 | Not adopted | Cost Center, Standard Cost, Standard Cost Items, Partai / Job / Kode Job, transit and receipts, pass-through / mix, Tipe Output and Reject flag, Perintah / Rencana Produksi, BoM, Routing, Telusur, `production-number.ts` daily numbering, global lot uniqueness (P163; the lot stays unique per item, P120). |

## 3. Salvage map (from branch `walet`)

| Walet source | Take | Change |
| --- | --- | --- |
| `ref_workstation`, its registry entity | Label, Nama, status | Drop `cost_center_id`, `job_code`, `mode` |
| `acc_cost_type` (Jenis Biaya), `production-cost.ts` | Label, Nama, expense account | Drop Cost Center rules, standard item link; expense account no longer needs *Require Cost Center* |
| `prd_cost_bill(_line)`, `production-cost-bill*.ts`, forms, actions, `cost_bill` purpose in `cash-payment.ts` | Whole flow of P156 | Drop `cost_center_id` on lines and journal |
| Account Mapping › Produksi | Hutang Biaya Produksi, Beban Pemusnahan Produksi | Add **Biaya Produksi Dibebankan** (no Cost Center flag) |
| `m_item.value_weight` (Bobot Nilai) | As is | Drop `output_type` |
| `production-ledger.ts`, `prd_balance`, `prd_ledger`, `prd_lot_link` | Book shape: bucket, append-only ledger with balances after, `MP/…` ledger numbers, `enterProduction`, `takeFromBucket`, `produce`, `revalueBucket` | Bucket = lot · workstation only (no Partai, Job, transit, reject); lots from `log_stock_tracking` per item (P120) |
| `log_stock_issue(_line, _lot)`, `stock-issue*.ts`, forms | P158 shape (posting puts goods at the station) | No Perintah source, no receive / reject, number `SI/…` |
| `prd_handover(_line)`, `production-handover*.ts` | Line picking by bucket, posting | Renamed **Production Transfer** (`prd_transfer`, `PT/…`); no Partai, boxing, transit, Perintah |
| `prd_execution(_input, _output)`, `production-run*.ts`, `production-execution.ts`, run form | Transform path, Bobot Nilai sharing, journal per WIP account | Drop sections, standard cost rows, pass-through, mix, reject; add `driver` (> 0) |
| `prd_release(_line)`, `production-release*.ts` | Both purposes | No Partai / Perintah auto-close; `PR` collides with Purchase Request → numbers `PHP/…` and `PMS/…` |
| `production-report.ts`, `production-reports.tsx` | Saldo Produksi, Kartu Lot, Rekap Produksi | No Partai / Job columns, no standard column |
| `production-close.ts`, `production-close-shape.ts` (uncommitted P172) | Checklist, forward-following by quantity, sold vs ending split, `revaluePool`, period lock, dry-run preview | One pool by Driver instead of per Cost Center / Standard Cost Item; credit Biaya Produksi Dibebankan |
| `walet-showcase.ts`, `seed-production-showcase.ts` | Shape of the seed | New neutral data (R18) |

## 4. Build steps

Each step is one commit on `main` that leaves the app working: migration and
DBML together with the code, `npm run build`, `npm run lint`, `npm test` green,
`db:reconcile` checks added where a book or a journal is written, a decision
P2xx in `Claude-ERP.md`, `Production-Process.md` updated, push, then
`db:neon-migrate`. **The user reviews on Neon after each step before the next.**

| Step | Content | Done when |
| --- | --- | --- |
| 0 | **Branch switch** (R1, R2): commit P172 on `main`, branch `walet`, push it; reset `main` to `erp-0.8`, force-push; reset and seed Neon; record P200 (this restart) in `Claude-ERP.md` §1.5, §12, §16; add this plan | Vercel serves the erp-0.8 app from `main`; `walet` holds 8061b5d + P172 |
| 1 | **Masters**: menu Produksi; Workstation; Jenis Biaya; WIP column on Account Kategori Item; Bobot Nilai on the Item; Account Mapping › Produksi (three keys); starter accounts and mappings in `db:seed-accounts` | Masters created, edited, deactivated in the browser |
| 2 | **Tagihan Biaya** and the Pengeluaran purpose **Pembayaran Biaya Produksi** | Post a bill, pay it; journal and Cash Bank Book checked |
| 3 | **Production ledger** book (no screen) with its tests and reconcile checks | `tests/production-ledger.test.ts` green |
| 4 | **Stock Issue** (R4) under Persediaan › Operasi Gudang | Lot leaves stock at moving average, sits at the station; Dr WIP / Cr Persediaan |
| 5 | **Eksekusi Produksi** (R5, R6, R11, R17) | Inputs consumed, output lots made and valued; WIP journal per account when output and input WIP accounts differ |
| 6 | **Production Transfer** (R7) | Lot moved between stations, value kept |
| 7 | **Production Release** (R8) | Lot into stock or scrapped; journals checked |
| 8 | **Reports** Saldo Produksi, Kartu Lot, Rekap Produksi (R18) | Read from the ledgers; match the balance tables |
| 9 | **Penutupan Biaya Produksi** (R10–R15) | A month closed in a test and in the browser: pool fully absorbed, Biaya Produksi Dibebankan = pool, WIP / Persediaan / HPP move as R12 |
| 10 | **Production showcase seed** and one end-to-end test: inject → issue → execute → transfer → execute → release → sell → close | Neon carries the showcase month, closed |

## 5. Known limits kept on purpose

- Output lots carry no supplier and no genealogy view beyond Kartu Lot (Telusur is not built).
- A Draft reserves nothing; a lot picked by two Drafts posts once.
- Goods cannot go back from stock into production except by a new Stock Issue.
