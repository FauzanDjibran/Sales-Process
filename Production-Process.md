# Production Process — Walet

> **The living reference for how production works in this ERP, step by step.**
> It is updated in the same commit as every production change, so it always
> describes what is on `main` (✅) and what is still planned (🔜). Decisions
> behind each rule are in `Claude-ERP.md` §12 (P-numbers) and
> `production_project.md` §21g (M-numbers); the business source is
> `walet/walet.md`, and the full worked example is
> `walet/simulation production.md`. The build order is `walet/build-plan.md`.
>
> Last updated: **26/10/2026 — P170** (goods leaving production; before it P169, the Eksekusi, P168, the Rencana, and P167, the hand-over).

---

## 1. The picture in one paragraph

PPIC first makes the **Rencana Produksi** — at each month's end, for the next:
what to make, how much and when to start, from the Open Sales Orders. From the
approved plan PPIC releases **Perintah Produksi**: what to make (Item Target) and how much.
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
| **No. Moulding** | The lot a Moulding mix makes from all the Partai's Jobs; belongs to the Partai, no Job. | `<partai>_<kode barang>` | ✅ made by the Mix run (P169) |

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

### Step 0 — Rencana Produksi ✅ (P168)

*Produksi › Operasi Produksi › Rencana Produksi*, `RP/YYYY/MM/NNNN`. Posts nothing.

1. PPIC picks the **Bulan** (made at the end of the month before) and adds lines:
   an **Item** to make, **Qty Rencana** (typed) and a **Tanggal Mulai** inside the month,
   each item once per start date.
2. *Pilih Sales Order* lists the item's **Open** Sales Order lines — order, due date,
   quantity, delivered, already covered by other live plans, what is left — and the
   part this line covers (starting on what is left). A Pra-SO is shown greyed:
   it may only buy material. A line may cover no Sales Order (a stock build).
3. Beside the quantity: the **demand covered**, the **Stok FG** on hand and a
   **Saran** (demand − stock) with *pakai*. They help; the typed quantity decides.
4. Draft → **Ajukan** (locks the lines and **reserves** the Sales Order quantities under
   their lock; two plans never cover one quantity twice) → **Setujui** (Disetujui) →
   **Tutup Rencana** (reason; refused while a Perintah from it is Draft or Open).
   **Tolak** and **Batalkan** are final, with a reason; Tolak and Tutup release the reservation.
5. The approved plan's page shows **Dirilis** per line (Σ live Perintah), links the
   Perintah, offers **Buat Perintah**, and a **Kebutuhan Bahan** card: the whole plan
   × the BoMs at each station of the items' default Routing, against stock (information only).

*Not built:* capacity (grams per day per station) and yield (loss per step); the plan does not
close itself when fully released; a mid-month change to an approved plan.

### Step A — Perintah Produksi ✅ (P164, P165, P166)

*Produksi › Operasi Produksi › Perintah Produksi*, `PP_<DDMMYY>_<NNNNN>`.

1. PPIC picks the **Item Target** (e.g. N-MK 50 g) and types the **Qty Target**
   (e.g. 200 pcs) — or picks a line of an approved **Rencana Produksi**, which
   fills the item and the quantity not yet released (*Buat Perintah* on the plan
   does the same). A Perintah may exceed its plan line (warned in the plan, never
   refused) and may stand outside any plan (*Di luar rencana*).
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

### Step D — Eksekusi at a station ✅ (P169)

*Produksi › Operasi Produksi › Eksekusi Produksi*, `NG_<unit>_<DDMMYY>_<NNNNN>` after the unit.
One posting at one workstation: the user picks the station, the **kind** its Cara Kerja allows
(*Mix + Transformasi* may do Mix or Transform) and the day, then **a section per Job**.
*Isi dari Barang Workstation* puts the received goods on the page as the kind takes them.
Only **received** goods are worked — never goods in transit and never a Reject; one Partai at
most; a section works one Job.

- **Transformasi**: inputs (any quantity they hold) → free outputs, each a **new lot** (a typed
  number, or `<unit>_<supplier>_<kode barang>_<DDMMYY>` generated, `-2`, `-3` on a clash)
  registered with the run as its source and the one supplier behind its inputs carried; the Job
  of the inputs is kept. **Value = Σ inputs + the section's standard**, shared by **Bobot** =
  qty × the item's Bobot Nilai (whole rupiah, largest remainder); a **BJL or a Reject takes 0**;
  one eligible output needs no weight, two need theirs. A **Reject** output is flagged
  (`prd_balance.is_reject`), stays in production and is not carried by a hand-over (O6).
- **Pass-through**: the **lot is kept** — the main input's bucket whole, extra inputs (a box)
  joining it, the quantity out free (**susut** or **tambahan** shown); same bucket, more value.
- **Mix** (Moulding): the Partai's goods, **whole**, become one lot `<partai>_<kode barang>`,
  no Job, no standard; the hand-over then boxes it into Jobs.
- **Standard**: the section's **Driver** is typed; each Standard Cost Item in force at the
  station on the run's day books round(Driver × rate) into WIP, the outputs carrying it.
- **Posting** (one transaction, with a dry-run journal in the confirmation): **WIP by account**
  — Dr when outputs exceed inputs, Cr when less — and **Cr each Standard Cost Item's account with
  the station's Cost Center**; none when nothing nets. A posted run is final; a Draft is edited
  or cancelled (reason).

*Not built:* a Standard Cost still changes for a period with a posted run (the freeze); a correction
is a new run.

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

### Step F — Leaving production ✅ (P170)

*Produksi › Operasi Produksi › Penerimaan Hasil Produksi* (`PHP_<unit>_<DDMMYY>_<NNNNN>`) and
*Pemusnahan Produksi* (`PMS_<unit>_<DDMMYY>_<NNNNN>`) — one table by purpose, each its own menu,
number and permissions. The user names the **workstation** the goods leave and the day, then picks lines
from what it holds: **received goods, any quantity** (a Reject leaves this way too), never goods in transit;
*Isi semua barang Workstation* takes every bucket whole.

- **Penerimaan Hasil Produksi**: also the **warehouse** (and, where it keeps locations, each line's
  place). Posting takes each line out of its bucket at round(V × q ÷ Q) (V whole when it empties) and brings
  it into stock **under the same lot** at that value — a Turunan at the value it holds then, a **BJL or a
  Reject at 0**. Journal **Dr Persediaan (the category's, else Account Mapping's) / Cr WIP**; none when the
  goods carry no value.
- **Pemusnahan Produksi**: a **reason** (required). The goods are taken out and written off: **Dr Beban
  Pemusnahan Produksi (Account Mapping) / Cr WIP**; nothing enters stock.
- WIP is each item's Kategori Item's, no fallback (M62). A Draft is edited or cancelled (reason); a posted
  document is final; the confirmation shows the journal by dry run.
- **When the last goods of a Partai have left** — nothing of it held at a station, in transit or flagged
  Reject — **its Perintah closes itself** (*Ditutup — seluruhnya keluar produksi*). A Reject holds a Partai
  open until it is received or scrapped (O6).

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
| Eksekusi | WIP by account: Dr when outputs exceed inputs, Cr when less; Cr each Standard Cost Item's account with the station's Cost Center; none when nothing nets | ✅ |
| Penerimaan Hasil Produksi | Dr Persediaan / Cr WIP (a BJL or Reject at 0: no journal) | ✅ |
| Pemusnahan | Dr Beban Pemusnahan Produksi / Cr WIP | ✅ |
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
| 26/10/2026 | Penerimaan Hasil Produksi (lot kept into a warehouse, at the value held) and Pemusnahan Produksi (written off), one table by purpose; a Perintah closes itself when the last goods of its Partai leave. | P170 |
| 25/10/2026 | Eksekusi Produksi: Transformasi (new lots, value by Bobot, BJL and Reject 0), Pass-through (lot kept, extras join, weight free), Mix (the Partai into one lot); the standard per section Driver; journal by dry run. | P169 |
| 25/10/2026 | Rencana Produksi: PPIC's monthly plan over Open Sales Order lines; Perintah released from its lines. | P168 |
| 25/10/2026 | Hand-over between workstations: whole Partai, in transit, Terima / Tolak; the first one starts the Partai for a Perintah and boxes goods into Jobs. | P167 |
| 22/10/2026 | Document started. Workstation carries its Cara Kerja; a BoM names the workstation it is used at (one default per item per station); routing and Perintah steps are stations only; requirements = the Item Target's BoM at each route station. | P166 |
| 22/10/2026 | Perintah = Item Target + Qty Target + route; requirements from the BoM; the BSTB picks lots per station. | P165 |
| 22/10/2026 | Perintah Produksi; Stock Issue as the Logistik BSTB, in transit until Terima / Tolak. | P164 |
| 15/10/2026 | One lot register; Partai · Job; bucket lot · Job · workstation (or in transit). | P163 |
| 15/10/2026 | Walet masters: Kode Job, Tipe Output, Bobot Nilai, BoM, Routing; Walet showcase. | P162 |
