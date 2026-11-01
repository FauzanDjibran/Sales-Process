# Production — restart plan (from erp-0.8)

> A new start on production from `erp-0.8` (`bbf32ca`, P149: sales, purchasing,
> stock, finance, tax; no production). The work from P150–P172 is kept on the
> branch `walet` and is **salvaged file by file**, trimmed to this plan, never
> merged. Every point below was confirmed with the user on 28/10/2026; nothing
> here is open. Decisions on this line are numbered from **P200** so they never
> collide with `walet`'s P150–P172.
>
> **Extended 01/11/2026** (R20–R29, steps 8–15) from
> `Production-Baseline-Analysis.md` and the `walet` documents, every point
> answered by the user: a planning layer (Perintah Produksi, BoM per
> workstation, Routing) that guides but never limits, the period frame of the
> close, *Costing Sementara*, and the trace and plan-versus-actual reports. The
> three goals it serves: **G1** month-end costing with material-only WIP,
> **G2** tracing lot → Perintah → workstation → FG both ways, **G3** flexible
> workstations and BoM without breaking G1 or G2.

## 1. The goal

One simple end-to-end production flow, to be grown later:

```
Perintah Produksi (item target, qty; Routing + BoM per workstation copied, frozen)
     ⋮ guides, never limits — every document below names it, Eksekusi always
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
| R19 | Not adopted | Cost Center, Standard Cost, Standard Cost Items, Partai / Job / Kode Job, transit and receipts, pass-through / mix, Tipe Output and Reject flag, Rencana Produksi, `production-number.ts` daily numbering, global lot uniqueness (P163; the lot stays unique per item, P120). *Amended 01/11/2026: Perintah Produksi, BoM, Routing and Telusur are adopted by R20–R27.* |
| R20 | Perintah Produksi | `prd_order`, `PP/YYYY/MM/NNNN`, Produksi › Operasi Produksi. **Made by hand**: an **Item Target** (Barang, Kelola Stok), a **Qty Target** in its base unit, a date, and optionally **one Open Sales Order line** as a reference (weak pair, never a reservation). It picks one **Routing** of the item (starting on its default) and, for each workstation on it, one **BoM** of the item there (starting on the default; none = no requirement). Lifecycle **Draft → *Rilis* → Dirilis → *Tutup* → Ditutup**; *Batalkan* a Draft, with a reason. **Rilis copies** the route and the BoM lines into `prd_order_step` / `prd_order_component` with the requirement per component = BoM qty × Qty Target ÷ BoM base qty; **a released Perintah is frozen** — a different plan is a Tutup and a new Perintah. *Tutup* is by hand (a reason when what was received is below the target), refused while a Draft document names it. Posts nothing, moves nothing. |
| R21 | BoM and Routing | Masters under Produksi › Master Data. **BoM** (`m_bom(_line)`): for **one Item Target at one workstation** — base quantity and the components that go in there (item, qty in the base unit). **Routing** (`m_routing(_step)`): for one Item Target, its workstations in order. An item may have **several of each, Aktif / Nonaktif, one default** (per item per workstation for a BoM, per item for a Routing); a used one is deactivated, never deleted. A change to a master never touches a released Perintah. **A suggestion, never a limit** (R22). |
| R22 | Execution against a Perintah | **Every Eksekusi names one Dirilis Perintah**, dated on or after its release; inputs and outputs stay free (R5). Where it leaves the plan — a workstation not on the route, an input not among the Perintah's components at that workstation, more consumed than required — it is **shown as a warning** on the form and in the Posting confirmation, **never refused**, and counted in *Rencana vs Aktual* (R27). Repeating a step is more executions; skipping one is none. Costing and genealogy read only the actual inputs and outputs, so the plan never changes a value. |
| R23 | Other documents and the Perintah | Stock Issue, Production Transfer and Production Release **may** name a Dirilis Perintah. A Stock Issue that names one starts its lines on what the destination workstation still needs (requirement less what issues naming it already sent there). The bucket stays **lot · workstation** (R3): goods carry no Perintah; the execution says which Perintah they were worked for. |
| R24 | Multi-level | A semi-finished item with its own BoM is made by **its own Perintah**; the upper Perintah consumes its lots like any input. Trace crosses Perintah through the genealogy. No phantom and no automatic child Perintah. |
| R25 | The period frame | Production, its FG, its HPP and its cost are **framed in one fiscal period**: the close stores, per period, **what it closed** — the pool per Jenis Biaya account, each execution's Driver and share, and per FG item its opening, received, issued and ending quantity and value before and after the close (HPP part and ending part), and the WIP buckets it raised. The stored close is the period's costing record; the next period opens from it. Together with R15 (oldest first, after the last day, irreversible, locked). |
| R26 | Costing Sementara | A report (Produksi › Laporan, per **FG item**) that **runs the close for the open period as of a date**, as a dry run of the close's own calculation (P103): the costs posted so far, the executions posted so far, followed forward as R12. Per item: quantity received, material value, conversion share, final unit cost, HPP of what was sold, ending stock — labelled *Sementara*. Nothing is posted. |
| R27 | Trace and plan reports | **Telusur Produksi** (a lot, *Mundur* / *Maju*): backward FG → executions (Perintah, workstation, date) → inputs → issued stock lots → their Receipt Notes and suppliers; forward to Production Release → Delivery Notes and customers; quantity and value at each edge, and where any of it still sits. **Rencana vs Aktual** (per Perintah): per workstation of the route and outside it, components required vs consumed (item, qty, value), outputs vs the target, the warnings of R22. |
| R28 | Close checklist and controls | Before the close (from `walet` P172): no Draft production, stock or Tagihan Biaya document dated in the period; no earlier period with production activity uncosted; every account the close posts to mapped. **The fiscal-year close is refused** while a period with production or cost activity is uncosted. `db:reconcile` gains: the pool equals the GL on the Jenis Biaya accounts; Biaya Produksi Dibebankan equals the closes; each close's shares add up to its pool; no production, stock or cost row dated in a costed period after its close; stock valuation including revaluation rows equals Persediaan. |
| R29 | Later phases | Kept out on purpose, each addable without changing the close's logic: the **normal-capacity rule** (PSAK 14 / IAS 2: fixed cost absorbed up to normal capacity, the rest expensed — needs Tetap / Variabel on Jenis Biaya and a capacity per workstation), **a pool per workstation**, **pass-through keeping the lot**, **Rencana Produksi** and MRP, standard cost, by-product at NRV, QC status in production, serial numbers, subcontracting. |

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
| 9 | **Penutupan Biaya Produksi** (R10–R15, R25, R28): the close, its stored period record, the checklist, the year-end guard, the reconcile checks | Scenario G1 passes in a test and in the browser |
| 10 | **Costing Sementara** (R26) on the close's own calculation | Run as of the period's last day it equals the close posted afterwards, figure for figure |
| 11 | **Telusur Produksi** (R27), before the Perintah exists | Scenario G2 without Perintah: every edge back to the supplier and forward to the customer |
| 12 | **BoM and Routing** masters (R21) | Created, defaulted, deactivated in the browser |
| 13 | **Perintah Produksi** (R20, R24); Eksekusi names one (R22); Stock Issue, Transfer and Release may (R23) | Scenario G3 passes; executions posted before this step keep no Perintah |
| 14 | **Rencana vs Aktual**; Telusur shows the Perintah at each execution (R27) | The deviations of scenario G3 are listed |
| 15 | **Production showcase seed** and one end-to-end test: inject → Perintah → issue → execute → transfer → execute → release → sell → Costing Sementara → close | Neon carries the showcase month, closed |

Steps 12 and 8–11 do not depend on each other; 13 needs 11 and 12.

### 4.1 Acceptance scenarios

**G1 — WIP is material only, and the close is right.** Lot BB-1 100 kg at
Rp10.000 (Rp1.000.000). Stock Issue 100 kg to WS-A → WIP 1.000.000. EKS-1
(Driver 10): 100 kg → SJ-1 80 kg at 1.000.000. Transfer to WS-B. Stock Issue
BK-1 200 pcs (Rp200.000). EKS-2 (Driver 30): SJ-1 + BK-1 → FG-1 200 pcs at
1.200.000. Release 100 pcs to stock (600.000); sell 50 (HPP 300.000).
*Before the close:* WIP = 600.000 = Σ buckets, no non-material value in WIP or
stock. Tagihan Biaya Rp400.000. *Costing Sementara* as of the last day shows
FG-1 at a final unit cost of Rp8.000 (6.000 material + 2.000 conversion).
*Close:* EKS-1 100.000 and EKS-2 300.000, both reaching FG-1 (400.000): 100 pcs
still at WS-B → WIP +200.000; of the 100 received, 50 sold → HPP +100.000 and
50 in stock → Persediaan +100.000; Cr Biaya Produksi Dibebankan 400.000. The
expense accounts less Biaya Produksi Dibebankan = 0; reconcile green; the
period is locked (a posting dated in it is refused) and its stored close lists
exactly FG-1, its HPP and the pool.

**G2 — trace.** Backward from FG-1: EKS-2 at WS-B ← SJ-1 + BK-1; SJ-1 ← EKS-1
at WS-A ← BB-1 ← its Receipt Note and supplier. Forward from BB-1 to the
Delivery Note and the customer. Each edge carries the ledger's quantity and
value; the 100 pcs still at WS-B are shown as such. From step 14, each
execution also shows its Perintah.

**G3 — change during production.** Perintah PP-1 released from BoM v1 and the
default Routing (WS-A → WS-B → WS-D). Then a BoM v2 becomes the default →
PP-1 does not change. Under PP-1: 30 kg of BB-1 replaced by BB-ALT, the WS-B
step executed twice, WS-D skipped, one execution at WS-C (not on the route).
Every posting goes through with its warning; values are the actual inputs
(BB-ALT at its moving average); the pool is shared over the four executions
by Driver; Telusur shows BB-ALT and WS-C; *Rencana vs Aktual* lists the
substitute, the repeat, the skip and the off-route workstation; reconcile
green. A new plan for the remaining quantity is PP-1 *Tutup* and PP-2; goods
already at the workstations are executed under PP-2 unchanged.

## 5. Known limits kept on purpose

- A Draft reserves nothing; a lot picked by two Drafts posts once.
- Goods cannot go back from stock into production except by a new Stock Issue.
- A released Perintah is never edited (R20); its plan is replaced, not changed.
- The Perintah's requirement is information: nothing is reserved in stock and no purchase is proposed (MRP is R29).
- Costing Sementara is a reading, not a posting; until the close, posted HPP and stock are material only.
