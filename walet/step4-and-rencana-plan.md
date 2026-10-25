# Step 4 (station hand-over) and the Rencana Produksi — plan

> Written 25/10/2026, **a proposal for the user's review — nothing here is built
> or decided.** Part A plans `build-plan.md` step 4. Part B adds the user's new
> scope: a **Rencana Produksi** (PPIC's monthly production plan) from which the
> Perintah Produksi is derived. Mainstream practice is from general knowledge of
> SAP (Demand Management / MPS / planned orders), Odoo MPS, Dynamics 365 master
> planning and APICS S&OP/MPS/MRP; not re-checked online.

---

## A. Step 4 — Station hand-over (BSTB between workstations)

### A1. What it does

A **BSTB** (`prd_handover(_line)`, `BSTB_<unit>_<DDMMYY>_<NNNNN>`, unit = the
sending station) moves goods from one workstation to the next. Posting puts
them **in transit** to the receiving station; the receiver acts on the whole
sending: **Terima** or **Tolak** (reason). No journal, no value change (WIP
stays WIP; a hand-over changes only *where*).

| Event | Ledger (production books) | Journal |
| --- | --- | --- |
| Post | sending bucket −q / −V → transit bucket at the receiver +q / +V (movement **Sent**, new) | none |
| Terima | transit → receiver's bucket (`receiveTransit`, as P164) | none |
| Tolak | transit → **back into the sender's bucket**, same lot / Job (`returnTransit` + a put-back) | none |

### A2. Two cases, one document

| Case | Sender | Rule |
| --- | --- | --- |
| **Partai already started** | any station | **Whole Partai at the station** (AD1): every bucket of that Partai there is listed, all moved, nothing to pick. Turunan / BJL that already left are not there anymore (F5); a Reject stays in production (O6) — see Q4 |
| **First hand-over (starts the Partai, O3)** | a station with a **Kode Job** (UGH, UML) holding goods with no Partai | The user picks **which received lots and how much** (the station may hold lots of several Perintah) and **boxes them into Jobs**: box 1..n, each box lines of lot × qty; one lot may be split over several boxes (N5, M127). Posting creates the **Partai** (target = the chosen Perintah's Item Target, M112) and a **Job per box** (`<Kode Job>_<DDMMYY>_<NNNNN>`) |
| **UML hand-over** | UML | Same boxing; each new Job's **parents are every Job that went into the mix** (`startJob` parentJobIds), same Partai |

At a station **without** a Kode Job the goods keep their Job; a hand-over of a
Partai is just a move.

### A3. The one new decision it needs: which Perintah?

O3 says the Partai takes the Item Target "of the Perintah behind the goods".
Goods carry no Perintah (the BSTB Logistik names one optionally, P164, and a
station can hold lots from two). **Proposal:** the starting hand-over **names
an Open Perintah** whose route contains the sending station (required when it
starts a Partai); a Perintah starts **one Partai only** (unique), the Partai
names it as source and copies its Item Target. If PPIC sends a second batch for
the same Perintah later, that is a new Perintah. (Replaces the wording "behind
the goods".)

### A4. Pieces to build

| Piece | Reuse | New |
| --- | --- | --- |
| Tables | — | `prd_handover` (status Draft → Posted → Diterima / Ditolak, from/to workstation, optional Perintah, dates, reason, receive date), `prd_handover_line` (source bucket, qty, `box_no`, resulting Job and transit bucket once posted) |
| Ledger | `startPartai`, `startJob`, `receiveTransit`, `returnTransit`, `takeFromBucket` internals | movement `Sent`; a `sendToTransit` in `production-ledger.ts` (take from bucket by round(V×q/Q), enter transit bucket under the new Job) |
| Workflow | BSTB Logistik workflow (P164) as template: dry-run, locks, receive / reject permission | `production-handover-workflow.ts`, action, form with *Pilih Barang* picker (`availableBuckets`) and a box column |
| UI | Stock Issue form / picker | Produksi › Operasi Produksi › **Hand-over (BSTB)**; Perintah page lists them like the BSTB Logistik card |
| Permissions | — | `PRODUCTION_HANDOVER_VIEW / _CREATE / _EDIT / _POST / _CANCEL / _RECEIVE` |
| Checks | `db:reconcile` transit check (72 checks) | each sending moved exactly its own q / V; **every Partai's goods are at one place or in transit**; a Job's lots belong to its Partai; transit totals = open sendings |
| Docs | — | `Production-Process.md` step E → ✅ + log, P167 in §12, §1.5, DBML |

### A5. Test (the "done when")

Receive the showcase raw lots at UGH (BSTB Logistik) → hand-over UGH→UPC with
two boxes (one lot split over both) → Partai + 2 Jobs exist → Terima; same
again with Tolak (goods back at UGH, Jobs kept) → hand-over UPC→UPY of the whole
Partai → a try to move less than the whole is refused → UML hand-over makes Jobs
with all input Jobs as parents. Reconcile passes.

### A6. Questions for step 4

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Name the Perintah on the starting hand-over (A3)? | Yes, required for the first one |
| Q2 | Tolak returns to the **sending station** (not stock) | Yes — only a Logistik BSTB returns to stock |
| Q3 | Before the Partai exists, may a station hand over *part* of what it holds? | Yes (only that case); once the Partai exists, whole |
| Q4 | A **Reject** lot at the station (O6: stays in production): does a whole-Partai hand-over carry it or leave it? | **Leave it** (it waits for Penerimaan / Pemusnahan, step 6); say if Walet wants it to travel |
| Q5 | Receive date: free (≥ send date) like BSTB Logistik | Yes |

---

## B. Rencana Produksi — PPIC's monthly plan

### B1. Mainstream process, and what Walet takes from it

| Mainstream (SAP, Odoo, D365, APICS) | Idea | For Walet |
| --- | --- | --- |
| **S&OP → MPS → MRP → planned orders → production orders** | A *plan of what to make per period* sits above the orders; orders are **released from** it and tracked against it | **Rencana Produksi** = MPS-level; **Perintah Produksi** = the released order (user's wish) |
| **Demand sources**: confirmed sales orders + forecast | Plan covers firm demand first; forecast / stock build is a separate, flagged line | SO lines of **Open** Sales Orders; optional lines *tanpa SO* (stock build) |
| **Netting**: net requirement = demand − available stock − already planned | Never plan what the warehouse already holds or another plan already covers | Show *Stok FG* and *Sudah direncanakan*; the plan quantity is typed (a suggestion, like the BoM) |
| **Planning horizon, time buckets** | Monthly plan, broken into weeks | One plan per **month**, each line a planned **start date** inside it (weekly view later) |
| **Aggregation (lot sizing)** | One order may serve several demands of the same item | **Several SO lines → one plan line per Item Target**; mirror of the PR → PO merge (B9) with a link table of shares, earliest Tanggal Kirim first |
| **Rough-cut capacity / material check** | Before approving, see whether stations and material can carry it | Phase 1: **material view** (BoM explosion of the whole plan, grams per item). Capacity (grams/day per station) and yield (loss: Dry A −35 %) are **not modelled** — later, optional |
| **Firming / approval, time fence** | Draft plan is free; an approved plan is frozen; changes are controlled | Draft → Ajukan → Setujui (as the Customer Order); after approval only controlled changes (Q-B7) |
| **Plan vs actual** | Attainment: planned, released, produced, delivered | Per line: *Rencana · Dirilis (Perintah) · Hasil (FG, step 6) · Terkirim*; report in step 7 |
| **Monthly SOP cycle** | Month-end meeting with sales, warehouse, purchasing; plan for next month agreed; released through the month | Matches the user's real SOP: plan made end of month for next month; Perintah created during the month |

### B2. Document

**Rencana Produksi** (`prd_plan`, `prd_plan_line`, `prd_plan_line_demand`),
Produksi › Operasi Produksi, above Perintah Produksi. Posts nothing, no
journal, no stock.

| Part | Proposal |
| --- | --- |
| Header | Periode (month, fiscal-period aware), Tanggal, Catatan; number `RP/YYYY/MM/NNNN` (standard ERP series; not a workbook identity) |
| Lines | **Item Target** (Barang, Kelola Stok) · **Qty Rencana** (base unit) · **Tanggal Mulai** (inside the month) · Catatan. One line per item per start date |
| Demand (tab per line, or picker) | *Pilih Pesanan* dialog like the Sales Order's *Tambah Item*: **Open Sales Order lines** of that item, showing Customer Order, Tanggal Kirim, Qty SO, *Sudah di-rencana* (live plans), *Terkirim*, *Sisa*; ticked rows give the line's demand; the SO lines are named by the **weak pair** (`sal_order_line` id + SO number, §3.1) and shares are kept in `prd_plan_line_demand.qty`. A line may also have **no SO** (flagged *Stok / tanpa SO*) |
| Netting display | Per line: Σ demand, **Stok FG** (warehouse stock of the item via the inventory module), already planned elsewhere, → *Saran Qty* = demand − stock − planned (never forces Qty Rencana) |
| Material view | Plan-level *Kebutuhan Bahan*: every line's BoMs (per station) × Qty Rencana, summed per item, vs stock on hand — the seed of MRP (step 9); read-only |
| Lifecycle | Draft → *Ajukan* → Diajukan → *Setujui* → **Disetujui** → *Tutup* (reason; or closes itself when every line is fully released) ; *Tolak*, *Batalkan* (Draft) final |
| Guards | An SO line may be in only **one live plan** beyond its remaining qty (never over-plan: Σ shares across live plans ≤ SO line remaining, checked under the SO's lock at Ajukan); a plan with a live Perintah cannot be cancelled or closed while Perintah are Draft/Open (Tutup refused like Perintah → BSTB) |
| Permissions | `PRODUCTION_PLAN_VIEW / _CREATE / _EDIT / _SUBMIT / _APPROVE / _CANCEL / _CLOSE` |

### B3. Perintah Produksi becomes derived

| Change | Detail |
| --- | --- |
| Source | `prd_order` gains `plan_line_id` (FK, same module) — **a Perintah is made from one Disetujui plan line**: *Buat Perintah* on the plan page, or *Tambah dari Rencana* in the Perintah form. It starts on the line's Item Target, routing default and quantity left to release |
| Quantity | **Σ Perintah on a plan line may exceed Qty Rencana with a warning** (Walet over-produces for loss and buffer), never silently; one plan line → **many Perintah** (one Perintah = one Partai, AD1, so partial releases through the month are separate Partai) |
| Without a plan | Still allowed for an urgent / ad-hoc job (O4 spirit): the Perintah is shown *Di luar rencana*; a System Default **may** later make the plan mandatory. Recommendation: keep optional now |
| Rest | Requirements, route, BSTB Logistik, hand-over: **unchanged** |
| Tracking | Plan line shows *Dirilis* (Σ live Perintah target) and links to each; Perintah page links back (composed, not embedded); Hasil / Terkirim arrive with steps 6–7 |

### B4. Effect on the later steps

* **Step 9 (MRP)** shrinks to what is left: it reads the approved plan as
  demand (planned independent requirements) and the BoM explosion already shown,
  then proposes Purchase Requests. Pra-SO (material only) feeds only that view.
* **Step 7 reports** gain *Pencapaian Rencana* (plan vs released vs produced vs delivered).
* **Pra-SO vs Open:** only **Open** SO lines can be planned for production (the
  P79 rule: a Pra-SO may only buy material); Pra-SO lines are listed greyed with
  *Belum bisa diproduksi*.

### B5. Questions for the plan

| # | Question | Recommendation |
| --- | --- | --- |
| Q-B1 | Plan period | One month; line start date inside it (weekly later) |
| Q-B2 | Which SO lines? | Open only; Pra-SO shown greyed |
| Q-B3 | Lines without SO (stock build)? | Allow, flagged |
| Q-B4 | Perintah mandatory from a plan? | Optional now, *Di luar rencana* flag |
| Q-B5 | Net against FG stock? | Show and suggest, typed Qty decides |
| Q-B6 | Approval | Ajukan → Setujui like the Customer Order |
| Q-B7 | Mid-month change after approval | Approved plan frozen; change by **Revisi** = reopen to Draft only while **no Perintah exists on the changed line**, else adjust with a reason in record history (no versions table) |
| Q-B8 | Capacity (grams/day per station) and yield (loss per step) | Not now; add as masters later if PPIC needs a feasibility check |
| Q-B9 | Over-release of a plan line | Warn, not refuse |
| Q-B10 | Number | `RP/YYYY/MM/NNNN` (standard) |

---

## C. Build order

| Order | What | Why |
| --- | --- | --- |
| **1** | **Step 4** (Part A) | Independent of the plan; unblocks step 5 (execution) |
| **2** | **Step 4b — Rencana Produksi** (Part B), with the `plan_line_id` link on the Perintah | The Perintah exists but no later document references it yet, so adding its source now is the cheapest moment, and it must exist before MRP |
| 3 | Step 5 Eksekusi onward as in `build-plan.md` | — |

Each step ends at the review gate (build + lint + tests + reconcile, DBML,
decision log, Neon migrate + seed, then stop for the user). Nothing is added to
`Claude-ERP.md` §12 until the user answers the questions above; after that,
step 4 becomes P167 and the plan P168 (numbers indicative).
