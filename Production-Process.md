# Production Process — Walet

> **The living reference for how production works in this ERP, step by step.**
> It is updated in the same commit as every production change, so it always
> describes what is on `main` (✅) and what is still planned (🔜). Decisions
> behind each rule are in `Claude-ERP.md` §12 (P-numbers) and
> `production_project.md` §21g (M-numbers); the business source is
> `walet/walet.md`, and the full worked example is
> `walet/simulation production.md`. The build order is `walet/build-plan.md`.
>
> Last updated: **25/10/2026 — P167** (the hand-over between workstations).

---

## 1. The picture in one paragraph

PPIC raises a **Perintah Produksi**: what to make (Item Target) and how much.
The BoMs say what material that needs at which station. **Logistik** picks
lots from the warehouse and sends them with a **BSTB** to a workstation, where
the station **receives** them (or rejects them back). Each station then
**executes**: it takes what it received and puts out new goods. At the first
hand-over the goods are boxed into **Jobs** and the **Partai** begins. Station
by station, with a BSTB and a receipt each time, the Partai moves through the
route until the finished goods go back to a warehouse. Every gram keeps its
**lot**, so anything in stock can be traced back to the supplier's lot. Costs:
material moves at its value; each station adds its **standard** conversion
cost; the month-end close settles standard to actual.

---

## 2. Identities

| Identity | What it is | Number | Status |
| --- | --- | --- | --- |
| **Lot** | The stock identity of a quantity of one item. One global register (`log_stock_tracking`) for stock and production; a lot keeps its number everywhere it goes. | Bought: typed / `GS_<supplier>_<kode>_<DDMMYY>`; made: `<unit>_<supplier>_<kode barang>_<DDMMYY>`, after a mix `<partai>_<kode barang>`; a clash takes `-2`, `-3` | ✅ register (P163) |
| **Partai** | The production identity cost is tracked on. Started when the first station hands its goods on in Jobs (O3); never split or merged. Carries the Item Target. | `P_<DDMMYY>_<NNNNN>` | ✅ started by the first hand-over (P167), for the Perintah it names |
| **Job** | One box inside a Partai. Made where a station hands its goods on in boxes (stations with a Kode Job: UGH, UML → `UDB`); new Jobs name their parents. One lot may be carried by several Jobs. | `<Kode Job>_<DDMMYY>_<NNNNN>` | ✅ made by the hand-over, a Job per box (P167) |
| **No. Moulding** | The lot a Moulding mix makes from all the Partai's Jobs; belongs to the Partai, no Job. | `<partai>_<kode barang>` | 🔜 (step 5) |

Where goods are inside production: a **bucket** = lot · Job · workstation, or
**in transit** to that workstation. Quantity and value per bucket; Σ value = WIP.

---

## 3. Masters (set up once)

| Master | What it holds | Where | Status |
| --- | --- | --- | --- |
| **Workstation** | Unit code as label (UGH, UPC … UP8) used in document numbers; its **Cost Center**; **Kode Job** if it boxes goods into Jobs; its **Cara Kerja** — *Transformasi* (inputs become new lots), *Pass-through* (the lot is kept), *Mix + Transformasi* (Jobs mixed into the No. Moulding first). The station knows how it works; nothing else chooses it (P166). | Master › Entitas | ✅ |
| **Item** | Barang with Kelola Stok enters production. **Tipe Output** (Utama / Turunan / BJL) and **Bobot Nilai** per base unit, which share an execution's value over its outputs. | Master › Item | ✅ |
| **Bill of Materials** | For one output item **at one workstation** (P166): base quantity and the components that go in there. A suggestion, never a limit. One default per item per workstation. | Produksi › Master Data | ✅ |
| **Routing** | For one Item Target: the workstations in order. Each works by its own Cara Kerja. One default per item. | Produksi › Master Data | ✅ |
| **Standard Cost** | Per workstation and period: a rate per Standard Cost Item (TKL, BOP Mesin, BOP Pabrik) per gram. | Accounting › Pengaturan | ✅ (booked from step 5) |

The Walet showcase (`db:seed-showcase`) sets all of this up: 11 stations,
N-MK 50 g's routing, its BoMs at UP5 (50 g N-NL-PU + box) and UP8 (outer box),
the raw lots in GD-BB.

---

## 4. The flow, step by step

### Step A — Perintah Produksi ✅ (P164, P165, P166)

*Produksi › Operasi Produksi › Perintah Produksi*, `PP_<DDMMYY>_<NNNNN>`.

1. PPIC picks the **Item Target** (e.g. N-MK 50 g) and types the **Qty Target**
   (e.g. 200 pcs).
2. The item's default **Routing** fills the **Rute** — the stations in order.
   Each shows its Cara Kerja and the Item Target's BoM there; the route may be
   edited while Draft.
3. **Kebutuhan Bahan** is worked out, never typed: for each station on the
   route, the Item Target's default BoM there × Qty Target ÷ BoM base quantity.
   For 200 pcs N-MK: N-NL-PU 10.000 g and Box N-MK 200 at UP5, Box Luar 200 at
   UP8. No BoM → no requirement, and what goes in is free.
4. *Buka* locks it (requirements recalculated once more) → **Open**. Logistik
   may now send against it.
5. *Tutup* (reason) once nothing more will be sent — refused while a BSTB from
   it is Draft or still in transit. *Batalkan* only while Draft.

No stock moves, no journal. The Perintah names no lot and no warehouse.

### Step B — BSTB Logistik (Stock Issue) ✅ (P158, P164, P165)

*Persediaan › Operasi Gudang › Stock Issue*, `BSTB_LOG_<DDMMYY>_<NNNNN>`.

1. Choose the **Gudang** and the destination **Workstation**; optionally the
   **Perintah** (O4: packaging sent straight to a station needs none).
2. From a Perintah, the lines start on what that workstation still needs
   (requirements less what was already sent there). *Isi dari Perintah*
   refills for another station.
3. **Pick lots** per line (lot × location, *Isi FEFO*). A Draft may be picked
   in part; Posting needs every line picked in full.
4. **Posting**: stock leaves at the moving average and enters production
   **in transit** to the workstation, under the same lot.
   Journal **Dr WIP / Cr Persediaan**.

### Step C — Receipt at the workstation ✅ (P164)

On the posted BSTB, the station acts on the **whole** sending, on a day it picks:

- **Terima** → goods move from transit into the station's bucket; no journal.
  Only received goods can be worked.
- **Tolak** (reason) → goods return to the same warehouse, location and lot at
  the value they left at. Journal **Dr Persediaan / Cr WIP**.

### Step D — Eksekusi at a station 🔜 (build step 5)

`NG_<unit>_<DDMMYY>_<NNNNN>`. The station picks one Partai it has received
(before the Partai exists, the received stock lots) and executes input → output
in one posting, a section per Job, by its **Cara Kerja**:

- **Transformasi**: inputs (any quantity they hold) → outputs, each a new lot
  registered with the execution as its source; output type from the item;
  status Tersedia / Reject (a Reject stays in production until taken out, O6);
  value = Σ inputs + standard, shared by grams × value weight (BJL and Reject 0).
  At a packing station the BoM pre-fills the inputs.
- **Pass-through**: the lot is kept; extra inputs (wrap, box) are added; weight
  in and out may differ (susut / tambahan).
- **Mix + Transformasi** (Moulding): the Partai's Jobs are first mixed into the
  No. Moulding, then worked.
- **Standard**: grams × the workstation's Standard Cost in force.
  Journal **Dr WIP / Cr WIP / Cr each Standard Cost Item's account** with the
  station's Cost Center.

### Step E — Hand-over between stations ✅ (P167)

*Produksi › Operasi Produksi › Hand-over (BSTB)*, `BSTB_<unit>_<DDMMYY>_<NNNNN>`
after the **sending** unit. Moves goods already in production; no value change,
no journal.

1. Choose the **sending** and **receiving** workstation and the day. The lines
   offer what the sender holds, **received** goods only — never goods still in
   transit.
2. **A Partai goes whole** (AD1): *Isi seluruh P_…* puts every bucket of it at the
   station on the page, every gram; a part is refused. Goods already in a Job
   keep their Job.
3. **Goods with no Partai yet start one** (O3): at a station with a **Kode Job**
   (UGH, UML) the user picks the lots and quantities and gives each line a
   **box**; a lot may be split over boxes by taking it on several lines. The
   hand-over names the **Perintah** (Open, its route passes the sender, not yet
   started): the Partai is started for it and takes its Item Target — one Partai
   per Perintah. A station without a Kode Job cannot start a Partai.
4. **Posting**: the Partai is started, a **Job per box** is made
   (`<Kode Job>_<DDMMYY>_<NNNNN>`), and each line leaves the sender's bucket for
   the receiver's **transit** bucket, under its Partai and Job. Goods without a
   Job at a Kode Job station that already hold a Partai (the No. Moulding) are
   boxed the same way; the new Jobs' parents are every earlier Job of the Partai.
5. The receiver acts on the **whole** sending, on a day it picks: **Terima**
   moves each line's own quantity and value into its bucket; **Tolak** (reason)
   sends them back to the **sender**, same lot and Job, same value. A Draft is
   edited, or cancelled with a reason; a posted hand-over is final. The Perintah
   cannot be closed while its starting hand-over is a Draft or in transit.

### Step F — Leaving production 🔜 (build step 6)

- **Penerimaan Hasil Produksi**: from a station into a warehouse, the lot kept.
  FG at its value (**Dr Persediaan / Cr WIP**), a Turunan at the value it holds
  then, BJL at 0 (no journal).
- **Pemusnahan Produksi**: waste written off, **Dr Beban Pemusnahan / Cr WIP**.

### Step G — Reports 🔜 (build step 7)

Saldo Produksi (Partai · Job · workstation · in transit), Kartu Lot,
**Telusur** (any lot or Job back to the supplier lot and forward to FG and
customer), Rekap Produksi (susut, HPP per gram per station).

### Step H — Month-end close 🔜 (build step 8)

Per Cost Center and Standard Cost Item, the difference between actual cost and
standard booked is spread over the month's executions by grams and followed
into WIP, stock and HPP; the FOH Cost Center is spread evenly first.

### Step I — MRP 🔜 (last)

Demand from Pra-SO and Sales Orders → BoM and routing explosion → planned
Perintah and Purchase Requests.

---

## 5. The N-MK 50 g route (showcase)

| # | Station | Cara Kerja | Kode Job | BoM of N-MK 50 g |
| --- | --- | --- | --- | --- |
| 1 | UGH Grading Halus | Transformasi | UGH | — |
| 2 | UPC Pre Cleaning | Transformasi | — | — |
| 3 | UPY Penyebaran | Transformasi | — | — |
| 4 | UPW Pre Wash | Pass-through | — | — |
| 5 | UCL Cleaning | Pass-through | — | — |
| 6 | UDA Dry A | Transformasi | — | — |
| 7 | UML Moulding | Mix + Transformasi | UDB | — |
| 8 | UWP Wrapping | Pass-through | — | — |
| 9 | UBC Barcoding | Transformasi | — | — |
| 10 | UP5 Packing 95 | Transformasi | — | BOM-NMK-50: 50 g N-NL-PU + 1 Box N-MK |
| 11 | UP8 Packing 98 | Pass-through | — | BOM-NMK-50-UP8: 1 Box Luar |

N-NL-PU is made inside production (at UBC), so on a BSTB to UP5 that line is
removed: it arrives by the hand-over from UBC, not from the warehouse.

*Reject goods (O6): a Reject output stays in production until taken out; when
executions mark Reject (step 5) the whole-Partai hand-over will leave it behind.*

---

## 6. Journals at a glance

| Event | Journal | Status |
| --- | --- | --- |
| BSTB Logistik posted | Dr WIP / Cr Persediaan | ✅ |
| BSTB received | none | ✅ |
| BSTB rejected | Dr Persediaan / Cr WIP | ✅ |
| Station hand-over | none | ✅ |
| Eksekusi | Dr WIP (outputs) / Cr WIP (inputs) / Cr Standard Cost Item accounts | 🔜 |
| Penerimaan Hasil Produksi | Dr Persediaan / Cr WIP | 🔜 |
| Pemusnahan | Dr Beban Pemusnahan / Cr WIP | 🔜 |
| Month-end close | variance to WIP, Persediaan, HPP | 🔜 |

---

## 7. Open questions

| # | Question | When |
| --- | --- | --- |
| — | None open for the built steps. Questions for later steps are added here as they arise. | — |

---

## 8. Change log

| Date | Change | Ref |
| --- | --- | --- |
| 25/10/2026 | Hand-over between workstations: whole Partai, in transit, Terima / Tolak; the first one starts the Partai for a Perintah and boxes goods into Jobs. | P167 |
| 22/10/2026 | Document started. Workstation carries its Cara Kerja; a BoM names the workstation it is used at (one default per item per station); routing and Perintah steps are stations only; requirements = the Item Target's BoM at each route station. | P166 |
| 22/10/2026 | Perintah = Item Target + Qty Target + route; requirements from the BoM; the BSTB picks lots per station. | P165 |
| 22/10/2026 | Perintah Produksi; Stock Issue as the Logistik BSTB, in transit until Terima / Tolak. | P164 |
| 15/10/2026 | One lot register; Partai · Job; bucket lot · Job · workstation (or in transit). | P163 |
| 15/10/2026 | Walet masters: Kode Job, Tipe Output, Bobot Nilai, BoM, Routing; Walet showcase. | P162 |
