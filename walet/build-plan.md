# Walet production — build plan

> How everything agreed so far is built on `main`, step by step. Sources:
> `production_project.md` §21g (M111–M128), `walet/walet.md` (AD1–AD22),
> `walet/simulation production.md` (§7–§10). Written 15/10/2026; each step is
> marked ✅ with its decision number as it is built.
>
> **Rules for every step** (Claude-ERP.md §15, the review gate): schema and the
> code that reads it land together; build, lint, tests and `db:reconcile` pass
> before the push; DBML and the decision log are updated in the same change;
> Neon is migrated and seeded after the push; then **stop for the user's
> review** with a checklist.

---

## 0. Where we start (built)

| Built | State on `main` | Changes in this plan |
| --- | --- | --- |
| Stock books (P120) | `log_stock_tracking` (lots unique **per item**), stock ledger / balance by warehouse · location · lot · status, moving-average pools | Lots unique **system-wide**; the one register for production too (M128) |
| Production ledger (P157) | `prd_job(_parent)` (one identity), `prd_lot` (own lot list, one job per lot), `prd_balance` (lot × workstation), `prd_ledger`, `prd_lot_link` | Partai + Job; `prd_lot` dropped; bucket = lot × Job × workstation (+ transit) |
| Stock Issue (P158) | `log_stock_issue`, `SI/YYYY/MM/NNNN`, arrives at posting | Becomes the **Logistik BSTB**, raised from a Perintah, received by the station |
| Costing masters (P160) | Workstation → Cost Center, Standard Cost Items, Standard Cost per workstation, overhead setting | Workstation gains **Kode Job**; Standard Cost read per gram |
| Numbering | `PREFIX/YYYY/MM/NNNN` everywhere | Workbook formats for production identities (M124) |

---

## 1. The steps

### Step 1 — Masters for Walet (5b) ✅ built 15/10/2026 (P162)

| Part | What |
| --- | --- |
| **Workstation** | Its **label is the unit code** used in numbers (UGH, UPC, UPY, UPW, UCL, UDA, UML, UWP, UBC, UP5, UP8). New optional **Kode Job** — the code of Jobs made at its output (UGH → `UGH`, UML → `UDB`); empty = the station keeps the Jobs it receives (M126) |
| **Item** | New **Tipe Output** (Utama / Turunan / BJL, Barang only, M117) and **Bobot Nilai per gram** (value weight per base unit, `Decimal(18,6)`, ≥ 0; BJL fixed at 0; a temporary rate, M122) |
| **Bill of Materials** (`prd_bom`, `prd_bom_line`) | Per output item: base quantity (grams / pcs), default flag, status; lines = component item + quantity per base quantity + optional **routing step** that consumes it. **A suggestion only**: it pre-fills an execution's inputs, never limits them. Master Data under Produksi |
| **Routing** (`prd_routing`, `prd_routing_step`) | Per **Item Target** (the Partai's): ordered steps of workstation + **mode** (*Mix + Transformasi* at Moulding, *Transformasi*, *Pass-through*) + optional BoM for the step. Default flag, status. A Perintah copies it |
| **Showcase** (`db:seed-showcase`, production part) | Walet's world: items (raw kinds, grading kinds, N-NL-KR, N-NL, N-NL-PU, N-MK 50 g, box, outer box) with Tipe Output and value weights from the workbook; supplier D0001; the 11 workstations with Cost Centers (one per unit + FOH, M110) and Standard Cost per gram from the workbook (Pre Wash 182,86 …); Kode Job on UGH and UML; warehouses (Bahan Baku, Bahan Kemas, Barang Jadi, BJL); the N-MK routing and BoM; raw lots injected with their supplier (`receiveStock`) |
| **Tests / docs** | Registry tests, BoM / Routing rules, reconcile (a step's BoM is for the step's output; a routing's workstations are active) |

**Done when:** the masters work in a browser and the showcase shows the whole Walet setup; the cosmetics production demo is gone.

### Step 2 — One lot register and Partai · Job (5c-1) ✅ built 15/10/2026 (P163)

| Part | What |
| --- | --- |
| **Lot register** | `log_stock_tracking.tracking_no` **unique system-wide** (migration refuses duplicates and lists them); production refers to it: `prd_lot` dropped, `prd_balance.lot_id` / `prd_ledger.lot_id` / `prd_lot_link` point at `log_stock_tracking` (M128). A lot made in production is registered with the **execution as its source** and **the supplier carried** when one supplier is behind it |
| **Partai · Job** | `prd_job` renamed **`prd_partai`** (`P_<DDMMYY>_<NNNNN>`, its **Item Target**, its Perintah); a new **`prd_job`** (`<Kode Job>_<DDMMYY>_<NNNNN>`, belongs to one Partai) with **`prd_job_parent`** |
| **Bucket** | **lot × Job × workstation** (Job null for a stock lot before its Partai starts and for the No. Moulding) plus a **transit** marker (the receiving workstation) for goods sent but not yet received (M113, M127) |
| **Numbering kernel** | A second numbering helper beside `document-number.ts`: `<PREFIX>_<unit>_<DDMMYY>_<NNNNN>` (series per prefix, unit and day), `P_<DDMMYY>_<NNNNN>`, `PP_<DDMMYY>_<NNNNN>`, lot `<unit>_<supplier>_<kode barang>_<DDMMYY>` / `<partai>_<kode barang>` with `-2`, `-3` on a clash (M124) |
| **Data** | Development data only in production today: existing `prd_*` rows are mapped onto their stock lots or, if that is cleaner, Neon's production rows are reset (to confirm) |
| **Checks** | Reconcile: every bucket's lot exists in the register; a lot's quantity in stock + production adds up across books; a Job belongs to its Partai |

**Done when:** a posted Stock Issue still works, now under one lot register; the production ledger tests pass on the new key.

### Step 3 — Perintah Produksi and the Logistik BSTB (5c-2) ✅ built 22/10/2026 (P164)

| Part | What |
| --- | --- |
| **Perintah Produksi** (`prd_order`, `PP_<DDMMYY>_<NNNNN>`) | One per Partai, by PPIC: Tanggal, **Item Target** and **Qty Target**, **Routing** (copied, editable), Catatan; **material requirements** from the BoMs × Qty Target, per station, never typed — none without a BoM (P165). No lot, no warehouse. Draft → *Buka* → Open → *Tutup* (reason; refused while a BSTB from it is Draft or in transit); *Batalkan* (Draft) (M121). Closing itself once nothing of its Partai is left in production comes when the Partai exists (step 4+) |
| **Logistik BSTB** (the Stock Issue reworked) | Raised **from a Perintah** — **optional** (O4) — its lines starting on what the destination station still needs (P165); **the BSTB picks the lots**; numbered `BSTB_LOG_<DDMMYY>_<NNNNN>`; posting moves stock → production **in transit** to the first workstation (Dr WIP / Cr Persediaan, as today); the station **receives it whole** (*Terima*) or **rejects it whole** (*Tolak* — back to stock) |
| **Checks** | Goods in transit are WIP; a station cannot use goods not received |

**Done when:** PPIC raises a Perintah, Logistik sends its lots, UGH receives them.

### Step 4 — Station hand-over: BSTB between workstations (5c-3)

| Part | What |
| --- | --- |
| **BSTB** (`prd_handover`, `BSTB_<unit>_<DDMMYY>_<NNNNN>`) | From one workstation to the next: **the whole Partai** at the station (AD1), in transit until *Terima* / *Tolak* whole at the receiving station (M113). No value change, no journal |
| **Boxing into Jobs** | At a station with a **Kode Job** (UGH, UML), the hand-over **puts the goods into Jobs**: each box a new Job of the Partai carrying quantities of lots — one lot may be split over several Jobs (N5, M126, M127); at UML the new Jobs' parents are every Job in the mix |
| **Checks** | Transit totals; every Partai's goods are at one place or in transit |

**Done when:** a Partai can be handed station to station with receipts, and boxed into Jobs where the station makes Jobs.

### Step 5 — Eksekusi Produksi (5d)

| Part | What |
| --- | --- |
| **Header** (`prd_execution`, `NG_<unit>_<DDMMYY>_<NNNNN>`) | Workstation, Tanggal, **the Partai** — picked from what the station has received (M114); its mode from the routing step for this station (or chosen) |
| **Mix** (Moulding's first posting) | The Partai's Jobs' lots → **one No. Moulding lot** (`<partai>_<kode barang>`), Partai only, no Job, **no standard** (M125) |
| **Transformasi** | A section per Job (or the No. Moulding): inputs (its lots, any quantity they hold) → outputs (any items, free — no BoM at the grading stations; BoM pre-fills at packing). Each output: item, grams, **Tipe Output** from the item, **status** Tersedia / Reject, **Bobot** = grams × value weight (BJL and Reject 0). Value = Σ inputs + standard, shared by Bobot (largest remainder). **Every output gets a new lot** registered with the NG as source (by-products too, F3; Barcoding too, F4); the Job is kept (or none, at Moulding) |
| **Pass-through** | A section per Job: the lot kept, extra inputs (wrap, box) added, **weight in and out free** (shown as susut / tambahan, F6) |
| **Standard** | **Driver = grams per section** (input; output at Barcoding), × each Standard Cost Item's rate of the workstation's Standard Cost in force (M122); none if the station has none (F7). Snapshotted on the execution |
| **Journal** | Dr WIP (outputs' categories) / Cr WIP (inputs' categories) / Cr each Standard Cost Item's account with the workstation's Cost Center; netting lines dropped; dry-run preview (P103) |
| **Freezes** | A Standard Cost cannot start in or change for a period with a posted execution at its workstation |
| **Checks** | Execution balance (Σ out = Σ in + standard); standard = its journal credits; every output lot registered with the NG as source; WIP account = Σ buckets |

**Done when:** the whole simulation (`simulation production.md` §4) can be keyed in and gives its figures to the rupiah.

### Step 6 — Leaving production (6)

| Part | What |
| --- | --- |
| **Penerimaan Hasil Produksi** | From a station into a warehouse, **the lot kept**: FG at its value (Dr Persediaan / Cr WIP), **Turunan at the value it holds then**, **BJL at 0** (no journal) (M118) |
| **Pemusnahan Produksi** | Waste out of production: Dr Beban Pemusnahan / Cr WIP |
| **Checks** | A lot back in stock is the same register row; values leave WIP exactly |

### Step 7 — Reports (7)

Saldo Produksi (by Partai · Job · workstation · transit), Kartu Lot, **Telusur** (any lot or Job back to the supplier lot and forward to FG and customer), Rekap Produksi (susut, **HPP per gram** per station).

### Step 8 — Penutupan Biaya Produksi (8)

As agreed (M96–M99): per Cost Center and Standard Cost Item, the leftover spread over the month's executions by Driver (grams) and followed to WIP, stock and HPP; FOH spread Rata first.

### Step 9 — MRP (last)

Demand from Pra-SO and SO; BoM and Routing explosion; planned Perintah and Purchase Requests.

---

## 2. To settle before or during the steps

| # | Question | When |
| --- | --- | --- |
| O1 | ~~Sales and purchasing demo~~ — **kept** for now; only production became Walet (P162) | Step 1 ✅ |
| O2 | ~~Existing production data~~ — **mapped** by the migration (there was none locally or on Neon); to confirm at review | Step 2 ✅ |
| O3 | ~~Partai created by the execution or the hand-over?~~ — **by the hand-over** (the user, 22/10/2026): the Grading Halus output has no Partai yet; the Partai is created when the goods continue, boxed into Jobs | Step 4 |
| O4 | ~~BSTB without a Perintah?~~ — **optional for now** (the user, 22/10/2026): a Logistik issue to production need not come from a Perintah (P164) | Step 3 ✅ |
| O5 | ~~Lot numbers~~ — **generated** in the formats above (`production-number.ts`), **a typed one still accepted** while new in the register; to confirm at review | Step 2 ✅ |
| O6 | ~~Reject output~~ — **stays in production until taken out** (the user, 22/10/2026; M59) | Step 5 |
