# Walet Production

> **Now the source for `main`** (the user, 14/10/2026; `Claude-ERP.md` P161).
> `main` is built for Walet from here; the ERP as it stood before is kept on the
> branch `before_costing_decision` as the starting point for another company.
> The decisions below are carried into `production_project.md` §21g
> (M111 onward); Walet-only items there apply to `main`. *Until 14/10/2026 this
> file was an isolated exploration.*
>
> **Kept up to date** after every discussion on this topic (§12 logs each one).
> Structure: what Walet does (§1–§7), how it compares with our production
> project (§8), the agreed direction for Walet and what goes to the main project (§9), what is still open (§10),
> source caveats (§11).
>
> **Terms are kept as Walet's shorthand** (BJL, 95, 98, PTH, KR…), not spelt
> out (the user, 14/10/2026).

| | |
| --- | --- |
| Company | Walet — processes raw **sarang burung walet** (swiftlet nest) bought from suppliers into sellable products |
| Product lines (FG classes) | **Reguler**, **Indomie**, **SMK** (Suchan MK) |
| Sources | `Proses Produksi - 05 Februari 2026.xlsx` (definitions; all sheets read) · `Simulasi Flow Costing.xlsx` (simulation; **`flow` sheet only, from the *Logistik* card rightwards** — the cards left of it are ignored, as the user asked) |
| Compared with | `production_project.md` as of P160 (14/10/2026): production ledger, Stock Issue, Job No., costing masters built; Eksekusi Produksi, Penerimaan Hasil, close not yet built |
| Started | 14/10/2026 |

---

## 1. Business at a glance

| Aspect | Walet |
| --- | --- |
| Raw material | Swiftlet nest, *bahan baku kotor* (dirty, in sacks/cartons → 15 kg containers, cold storage) or *bahan bersih* (clean, in mika → 1 kg *box sunrise*) |
| Unit of measure | **Gram** through production; cost read as **HPP per gram** |
| Nature of the process | Cleaning, sorting and reshaping a natural product: **one input kind becomes several kinds** (grades, shapes, by-products, waste) with **weight loss** at most steps (washing, plucking, drying) |
| Organisation | Departemen › Bagian › Work Station › **Unit** (e.g. Produksi › Cleaning › Cleaning › *Pre Wash*). The simulation's stations are **Units**, each with a unit code (§3.3) |
| Phases (process doc) | **Fase 1 Bahan Baku** (receipt → grading → pre-cleaning → timbang penyebaran → steam) · **Fase 2 Produksi** (pre-wash → cabut → drying → moulding → packing) · **Finish Goods** (logistic) |
| Status of the goods (process doc) | *Bahan Baku* up to and including Steam; *WIP* from Pre-Wash; *FG* from Packing |
| Outsourcing | **Makloon Home Industry (HI)** may do Pre-Wash, Cabut, Drying A and Moulding & Drying B (Reguler line) |
| Quality | A QC unit (QMS & Engineering) checks most stations; CCP1 (RO water wash 30 s), CCP2 (steam 70 °C core, 5 s); nitrit test per Sales Order; **rework loops** back to earlier stations (§5.3) |

---

## 2. Item classification

### 2.1 Kode Barang (raw and in-process)

Built as **Jenis – Ukuran – Bulu – Warna** (legend of the simulation:
`MK-1-0-PTH` = MK jenis · 1 ukuran · 0 bulu · PTH warna).

| Dimension | Values (process doc) |
| --- | --- |
| **Jenis / Bentuk** | MK Mangkok · PT Patahan · OV Oval · SD Sudut · KK Kakian · RN Rontokan · G2 Grade 2 (non-standard colour, *tanahan*, torn) · BS (unusable: rontokan, renda, serabut, broken kakian) · SRB Serabut |
| **Ukuran** | Patahan: 1 besar · 2 sedang · 3 sedang-kecil · 4 kecil (P × L). Mangkok: 1 besar · 2 sedang · 3 kecil (lebar). `0` = not yet graded |
| **Bulu** (feather content) | BSA sedikit · BSB banyak · `0` = not graded |
| **Warna** | Putih · Krem · Kuning. Codes: **PTH** (putih), **KR** (krem), **PK** (putih kalsium); **PC**, **PU** and the suffix **G** are of the same kind — used as shorthand |
| **Keutuhan** | Utuh · Sobek berat · Sobek ringan |
| Purchase kinds (Sheet2) | MK-1, MK-2, OVAL, PTH PUTIH VIP, PTH PUTIH A/B, PTH KREM A/B, RAMPAS PUTIH/KREM, SUDUT, PTH-3, KAKIAN |

### 2.2 Classes made in production

| Class | Made from |
| --- | --- |
| **SMK** | Patahan 3 and G2 |
| **N-NL** (Natural – Noodle) | P1, P2, P3, Krem and G2 |
| **C-MK** | KK (kakian) |
| Moulding grades | **A-MK, G-MK, J-MK, N-MK** — a quality letter + jenis (data "menunggu Nina") |
| Customer spec (Sheet3) | N-MK1 p / k (> 4,4 cm tall), N-MK2 (4–4,3 cm), N-MK3 (< 4 cm); a customer may ask more (Merk ABC > 4,7 cm) |

Which class a material goes to is **decided by PPIC when planning the
penyebaran** (process doc, Drying A).

### 2.3 Nama Jual (FG)

The FG item, named at packing ("diberi stiker nama jual"), e.g. `N-MK`, 100 g
per pack in the simulation. Packed primary (vacuum / POF shrink), secondary
(plastic / mika / acrylic box), tertiary (carton, foam, bubble wrap, fragile
label — export).

---

## 3. Identities and numbering

### 3.1 The identities

| Identity | What it is | Born | Lives until |
| --- | --- | --- | --- |
| **ID Stok** | Stock identity of a quantity of one Kode Barang: `<unit>_<supplier>_<kode barang>_<DDMMYY>`, e.g. `GS_D0001_MK-1-0-PTH_150526` — the **supplier and date stay in it** as the material changes kind (`GS_D0001_MK-2-BSA-PK_180526`) | Grading Sampling; re-made at each grading | Grading Halus output (then jobs take over); appears again at Moulding (*ID Stok UML*), Barcoding output and Packing |
| **Nomor Job** | **One box** of material. Everything in the box keeps the job number, however many kinds it splits into (`UGH_190526_00001`: MK-2 7.000 g → MK-2 6.900 g + KK 100 g) | First at Grading Halus output | **Re-numbered** at Penyebaran (`UPY_…`), inside Moulding (`UML_…`) and at Moulding output (`UDB_…`) |
| **Partai** | **A group of jobs that must move together** from its creation; the unit cost is tracked on (`Pt_010426-135607_A_UGH`) | Penyebaran output | To the end of production (still on every Barcoding row) |
| **No. Moulding** (*ID Stok UML*) | At Moulding all jobs of a partai are **mixed** into one: `P_060426_00001_PT-1-PC-G` = partai + Kode Barang. For a while only **No. Moulding and Partai** exist | Moulding (*Hasil Grading*) | Moulding output: dropped, and **new Nomor Job(s)** are created, still within the partai |
| **Job Order** | The **target class** a job is worked to, e.g. `N-NL`, `N-MK-PC` (= Kualitas · Jenis · Warna) | Seen from Moulding (`-` at Persiapan, set at Dry B Grading) | Packing |
| **Nomor Kati** | The pack identity at packing (*kati*, a weight unit used in the nest trade) | Packing 95 *Assembly* | FG |
| **QR CAIQ** | A traceability code captured at packing (presumably the China export traceability label — to confirm) | Packing 95 *Assembly* | FG |
| **Nama Jual** | The FG item (§2.3) | Packing 95 *Assembly* | Sale |

### 3.2 Documents

| Document | Meaning | Number |
| --- | --- | --- |
| **BSTB** | *Bukti Serah Terima Barang* — the hand-over from one unit to the next, written at each unit's **Output** | `BSTB_<unit>_<DDMMYY>_<NNNNN>` |
| **NG** | *Nomor Grading* — the record of a grading / transformation step inside a unit | `NG_<unit>_<DDMMYY>_<NNNNN>` |
| Nomor Job | — | `<unit>_<DDMMYY>_<NNNNN>`; the Moulding legend also shows `<partai>_<NNN>` |
| Partai | — | rows use `Pt_<DDMMYY>-<HHMMSS>_A_<unit>`; the legend shows `P_<DDMMYY>_<NNNNN>` (format to confirm) |

### 3.3 Unit codes

GS Grading Sampling · LOG Logistik · UGH Grading Halus · UPC Pre Cleaning ·
UPY Penyebaran · UPW Pre Wash · UCL Cleaning · UDA Dry A · UML Moulding ·
UDB Dry B · UWP Wrapping · UBC Barcoding · UP5 Packing 95.

---

## 4. The flow in the simulation (Logistik → Finished Goods)

Each card has the same shape: **Input** (dated, received from the previous
unit's BSTB) → optional **Grading / processing** (dated, an NG, per job: what
went in, what came out) → **Output** (dated, its own BSTB to the next unit).

| # | Unit | Identity in → out | What happens to the goods | Cost added |
| --- | --- | --- | --- | --- |
| 1 | **Logistik** (LOG) — *the Stock Issue* | ID Stok → ID Stok | Issues 2 stock lots, MK-1-0-PTH 40.000 g and MK-1-0-KR 10.000 g, to Grading Halus. Input 16/05, Output 17/05 (`BSTB_LOG_170526_00001`) | none shown |
| 2 | **Grading Halus** (UGH) | ID Stok → new ID Stok → **Nomor Job** | Grading (`NG_UGH_180526_00001`): MK-1-0-PTH → MK-1-BSA-PK 40.000 · MK-2-BSA-PK 10.000 · KK-0-0-0 10.000. Output 19/05: MK-2-BSA-PK put into **two boxes**, 7.000 g → job `UGH_190526_00001`, 3.000 g → `…00002` | none shown |
| 3 | **Pre Cleaning** (UPC) | job → same job | Per job: 01: 7.000 → MK-2-BSA-PK 6.900 + KK 100 · 02: 3.000 → MK-2-BSA-PK 2.900 + SRB 90 (10 g lost). Output 21/05 | none shown |
| 4 | **Penyebaran** (UPY) | job → **new job + Partai** | Grading (`NG_UPY_210526_00001`) into BS 625 · G2-0-0-0 2.524 · PT-1-BSA-KR 8.928 · PT-2-BSA-KR 29.788 (41.865 g). **First card with value**: HPP/g 3.987,70 · 6.268,77 · 7.140,06 · 6.136,24 — Rp 264.847.610,31. Output: each line a new job `UPY_010426_00001…04`, **all in Partai** `Pt_010426-135607_A_UGH` | — (material value enters here) |
| 5 | **Pre Wash** (UPW) | job / partai unchanged | Same kinds, same weights, job by job | **182,86 Rp/g × input weight** → Rp 272.503.197,62 |
| 6 | **Cleaning** (UCL) | unchanged | Same kinds, same weights | **733,36 Rp/g × input weight** → Rp 303.205.333,29 |
| 7 | **Dry A** (UDA) | job unchanged, kind changes | Per job every kind becomes **N-NL-KR** with weight loss: 625 → 410 · 2.524 → 1.644 · 8.928 → 5.827 · 29.788 → 19.342 (41.865 → 27.223 g, −35 %). Each job keeps its value, so HPP/g rises (7.475 · 11.031 · 12.344 · 10.861) | rate 0 |
| 8 | **Moulding** (UML) | 4 jobs → **one No. Moulding** → new job | *Hasil Grading* 06/04: the 4 jobs mixed into ID Stok UML `P_060426_00001_PT-1-PC-G`, 27.223 g. *Persiapan* 07/04 (job `UML_070426_00001`, Job Order `-`) → *Moulding* 08/04 (`UML_080426_00001`) → *Dry B Grading* (Job Order → **N-NL**). Output: new job **`UDB_080426_00001`**, Job Order N-NL, Partai unchanged | **190,87 Rp/g × Σ input weight**, once → Rp 308.401.456,82 (11.328,71 /g) |
| 9 | **Wrapping** (UWP) | unchanged | Same weight | **27,13 Rp/g** → Rp 309.140.128,36 |
| 10 | **Barcoding** (UBC) | job → **ID Stok** | Output row carries Partai, ID Stok `N-NL`, kind **N-NL-PU** | **41,55 Rp/g × output weight** → Rp 310.271.113,59 (11.397,39 /g) |
| 11 | **Packing 95** (UP5) | ID Stok → **Nomor Kati + Nama Jual** | *Assembly*: Nomor Kati, ID Stok, Jenis, Berat, **QR CAIQ**, **Nama Jual**. Output 06/06 (`BSTB_UP5_060626_00001`): Nomor Kati · Nama Jual · Berat | *Biaya Packaging* column (empty) |
| 12 | **Packing 98** | Nomor Kati | Nomor Kati · Nama Jual (`N-MK`, 100) · Berat. (**95** = the pieces go into a box; **98** = the box goes into a finer box) | — |
| 13 | **Finished Goods** | Nomor Kati | Received by BSTB: Nomor Kati · Nama Jual · Berat | — |

**Arithmetic used throughout:** Total = Berat × HPP/g; Biaya unit = rate ×
weight; Total HPP = Total + Biaya; the next unit's HPP/g = Total HPP ÷ its
weight — so **weight loss raises the cost per gram and the value is kept**
(cost in = cost out). Figures are not rounded.

---

## 5. Routing per product line (process doc)

### 5.1 Shared start (Fase 1)

Bahan masuk dari supplier (**received without a PO**) → **Grading Sampling**
(50–100 % sampled at Walet, 10–15 % for off-island purchases, 100 % for bahan
bersih; informs Purchasing's price negotiation) → **PO based on the grading
result** → **Penerimaan per PO, off-spec returned** → Grading Halus →
Pre-cleaning → **Timbang Penyebaran** (by PPIC's plan: production date,
material identity and **job number** given; stored in cold storage).

### 5.2 The three lines (Fase 2)

| Line | Route after Timbang Penyebaran |
| --- | --- |
| **Reguler** | Pre-Wash *(HI)* → Penirisan → Cabut-1 *(HI)* → Rambang / Titil → CCP-1 → Sortir → Moulding Hancuran → Drying A *(HI)* → Moulding & Drying B *(HI)* → WIP Steam & Steam → Packing Primer (Wrapping, Barcoding) → Final Grading → Packing → FG |
| **Indomie** | (+ Lepas Serabut) → Steam Bahan Baku → Pre-Wash + Cabut Bulu Besar → Rambang → Penirisan → Cabut-1 → CCP-1 / Rambang → Sortir / Titil → **Moulding Indomie** → Drying A → Sortir Kering → Packing → FG (no Dry B, no wrapping / barcoding) |
| **SMK** | Steam Bahan Baku → Pre-Wash + Lepas Serabut → Penirisan-1 → **Potong Kaki** → Cabut Bulu Besar → Penirisan-2 → Cabut-1 → CCP-1 / Rambang → Sortir / Titil → Grading → **Moulding-1** → Drying A → **Moulding-2 + Sortir 2** → WIP Steam & Steam → Packing Primer & Sekunder (Wrapping, Barcoding) → Final Grading → Packing Tersier → FG |

The simulation's units are coarser than these steps: *Cleaning* covers
Penirisan, Cabut, Rambang, Titil, CCP-1 and Sortir; *Moulding* covers
Persiapan, Moulding and Dry B.

### 5.3 Rework and QC

- **Rework** loops: nitrit above standard; fine feathers still found; shape
  not to standard → back to an earlier unit. Sheet2: a rework *to raise the
  quality* needs the **Production Manager's approval**.
- QC units follow Grading Sampling, Grading Halus, Pre Cleaning, Pre Wash,
  Cabut, Drying A, Moulding & Drying B, WIP Steam, Wrapping, Final Grading and
  Packing.

---

## 6. Costing in Walet

| Topic | Walet |
| --- | --- |
| Material | Purchase price per kind (*harga beli bahan*); in the simulation material value first shows at Penyebaran, **different per kind** after grading |
| Conversion | **A rate per gram per unit**, applied to the weight the unit handles (input weight, or output weight at Barcoding), added to the job's value at that unit. Rates in the simulation: Pre Wash 182,86 · Cleaning 733,36 · Dry A 0 · Moulding 190,87 · Wrapping 27,13 · Barcoding 41,55 Rp/g. They are **standard rates set beforehand** (AD12) |
| *Komponen HPP* (process doc) | Cumulative by stage: labour and overhead of **warehouse, cold storage, grading kasar, grading halus, pre-cleaning, steamer, pre-wash, cabut, drying, moulding & drying B, packing**; plus **harga beli bahan**, **biaya kirim barang retur ke supplier**, **bahan kemas dan label** |
| Loss | Absorbed by the good output: HPP/g rises, value kept |
| Tracked on | The **Partai** (the user: partai is used to track cost) and, within it, the job |
| Packaging | *Biaya Packaging* at Packing 95; *bahan kemas & label* in the HPP |

---

## 7. Waste and by-products

| Station (process doc) | Waste / by-product | Where it goes |
| --- | --- | --- |
| Grading Sampling | BS (rontokan, renda, sapuan kotor, serabut, broken kakian) | — |
| Grading Halus | G2, BS (broken kakian, renda, serabut) | **To Logistik, to be sold** |
| Pre-cleaning | Kuningan, karat, rontokan bahan / flek / serabut, styrofoam, kayu — **each weighed in the production report** | **To Logistik, to be sold** |
| Pre-wash | Pasir, bulu (recorded at Cabut, not here) | — |
| Cabut | Bulu, hancuran bubur, hancuran kotor, sapuan kotor, titilan; *hancuran bersih* recorded | Hancuran is moulded (Moulding Hancuran) |
| Drying A | Sapuan kotor, sapuan bersih | — |
| Moulding & Drying B | Sapuan kotor, lem, hancuran bubur / kotor, rontokan, sapuan bersih | — |

In the simulation **BS and G2 continue into production** (Penyebaran → Dry A
→ N-NL-KR), consistent with N-NL being made from G2.

---

## 8. Comparison with our production project

### 8.1 What already fits

| Walet | Our production project |
| --- | --- |
| Logistik card: stock lots (ID Stok) handed to a unit | **Stock Issue** (P158): Gudang → Workstation, picked by lot, Dr WIP / Cr Persediaan |
| A unit transforms one kind into several, with loss, value kept | **Eksekusi Produksi** (`production_project.md` §9.2): inputs → outputs, cost in = cost out, value shared by *Bobot Biaya*, susut absorbed (G3, M14) |
| A job splits into several kinds and all keep the job number | **Job No. carried** when one job is among the inputs (M41, M101) |
| Moulding mixes a partai's jobs into one | **Job Baru** with all input jobs as parents (M41) |
| Value per box at each unit | **Production ledger**: Q and V per lot per workstation, never pooled (P157) |
| Conversion rate per gram per unit | **Standard Cost per workstation × Driver** (M92, M109) — with **Driver = grams** |
| Labour and overhead per stage (*Komponen HPP*) | **Cost Center per workstation** + Jenis Biaya → Standard Cost Item; the close settles to actual (M96–M99, M110) |
| Packaging material added at packing | Packaging lots issued to the packing workstation, joining without changing the job (M41) |
| FG to the FG warehouse | **Penerimaan Hasil Produksi** (`production_project.md` §9.4) |
| Tracing FG back to supplier material | Genealogy and *Telusur Produksi* (M102) |
| Units as user master data, no routing | **Workstation** master, no BoM (G9, G10) — the three lines need no routing table |

### 8.2 Gaps — Walet needs what we do not have, and how each is settled

| # | Gap | Nearest thing we have | Settled by |
| --- | --- | --- | --- |
| AG1 | **Partai** — a group of jobs above Job No., moving together, cost tracked on it | Nothing above Job No. | AD1, AD18 — the Partai is our Job No. |
| AG2 | **Many jobs in one station run, each kept apart** | One execution = one job (M41) | AD20 — a section per Sub Job No. |
| AG3 | **Splitting into several new jobs** (Grading Halus, Penyebaran, Moulding output) | At most one new job per execution | AD19 — new Sub Job No.s |
| AG4 | **Hand-over between stations (BSTB)** | Pull (M2): no transfer | AD9 |
| AG5 | **Pass-through stations** that only add cost (Pre Wash, Cleaning, Wrapping) | Every execution makes new output lots (M42) | AD8, §9.4 (Phase 5 review) |
| AG6 | **Identity inside production by job + kind** | Lot per output (M22, M42) | AD8, §9.4 |
| AG7 | **Splitting value by kind, not weight** | *Bobot Biaya*, default = quantity | AD6 |
| AG8 | **Job Order** — the target class | *Rencana Output* (information only) | AD5 |
| AG9 | **By-products with their own treatment** | Reject at 0 (M56), Pemusnahan | AD7 |
| AG10 | **Item variants** (jenis × ukuran × bulu × warna) | One Item per code | Parked — decided at build time (AP1) |
| AG11 | **FG pack identity** — Nomor Kati, QR CAIQ | Stock lot | Parked — ignored for now (AP2) |
| AG12 | **Outsourcing to Home Industry (HI)** | Not covered | Parked — out of scope (AP3) |
| AG13 | **Rework with approval** | An execution at an earlier workstation | Parked — out of scope (AP4) |
| AG14 | **QC / CCP / nitrit records** | None | Parked — out of scope (AP5) |
| AG15 | **Unit hierarchy** Departemen › Bagian › Work Station › Unit | Flat Workstation | AD11 |
| AG16 | **Fase 1 purchasing** — receipt before PO, PO from grading, retur, landed cost | Receipt Note from an Open PO | Parked — out of scope (AP6) |

### 8.3 Differences from the production project — settled (14/10/2026)

Each difference went through the deviation check: **A** Walet follows our
rule · **B** change our rule for everyone · **C** a second concept (option)
· **D** an Walet-only exception. The production project is not changed by any
of them (the pass-through point goes to the Phase 5 review, §9.4).

| # | Production project | Walet | Outcome |
| --- | --- | --- | --- |
| D1 | **M2 Pull** — output waits where made; any run takes it | Push: send → transit → receive whole (AD9, AD15) | **D** — Walet-only exception |
| D2 | **M41** — one execution carries one Job No. | Several of Walet's jobs (boxes) worked in one run | **Bridged, no deviation** — our **Job No. = Walet's Partai**; Walet's *Nomor Job* is a **Sub Job No.** under it (AD18–AD20). One run per Job No. still holds |
| D3 | **M41 / M101** — Job No. carried; at most one new job per run | Renumbering and splitting at Grading Halus, Penyebaran, Moulding | **Bridged, no deviation** — they are new **Sub Job No.s** inside the same Job No. (AD19) |
| D4 | **M42** — every output a new, unique lot | A lot kept while the item is not transformed | **No deviation on lots**: receipt assigns a lot, an issue and a transformation know the lots consumed, a new output gets a new lot — as in the main project. The real point is the **pass-through station** (no transformation, only the station's standard cost): it should keep the lot. **Candidate for the main project** — paragraph for the Phase 5 review in §9.4 |
| D5 | **M57** — Bobot Biaya defaults to quantity | Weight × a value figure on the item (AD6, AD14) | **D** — Walet-only for now; later perhaps a **Kategori Item weighing more than another** in cost spreading, for everyone |
| D6 | **M56** — an output marked Reject per run takes 0 | Utama / Turunan / BJL fixed on the item; BJL takes 0 (AD7, AD17) | **Both kept, as two separate things**: the **item type** (Utama / Turunan / BJL, on the item — Walet-only) and the **status** from the QC check per run (Tersedia / Reject — M56 unchanged). A Utama or Turunan marked Reject also takes no cost (AD21) |
| D7 | **M104** — Driver is a bare number typed per run | Driver = input or output weight (AD13) | **A — no deviation**: it is still the Driver; Walet fills it with weight (AD22) |
| — | Whole rupiah per bucket (P114, P157) | Simulation unrounded | Presentation only; no decision needed |

---

## 9. Agreed direction for Walet (14/10/2026)

### 9.1 Decisions

Rows marked *amended* are read together with the decision named.

| # | Decision |
| --- | --- |
| AD1 | **Partai is a hard rule.** A partai is **never split or merged**; every station takes the whole partai. Cost is tracked on it. *Amended by AD18: the partai is our Job No., started at the Grading Halus output.* |
| AD2 | **A new job number is a new number linked to the old one(s)** as parents, so an FG traces back through every renumbering (UGH → UPY → UML → UDB) to the stock lot. *Amended by AD19: these are Sub Job No.s inside one Job No.* |
| AD3 | **One station document per partai**, holding **a section per job** with that job's inputs and outputs; it posts once, each job keeping its own number and value. *Amended by AD20: one run per Job No., a section per Sub Job No.* |
| AD4 | **The Moulding output splits into one or more new jobs, as the user decides**, each having all of the partai's earlier jobs as parents. *Amended by AD19: new Sub Job No.s.* |
| AD5 | **Job Order is the target planned from the start** — what the partai is meant to become at the end, set when it is created. Along the way goods may turn into something else (a bad product, mishandling); the outputs record what they actually became, the target stays. |
| AD6 | **Input value is shared over the output items by a value weight per item** (weight × the item's relative value), not by weight alone. Walet-only (D5). |
| AD7 | **Three output types, fixed on the item: Utama, Turunan, BJL** (BJL is a name, not an abbreviation). **Utama and Turunan share the cost** (AD6); **BJL takes 0**. A BJL leaving production goes out **by a document** — at 0 it still has a use. A **Turunan may be taken out when not needed, at the value it holds then** (§9.2). |
| AD8 | **Every stock everywhere has a lot number** — its identity as stock — and **a job is filled with lot numbers**, so it is known which lots it handles. Receipt assigns the lot; an issue and a transformation record the lots consumed; a new output gets a new lot. **A pass-through station (no transformation, only its standard cost) keeps the lot** (§9.4). |
| AD9 | **Push, in two steps.** The sending station posts the hand-over (BSTB); the receiving station **confirms receipt** (its Input date), and only then can it work the goods. In between they are **in transit**. Walet-only (D1). |
| AD10 | **One continuous production from the Logistik Stock Issue.** Grading Halus, Pre Cleaning and Penyebaran are workstations inside production (WIP); nothing goes back to stock in between. *Production 1* and *Production 2* only explain the process. |
| AD11 | **Our Workstation is Walet's Unit.** Departemen and Bagian are not modelled. |
| AD12 | **Conversion cost in the simulation is standard cost**: each station's rate per gram is set beforehand — our Standard Cost per workstation (M92, M109). |
| AD13 | **Each workstation's standard runs on input or output weight** as Walet's practice says (AQ15; the simulation uses input weight, output at Barcoding). *Amended by AD22: the user enters that weight as the Driver.* |
| AD14 | **The value weight is a figure on the item** (AQ16): each Kode Barang carries its relative value per gram (e.g. PT-1 7.140, G2 6.269, BS 3.988), updated now and then. |
| AD15 | **Goods in transit sit in a transit position, still WIP, until received; the receiver takes the whole hand-over or rejects it whole**, sending it back (AQ17; consistent with AD1). |
| AD16 | **The stations before Penyebaran work the same way**: push with send + receive, a run holding a section per Sub Job No. *Amended by AD18: they already run under the Job No.* |
| AD17 | **A BJL goes into stock at 0**, so Logistik can sell it, and **any station may output BJL** (AQ19). |
| AD18 | **Our Job No. is Walet's Partai** (D2). In the ERP the **Job No. starts at the Grading Halus output**; Walet calls it a *partai* from Penyebaran on, but it is one Job No. throughout. It is never merged (AD1), so *Job Baru* (M41) is not used. |
| AD19 | **Walet's *Nomor Job* (one box) is a *Sub Job No.* under the Job No.** — named so *for now*. A renumbering (UGH → UPY → UML → UDB), a split into boxes, and the Moulding output are **new Sub Job No.s inside the same Job No.**, linked to the ones they came from. Moulding mixes Sub Job No.s, never Job No.s. |
| AD20 | **One run per Job No. per station**, with **a section per Sub Job No.** — so M41's one Job No. per execution holds unchanged. |
| AD21 | **Item type and status are separate.** The **type** (Utama / Turunan / BJL) is fixed on the item. The **status** (Tersedia / Reject) is set per output **from the QC check**. A Utama or Turunan output marked Reject takes no cost, like a BJL (M56 unchanged). |
| AD22 | **The Driver stays a typed number** (M104); Walet fills it with the station's input or output weight. No automatic Driver. |

### 9.2 Confirmed: a Turunan taken out carries its current value under standard costing

Each run books its standard into WIP (M92), so a bucket's value at any moment
is its material plus the standards absorbed so far. Taking a Turunan out uses
`takeFromBucket`: round(V × q ÷ Q), the value it holds then. At month end the
close follows the leftover to wherever the value went (M98): into stock for
the quantity still there, into HPP for what was sold — so a Turunan taken out
also takes its share of the variance.

### 9.3 Parked

| # | Item | Status |
| --- | --- | --- |
| AP1 | Item variants (AG10) | Decided at build time |
| AP2 | Nomor Kati, QR CAIQ (AG11) | Ignored for now |
| AP3 | Makloon Home Industry (AG12) | Out of scope |
| AP4 | Rework and its approval (AG13) | Out of scope |
| AP5 | QC, CCP, nitrit records (AG14) | Out of scope |
| AP6 | Fase 1 purchasing: receipt before PO, PO from grading, retur, landed cost (AG16) | Out of scope; the flow starts at the Logistik Stock Issue |

### 9.4 For the main project — paragraph to insert at the Phase 5 review

Written to stand on its own in `production_project.md`, without naming Walet:

> **Pass-through run keeps the lot (proposed amendment to M42).** Today every
> Eksekusi Produksi output is a new lot whose number was never used before
> (M42), even when a workstation only works the goods without changing them —
> a washing, drying-by-air or wrapping step whose output is the same item as
> its input and whose only effect is the station's standard cost (M92). The
> lot is the item's identity as stock: a receipt assigns it, an issue and a
> transformation record the lots consumed, and a **new item** gets a **new
> lot**. An item that is not transformed should therefore **keep its lot**:
> the run takes the bucket at its value, adds round(Driver × rate) of each
> Standard Cost Item, and places the same lot at the run's workstation as a
> new bucket; the genealogy still records the run, and the Job No. is carried
> as today. A different item, or several input lots joined into one output,
> still gets a new lot. **To settle:** (1) a *pass-through* flag on the
> workstation, or decided per output line (same item, one input lot);
> (2) whether a pass-through may lose weight and still keep the lot, or must
> put out exactly what it took; (3) a partial take — the lot then sits at two
> workstations as two buckets, which the production ledger already allows.

**Later candidate (not Phase 5):** a **Kategori Item that weighs more than
another in cost spreading** — a default for Bobot Biaya beyond quantity
(from D5).

---

## 10. Questions

### 10.1 Answered

| # | Question | Answer |
| --- | --- | --- |
| AQ1 | When is a partai created; split or merged later? | At Penyebaran; never (AD1) |
| AQ2 | Is "partai moves together" a hard rule? | Yes (AD1) |
| AQ3 | Why are job numbers re-made? | Each is a new job linked to the old (AD2) |
| AQ4 | One No. Moulding → how many jobs? | One or more, the user decides (AD4) |
| AQ5 | Job Order — who and when? | The target planned from the start (AD5) |
| AQ6 | Rates set or computed? | Set beforehand — standard (AD12) |
| AQ7 | Value split over kinds? | Value weight per kind (AD6) |
| AQ8 | Grading Halus / Pre Cleaning: production or stock? | Production, one continuous run (AD10) |
| AQ9 | Packing 95 / 98? | 95: pieces into a box; 98: the box into a finer box |
| AQ10 | Nomor Kati, QR CAIQ? | Ignored for now (AP2) |
| AQ11 | Colour codes? | PTH, KR, PK, and PC, PU, G of the same kind (§2.1) |
| AQ12 | By-products? | Utama / Turunan / BJL (AD7) |
| AQ13 | Home Industry? | Out of scope (AP3) |
| AQ14 | Rework? | Out of scope (AP4) |

| AQ15 | Which weight drives each station's standard? | Set per workstation (AD13) |
| AQ16 | Where is an output item's value weight kept? | A figure on the item (AD14) |
| AQ17 | Goods in transit; may the receiver refuse? | Transit position; received or rejected whole (AD15) |
| AQ18 | Runs and hand-overs before the partai exists? | The same, grouped by hand-over (AD16) |
| AQ19 | BJL's exit? | Into stock at 0; any station (AD17) |

### 10.2 Still open

None. Parked items are in §9.3.

---

## 11. Notes on the source data

- The simulation's cards are **not one continuous dataset**: dates jump
  (May → April → May → June), weights do not carry over between cards (Grading
  Halus 40.000 g in → 60.000 g out; Penyebaran 10.000 g in → 41.865 g out) and
  Packing is left empty. This file reads the **structure and arithmetic**,
  not the figures.
- The process doc places the first job number at **Timbang Penyebaran**; the
  simulation gives it at **Grading Halus output** and re-numbers at
  Penyebaran.
- Several cells in the process doc wait for data ("menunggu Nina", "menunggu
  Cadar").

---

## 12. Discussion log

| Date | What changed |
| --- | --- |
| 14/10/2026 | First exploration of both workbooks; this file created (§1–§11). |
| 14/10/2026 | Gaps and open questions discussed with the user: AD1–AD12 agreed, AP1–AP6 parked, AQ1–AQ14 answered, AQ15–AQ19 raised (§8.2, §8.3, §9, §10). |
| 14/10/2026 | AQ15–AQ19 answered: AD13–AD17 agreed; nothing left open (§9.1, §10). |
| 14/10/2026 | The seven differences from the production project settled (D1–D7, §8.3): Job No. = Partai with a Sub Job No. under it, push and value weight Walet-only, type vs QC status, Driver unchanged; AD18–AD22 added, AD1–AD4, AD13, AD16 amended; pass-through paragraph written for the Phase 5 review (§9.4). |
| 14/10/2026 | **`main` becomes Walet** (P161): the pre-Walet ERP kept on branch `before_costing_decision`. Naming in the ERP follows Walet — **Partai** (was Job No.), **Job** (Walet's Nomor Job, was *Sub Job No.*), **Lot**. The Stock Issue is the Logistik BSTB and the station receives it; an execution is input → output in one posting on a Partai the station picked from what it received. Carried to `production_project.md` §21g. |
| 14/10/2026 | Renamed to `walet/walet.md`; the company is called **Walet** throughout. The source workbooks stay on disk beside it and are no longer committed. |
| 15/10/2026 | Simulated one Partai from Grading Halus to FG (`simulation production.md`). Decided: a kick-off Perintah per Partai; standard per gram and value weight on the item (a temporary rate — the workbook types values without a formula); by-products get new lots; Barcoding is a transformation; pass-through weight free for now; workbook numbering for production identities (Partai `Pt_<DDMMYY>-<HHMMSS>_A_<unit>`, Perintah `PP_<DDMMYY>_<NNNNN>`); Moulding in two postings. Carried to `production_project.md` M121–M125. |
