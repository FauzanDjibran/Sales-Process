# Simulation — one Partai from Grading Halus to Finished Goods

> **Purpose:** show, figure by figure, how the ERP would carry one Partai
> through Walet's units (`walet.md` §4) under the direction of
> `production_project.md` §21g (M111–M120), so the open decisions can be
> settled on a concrete case. **Nothing here is built yet.** Written
> 14/10/2026.
>
> **Data:** the workbook's figures do not carry over between its cards
> (`walet.md` §11), so this run uses **one coherent set of invented
> quantities and value weights** in the workbook's style, with the
> **workbook's own standard rates per gram** (Pre Wash 182,86 · Cleaning
> 733,36 · Dry A 0 · Moulding 190,87 · Wrapping 27,13 · Barcoding 41,55).
> Every figure was computed by script: values in whole rupiah, shares by
> largest remainder (P114, M30), standard = round(Driver × rate).

---

## 1. Assumptions

| # | Assumption | Why / status |
| --- | --- | --- |
| S1 | **No Perintah Produksi.** The Partai is the work order: it carries its **Job Order** (target) and each station executes the Partai it received | Decision 1 under review — §5 compares both |
| S2 | **Driver = the grams of each Job section** (input weight; output weight at Barcoding, AD13) | AD22: typed by the user; here filled with the weight |
| S3 | **One standard rate per station** (the workbook's Rp/g). In the ERP it is the sum of the station's Standard Cost Items (e.g. TKL + BOP) on its Standard Cost (M109) | Split into items does not change any total |
| S4 | **No standard at Grading Halus, Pre Cleaning, Penyebaran, Packing** — the workbook shows none | Their actual cost still reaches the goods at the close (M96–M97) |
| S5 | **Pre Wash, Cleaning, Wrapping, Packing 98 are pass-through** with the **same weight in and out** (the workbook's data) | Weight change in a pass-through (loss, or water added) is **held** — §6 F6 |
| S6 | **Value weight per gram on the item** (AD14); BJL weight 0 | Figures invented, in the workbook's range |
| S7 | **One WIP account** for every item in production | In the ERP each Kategori Item names its WIP (M62); only the journal's lines differ |
| S8 | Material bought: **MK-1-0-PTH Rp 6.000/g, MK-1-0-KR Rp 5.000/g**; packaging **box N-MK Rp 3.500**, **outer box Rp 6.000** | Invented |

## 2. Masters the run uses

**Workstations** (each with its Produksi Cost Center, M93): UGH Grading Halus ·
UPC Pre Cleaning · UPY Penyebaran · UPW Pre Wash · UCL Cleaning · UDA Dry A ·
UML Moulding · UWP Wrapping · UBC Barcoding · UP5 Packing 95 · UP8 Packing 98.

**Items** (gram base unless stated):

| Item | Output type | Value weight / g |
| --- | --- | --- |
| MK-1-BSA-PK | Utama | 7.000 |
| MK-2-BSA-KR | Utama | 6.200 |
| KK-0-0-0 | Turunan | 4.000 |
| BS (grading waste) | BJL | 0 |
| SRB (serabut) | BJL | 0 |
| PT-1-BSA-PK | Utama | 7.140 |
| PT-2-BSA-PK | Utama | 6.137 |
| G2-0-0-0 | Utama | 6.269 |
| BS-0-0-0 (sellable BS kind that continues) | Turunan | 3.988 |
| N-NL-KR, N-NL, N-NL-PU | Utama | — (one output each) |
| N-MK 50 g (pcs) | Utama | — |

**BoM** (a suggestion, M-decision of 5b): *N-MK 50 g* = 50 g N-NL-PU + 1 box
N-MK. Packing 98 adds 1 outer box.

**Routing for Job Order N-MK** (target set when the Partai starts): UGH →
UPC → UPY → UPW → UCL → UDA → UML → UWP → UBC → UP5 → UP8.

## 3. Identities in this run

| Identity | In this run | Rule |
| --- | --- | --- |
| **Partai** | **P-0001**, started at the Grading Halus output, Job Order **N-MK** | Never split or merged (AD1); cost tracked on it (M112) |
| **Job** | J-01 … J-10 — a box | New Jobs at a renumbering or a mix, linked to their parents (AD19) |
| **Lot** | one per item per Job, numbered `<execution>-<n>` | New at a transformation; **kept at a pass-through** (M115) |

---

## 4. The run, step by step

Each step names the **document**, what moves, the **production ledger**
(buckets: lot × workstation, Q and V) and the **journal**. Every hand-over is
sent → in transit → *Terima* by the receiving station (M113). An execution
is one posting: inputs + standard → outputs (M114).

### Step 1 — BSTB Logistik (Stock Issue) → UGH · 16/05, received 17/05

| Lot (kept) | Item | g | Value | Rp/g |
| --- | --- | --- | --- | --- |
| LOT-PTH-0516 | MK-1-0-PTH | 40.000 | 240.000.000 | 6.000,00 |
| LOT-KR-0516 | MK-1-0-KR | 10.000 | 50.000.000 | 5.000,00 |
| **Total** | | **50.000** | **290.000.000** | |

- Posting the BSTB: stock pools release the value (moving average); the lots
  are **in transit** to UGH (WIP). UGH's *Terima* 17/05 makes them workable.
- **Journal:** Dr WIP 290.000.000 / Cr Persediaan Bahan Baku 290.000.000.
- No Partai yet: these are stock lots.

### Step 2 — Eksekusi UGH (transformation, outputs free) · 18/05 → **Partai P-0001 starts**

Inputs: both lots, 50.000 g, Rp 290.000.000. Standard: none (S4). Outputs
put into boxes (Jobs); value shared by g × value weight; BJL takes 0.

| Job | Lot | Item | Type | g | Value | Rp/g |
| --- | --- | --- | --- | --- | --- | --- |
| J-01 | UGH1-1 | MK-1-BSA-PK | Utama | 15.000 | 100.032.852 | 6.668,86 |
| J-02 | UGH1-2 | MK-1-BSA-PK | Utama | 15.000 | 100.032.852 | 6.668,86 |
| J-03 | UGH1-3 | MK-2-BSA-KR | Utama | 12.000 | 70.880.420 | 5.906,70 |
| J-04 | UGH1-4 | KK-0-0-0 | Turunan | 5.000 | 19.053.876 | 3.810,78 |
| J-05 | UGH1-5 | BS | BJL | 2.500 | 0 | — |
| | | | **Total** | **49.500** | **290.000.000** | susut **500 g** |

- **Journal:** none (WIP → WIP, no standard).
- **J-04 KK (Turunan) is not needed** in this Partai's route → *Penerimaan
  Hasil Produksi* to Logistik at the value it holds (AD7, §9.2): **Dr
  Persediaan 19.053.876 / Cr WIP 19.053.876**.
- **J-05 BS (BJL)** → *Penerimaan Hasil Produksi* to Logistik **at 0**, so it
  can be sold (AD17): no journal.

### Step 3 — BSTB UGH → UPC · J-01, J-02, J-03 · received 19/05

The whole remaining Partai moves together (AD1). No value changes.

### Step 4 — Eksekusi UPC (outputs free, a section per Job) · 20/05

| Job (kept) | In g | Out: main item | g | Value | Rp/g | SRB (BJL) | Susut |
| --- | --- | --- | --- | --- | --- | --- | --- |
| J-01 | 15.000 | MK-1-BSA-PK (lot UPC1-1) | 14.850 | 100.032.852 | 6.736,22 | 100 g | 50 g |
| J-02 | 15.000 | MK-1-BSA-PK (lot UPC1-2) | 14.900 | 100.032.852 | 6.713,61 | 80 g | 20 g |
| J-03 | 12.000 | MK-2-BSA-KR (lot UPC1-3) | 11.900 | 70.880.420 | 5.956,34 | 70 g | 30 g |

- Each Job keeps its number (walet §4: job → same job); the SRB of all three
  goes to Logistik at 0 (BJL). **Journal:** none.
- *Finding F3:* the main item is unchanged; only a by-product is split off and
  weight is lost — a transformation here gives the main item a **new lot**.

### Step 5 — BSTB UPC → UPY · received 21/05; Eksekusi UPY (re-grading, new Jobs) · 22/05

Inputs: J-01, J-02, J-03 — 41.650 g, Rp 270.946.124. The whole Partai is
graded together; **every new Job has J-01, J-02 and J-03 as parents** (AD19).

| New Job | Lot | Item | g | Value | Rp/g |
| --- | --- | --- | --- | --- | --- |
| J-06 | UPY1-1 | PT-1-BSA-PK | 18.000 | 130.828.606 | 7.268,26 |
| J-07 | UPY1-2 | PT-2-BSA-PK | 15.000 | 93.708.585 | 6.247,24 |
| J-08 | UPY1-3 | G2-0-0-0 | 6.000 | 38.289.660 | 6.381,61 |
| J-09 | UPY1-4 | BS-0-0-0 | 2.000 | 8.119.273 | 4.059,64 |
| | | **Total** | **41.000** | **270.946.124** | susut **650 g** |

**Journal:** none.

### Step 6 — BSTB UPY → UPW; Eksekusi UPW (pass-through) · 23/05

Rate **182,86 Rp/g**, Driver = each Job's grams. **Lots kept**, now at UPW.

| Job | Lot (kept) | g | Value in | Standard | Value out | Rp/g |
| --- | --- | --- | --- | --- | --- | --- |
| J-06 | UPY1-1 | 18.000 | 130.828.606 | 3.291.480 | 134.120.086 | 7.451,12 |
| J-07 | UPY1-2 | 15.000 | 93.708.585 | 2.742.900 | 96.451.485 | 6.430,10 |
| J-08 | UPY1-3 | 6.000 | 38.289.660 | 1.097.160 | 39.386.820 | 6.564,47 |
| J-09 | UPY1-4 | 2.000 | 8.119.273 | 365.720 | 8.484.993 | 4.242,50 |
| | | | | **7.497.260** | | |

**Journal:** Dr WIP 7.497.260 / Cr Standard Cost Item accounts (Cost Center
UPW) 7.497.260.

### Step 7 — BSTB UPW → UCL; Eksekusi UCL (pass-through) · 24/05

Rate **733,36 Rp/g**.

| Job | Lot (kept) | g | Standard | Value out | Rp/g |
| --- | --- | --- | --- | --- | --- |
| J-06 | UPY1-1 | 18.000 | 13.200.480 | 147.320.566 | 8.184,48 |
| J-07 | UPY1-2 | 15.000 | 11.000.400 | 107.451.885 | 7.163,46 |
| J-08 | UPY1-3 | 6.000 | 4.400.160 | 43.786.980 | 7.297,83 |
| J-09 | UPY1-4 | 2.000 | 1.466.720 | 9.951.713 | 4.975,86 |
| | | | **30.067.760** | | |

**Journal:** Dr WIP 30.067.760 / Cr Standard Cost Item accounts (Cost Center
UCL) 30.067.760.

### Step 8 — BSTB UCL → UDA; Eksekusi UDA (transformation per Job) · 26/05

Every kind becomes **N-NL-KR**, −35 % weight; rate 0; **each Job keeps its
number and its value**, so Rp/g rises.

| Job (kept) | New lot | g in → out | Value | Rp/g |
| --- | --- | --- | --- | --- |
| J-06 | UDA1-1 | 18.000 → 11.700 | 147.320.566 | 12.591,50 |
| J-07 | UDA1-2 | 15.000 → 9.750 | 107.451.885 | 11.020,71 |
| J-08 | UDA1-3 | 6.000 → 3.900 | 43.786.980 | 11.227,43 |
| J-09 | UDA1-4 | 2.000 → 1.300 | 9.951.713 | 7.655,16 |
| | | **41.000 → 26.650** | **308.511.144** | |

**Journal:** none.

### Step 9 — BSTB UDA → UML; Eksekusi UML (mix into one Job) · 28/05

The four Jobs are mixed (the workbook's *No. Moulding*) and come out as **one
new Job J-10**, parents J-06…J-09 (AD4, AD19). Rate **190,87 Rp/g ×
26.650 g** = **5.086.686**, once.

| Out | Lot | Item | g | Value | Rp/g |
| --- | --- | --- | --- | --- | --- |
| J-10 | UML1-1 | N-NL | 26.650 | 313.597.830 | 11.767,27 |

**Journal:** Dr WIP 5.086.686 / Cr Standard Cost Item accounts (Cost Center
UML) 5.086.686.

### Step 10 — BSTB UML → UWP; Eksekusi UWP (pass-through) · 30/05

Rate **27,13 Rp/g** × 26.650 = **723.015**. J-10, lot UML1-1 kept:
**314.320.845** (11.794,40 /g). **Journal:** Dr WIP / Cr (Cost Center UWP)
723.015.

### Step 11 — BSTB UWP → UBC; Eksekusi UBC (transformation N-NL → N-NL-PU) · 01/06

Rate **41,55 Rp/g × output** 26.650 g = **1.107.308**. New lot UBC1-1,
N-NL-PU 26.650 g, **315.428.153** (11.835,95 /g). **Journal:** Dr WIP / Cr
(Cost Center UBC) 1.107.308.
*Finding F4:* if N-NL-PU is the same goods with only a code/label change, this
is a pass-through and the lot is kept.

### Step 12 — BSTB Logistik (boxes) → UP5; BSTB UBC → UP5; Eksekusi UP5 (fixed output, BoM) · 04/06

The BoM suggests 50 g N-NL-PU + 1 box per pack; the user enters what was
actually used.

| Input | Qty | Value |
| --- | --- | --- |
| N-NL-PU (lot UBC1-1) | 26.650 g | 315.428.153 |
| Box N-MK (stock, sent by BSTB Logistik) | 533 pcs | 1.865.500 |
| **Output** N-MK 50 g, lot UP51-1, J-10 | **533 pcs** | **317.293.653** (595.297,66 /pcs) |

**Journals:** BSTB Logistik Dr WIP 1.865.500 / Cr Persediaan Bahan Kemas;
the execution none (no standard, S4).

### Step 13 — BSTB UP5 → UP8; Eksekusi UP8 (pass-through + component) · 05/06

533 outer boxes (Rp 3.198.000, sent by BSTB Logistik) join the packs; lot
UP51-1 kept: **320.491.653** (601.297,66 /pcs). **Journal:** BSTB Logistik
Dr WIP 3.198.000 / Cr Persediaan Bahan Kemas.

### Step 14 — Penerimaan Hasil Produksi → Gudang FG · 06/06

533 pcs N-MK 50 g, lot UP51-1, Partai P-0001, Job J-10 into stock at
**320.491.653**. **Journal:** Dr Persediaan Barang Jadi 320.491.653 / Cr WIP
320.491.653.

---

## 5. Totals and checks

### 5.1 Where the value went

| In | Rp | Out | Rp |
| --- | --- | --- | --- |
| Material (Step 1) | 290.000.000 | KK Turunan to stock (Step 2) | 19.053.876 |
| Standard conversion (Steps 6, 7, 9, 10, 11) | 44.482.029 | BS, SRB BJL to stock | 0 |
| Packaging (Steps 12, 13) | 5.063.500 | FG N-MK 50 g (Step 14) | 320.491.653 |
| **Total** | **339.545.529** | **Total** | **339.545.529** |

**WIP at the end = 0.** Susut: 500 + 100 + 650 (+ 14.350 g at Dry A, by
design) — its value stays in the goods (cost in = cost out).

### 5.2 Standard booked per station (credits the station's Standard Cost Items, with its Cost Center)

| UPW | UCL | UML | UWP | UBC | Total |
| --- | --- | --- | --- | --- | --- |
| 7.497.260 | 30.067.760 | 5.086.686 | 723.015 | 1.107.308 | **44.482.029** |

At month end the close compares each Cost Center's actual cost with these
credits and spreads the leftover to wherever the value now is (M96–M98):
the FG in stock, or HPP for what was already sold, or the Turunan in stock.

### 5.3 Documents counted for this one Partai

| Document | Count |
| --- | --- |
| BSTB (Logistik: 3 · station → station: 10) | 13 |
| *Terima* | 13 |
| Eksekusi Produksi | 11 |
| Penerimaan Hasil Produksi (KK, BS, SRB, FG) | 4 |
| Perintah Produksi — **with** S1 | 0 |
| Perintah Produksi — **without** S1 (one per station per Partai) | 11 |

---

## 6. Findings — what to decide from this run

| # | Finding | Proposal |
| --- | --- | --- |
| F1 | **Perintah Produksi adds 11 documents per Partai** that say nothing the Partai (Job Order + Routing) and the BSTB do not already say | Decision 1: **no Perintah**; the Partai is the work order. A *Rencana Partai* (planning) comes with MRP |
| F2 | **Driver per Job section** keeps the standard on the Job that used the station (Steps 6–7) | Driver typed **per section**; the execution's Driver is their sum |
| F3 | **Pre Cleaning** keeps the item, splits off BJL and loses weight | Treat as transformation (new lot) unless F6 decides otherwise |
| F4 | **Barcoding** N-NL → N-NL-PU: a real change of kind, or only a code? | If only a code: pass-through, lot kept |
| F5 | **Turunan and BJL leave the Partai early** (KK, BS, SRB) while the rest moves on whole | Allowed: AD1 applies to what stays in production |
| F6 | **Weight in a pass-through** — loss (drying in air) or gain (water added for volume) | **Held** by the user. Options: (a) exact weight only; (b) loss allowed, gain refused; (c) both, the difference shown as susut / tambahan |
| F7 | **Standard missing at UGH, UPC, UPY, Packing** | Rates to be set, or left 0 and absorbed at the close |
| F8 | **Packaging enters by BSTB Logistik** to the packing station, then the execution uses it | As the Stock Issue today |
| F9 | **Job Order (target) = N-MK** although the material passes N-NL on the way | The target is the final Nama Jual; intermediate kinds are only outputs |
| F10 | **Rp/g rises at every loss** (Dry A: 8.184 → 12.592) — the report should show HPP per gram at each station | Rekap Produksi (Phase 7) |

---

## 7. Answers (14/10/2026)

| # | Answer |
| --- | --- |
| F1 | **A Perintah Produksi still kick-starts the process**: one per Partai, raised by PPIC before the Logistik BSTB; the stations then execute the Partai without further orders (§8.1) |
| F2 | **The standard is per gram** (Driver = grams, per Job section) and goes to **every gram**, as the workbook does (Pre Wash 182,86 × each kind's weight, BS included). The split of an execution's value over its outputs uses the **value weight per gram on the item**; BJL takes 0. **The workbook cannot be reverse-engineered for it**: its Penyebaran card types a *total value per output* (BS 2.492.309,88 · G2 15.822.364,12 · PT-1 63.746.476,21 · PT-2 182.786.460,10) and derives Rp/g from it, with no formula or price list behind it. So the value weight is a figure entered on the item — a *temporary rate* until the real figures are known — seeded from the workbook: BS 3.987,70 · G2 6.268,77 · PT-1 7.140,06 · PT-2 6.136,24 |
| F3 | **A by-product makes a new lot** |
| F4 | **Barcoding is a change**: N-NL → N-NL-PU is a transformation with a new lot |
| F6 | **Pass-through weight is flexible for now**: loss and gain both allowed, the difference shown (susut or tambahan); to be narrowed later if needed |
| F7 | **No standard at a station is fine**: its actual cost is absorbed by the close |

---

## 8. Proposals following the answers (to confirm)

### 8.1 The kick-off Perintah Produksi

| | Proposal |
| --- | --- |
| Raised by | PPIC, **one per Partai**, before anything leaves Logistik |
| Holds | Tanggal produksi · **Job Order** (target, e.g. N-MK) · **Routing** (copied, editable) · the **stock lots planned** for it (item, lot, grams) · Catatan |
| Lifecycle | Draft → *Buka* → Open → *Tutup* (reason) / closes itself when nothing of its Partai is left in production; *Batalkan* (Draft) |
| Starts | The **Logistik BSTB** is raised from it (its planned lots pre-filled) — the Stock Issue names the Perintah |
| Creates the Partai | The **first transformation** of its lots (Grading Halus) creates the **Partai**, linked to the Perintah, with the Job Order copied |
| Afterwards | No more orders: each station receives the Partai by BSTB and executes it (M114) |

### 8.2 Numbering in the workbook's formats

| Identity | Format (from `walet.md` §3) | Example | Series |
| --- | --- | --- | --- |
| **BSTB** (every hand-over, the Logistik one included) | `BSTB_<unit>_<DDMMYY>_<NNNNN>` | `BSTB_LOG_170526_00001` | per sending unit per day |
| **Eksekusi Produksi** (the workbook's *Nomor Grading*) | `NG_<unit>_<DDMMYY>_<NNNNN>` | `NG_UPY_210526_00001` | per unit per day |
| **Job** | `<unit>_<DDMMYY>_<NNNNN>` | `UGH_190526_00001` | per unit per day |
| **Partai** | `P_<DDMMYY>_<NNNNN>` (the workbook's legend, cell CB8; chosen 15/10/2026) | `P_190526_00001` | per day |
| **Lot from a supplier** (ID Stok) | `<unit>_<supplier>_<kode barang>_<DDMMYY>` | `GS_D0001_MK-1-0-PTH_150526` | one per supplier, item and day |
| **Lot made in production** | `<unit>_<supplier>_<kode barang>_<DDMMYY>` while one supplier is behind it; `<partai>_<kode barang>` after a mix (the workbook's ID Stok UML) | `UGH_D0001_MK-1-BSA-PK_180526` · `P_190526_00001_N-NL` | a suffix `-2`, `-3` when taken |
| **Perintah Produksi** | `PP_<DDMMYY>_<NNNNN>` (not in the workbook; agreed 15/10/2026) | `PP_160526_00001` | per day |

This differs from the ERP's numbering rule (P15, the knowledge base's
`doc-numbering=prefix-yyyy-mm-seq`) — under the deviation check.

### 8.3 Moulding, No. Moulding and the new Job

The workbook's Moulding card: *Hasil Grading* 06/04 mixes the Partai's Jobs
into one **No. Moulding** (`P_060426_00001_PT-1-PC-G` = Partai + kode barang;
for a while only it and the Partai exist) → *Persiapan* 07/04 → *Moulding*
08/04 → *Dry B Grading* (Job Order set) → output a **new Job** `UDB_080426_00001`.

| Option | How | Fits when |
| --- | --- | --- |
| **A — one posting** | One execution at UML: inputs are every Job's lots, outputs are the **new Job(s)** (one or more, AD4) with their lots; the **No. Moulding** is recorded on the execution as the mix's identity; parents = every input Job; standard 190,87 × Σ input grams, once | The mixed material does not wait as such between days |
| **B — two postings** | Execution 1 (the mix, *Hasil Grading*): every Job's lots → **one lot numbered as the No. Moulding, with no Job** (Partai only); execution 2 (*Moulding + Dry B*): that lot → the new Job(s). The standard is charged once, on execution 2 (execution 1 has Driver 0) | The mixed material sits in WIP for days, as 06/04 → 08/04 in the workbook |

The workbook's internal job numbers for *Persiapan* (`UML_070426_00001`) and
*Moulding* (`UML_080426_00001`) are steps inside one unit; the workstation is
the smallest unit (M114), so they are not separate Jobs in the ERP.

---

## 9. Decisions (15/10/2026)

| # | Decision |
| --- | --- |
| N1 | **Production identities follow the workbook's numbering** — the deviation check on P15 (`doc-numbering=prefix-yyyy-mm-seq`) answered **D, a Walet-only exception**: BSTB, NG (Eksekusi Produksi), Job, Partai, lot and Perintah Produksi use §8.2's formats; every other document keeps `PREFIX/YYYY/MM/NNNN` |
| N2 | *(superseded by N2′, §10.1)* **Partai: `Pt_<DDMMYY>-<HHMMSS>_A_<unit>`** — date and time it starts and the unit that starts it, e.g. `Pt_190526-135607_A_UGH`. What the **`A`** stands for is open (§10) |
| N3 | **Perintah Produksi: `PP_<DDMMYY>_<NNNNN>`** — one per Partai, the kick-off (§8.1) |
| N4 | *(superseded by N4′, §10.1)* **Moulding is two postings (option B, §8.3)**: (1) the mix — every Job's lots → **one lot named as the No. Moulding** (`<partai>_<kode barang>`), belonging to the Partai with **no Job**; (2) Moulding + Dry B — that lot → **new Job(s)** (one or more, AD4) whose parents are every Job that went into the mix. The standard (190,87 × grams) is charged **once, on (2)**; (1) books none |

## 10. Still open

| # | Question |
| --- | --- |
| Q1 | *Answered — N2′.*|
| Q2 | *Answered — N4′.*|

### 10.1 Answered (15/10/2026) — supersedes N2 and N4

| # | Decision |
| --- | --- |
| N2′ | **Partai = `P_<DDMMYY>_<NNNNN>`**, the format the workbook's legend defines (flow sheet CB8: *P_230526_00001 = Partai*). The rows' `Pt_010426-135607_A_UGH` has no legend and is the only value of its kind; it is not used, and its `A` is ignored |
| N4′ | **Moulding** (all at the Moulding workstation): (1) **Mix** — the Partai's Jobs arrive and are mixed into the **No. Moulding** (`<partai>_<kode barang>`, legend CB6), inside the same Partai, with no Job; no standard. (2) **Moulding** — the No. Moulding is the input; the output is still identified by **No. Moulding + Partai** (a lot `<partai>_<kode barang>` of what came out); the station's standard is charged here. (3) **Leaving the station** — the goods are put into **new Jobs** (`<unit>_<DDMMYY>_<NNNNN>`), exactly as Jobs are first made at the Grading Halus output, only **inside the same Partai**; their parents are the Jobs that went into the mix |
| N5 | **Jobs are made when a station hands its goods on in boxes** — at the Grading Halus output and at the Moulding output; every other station keeps the Job it received |

### 10.2 Still open

| # | Question |
| --- | --- |
| Q3 | The new Job after Moulding: the workbook writes it `UDB_080426_00001` (UDB = Dry B, the last step inside Moulding). Use the Moulding workstation's own code (`UML_…`), or a UDB code? |
| Q4 | When boxing splits one lot into two Jobs (Grading Halus: MK-2-BSA-PK 10.000 g → boxes of 7.000 and 3.000 g), does each box get **its own lot**, or is it **one lot spread over two Jobs**? (Design point for 5c: the production ledger's bucket would then be lot × Job × workstation.) |
