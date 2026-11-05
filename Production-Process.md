# Production Process

> **The living reference for how production works in this ERP, step by step.**
> It is updated in the same commit as every production change, so it always
> describes what is on `main` (✅) and what is still planned (🔜). The plan and
> its decisions R1–R19 are in `Production-Plan.md`; each built step is a
> P2xx decision in `Claude-ERP.md` §12.
>
> Last updated: **05/11/2026 — P232** (the SOP rulings; `Produksi Walet (Real).md` is production's main document).
>
> **What follows describes what is on `main`.** The agreed target is in
> `Produksi Walet (Real).md`; its build steps add the documents back.

---

## 1. The picture in one paragraph

Logistik issues lots from a warehouse straight into a **workstation** (Stock
Issue). Non-material cost is booked during the month by **Tagihan Biaya** (or a
manual journal) on the expense accounts of the **Jenis Biaya**. **Nothing
transforms, moves or releases goods in production for now, and nothing costs a
period:** those documents were dropped by step D and are rebuilt by the Walet
plan's steps 1–13.

---

## 2. Identity

| Identity | What it is | Status |
| --- | --- | --- |
| **No. Stok** (*Lot* on screen until the wording step) | Unique in the whole system (W10). Production holds goods per **No. Stok · Unit · stage · Partai · Job**, the last two optional; quantity and value per bucket, Σ value = WIP. | ✅ P227 |
| **Stage** | Each Unit holds goods in **Persiapan** (received) and **Stand By** (worked). Only an execution advances them; a transfer sends only from Stand By (W29). | ✅ P227 (book only) |
| **Partai** | `P_<ddmmyy>_<NNNNN>`. One line, the routing it follows (of that line) and the id of the Standard Cost active that day. | ✅ P227 (book only) |
| **No. Job** | `<unit>_<ddmmyy>_<NNNNN>`. One pickup of one No. Stok when made (W31). | ✅ P227 (book only) |

---

## 3. Masters

| Master | What it holds | Where | Status |
| --- | --- | --- | --- |
| **Unit** | Code (in document numbers, locked), name, its Workstation, the **kinds of work** it may do, **Keluar Lewat** and **No. Job saat Keluar**. Where goods are held in production; no unit is named in code. | Master › Produksi | ✅ P230 |
| **Workstation** | Label, name. Only groups Units. | Master › Produksi | ✅ P225 |
| **Line Produksi** | Label, name, the variance account. | Master › Produksi | ✅ P225 |
| **Routing** | The ordered Units, each routing naming its line; several per line for now, and one without a line = the segment before the partai. Only the order, with a checkpoint and skippable mark per step. Steps lock once goods follow it. | Master › Produksi | ✅ P230 |
| **Standard Cost** | Versions of the rate per gram per Unit; empty = 0. **Never edited once saved; one active**: saving a new one closes the old. A partai keeps the id it started on. | Master › Produksi | ✅ P226 |
| **Karyawan** | Who worked a No. Job at a Pass Through Unit. | Master › Produksi | ✅ P225 |
| **BJL** | A flag on the Item; valued 0 in production; locked once used. | Master › Item | ✅ P225 |
| **Jenis Biaya** | Label, name and the **expense account** a Tagihan Biaya line debits (fixed once chosen). The close pools the net debit on these accounts. Starter rows by `db:seed-accounts`: upah langsung / tidak langsung, listrik, penyusutan, pemeliharaan, overhead lain. | Master › Referensi | ✅ P201 |
| **Account WIP** | A column on Account Kategori Item (Barang). **No fallback**: a production posting is refused naming the category without one (R16). `db:seed-accounts` points every Barang category at *Persediaan Barang Dalam Proses*. | Accounting › Pengaturan › Account Kategori Item | ✅ P201 |
| **Account Mapping › Produksi** | *Hutang Biaya Produksi* (credit of every Tagihan Biaya), *Beban Pemusnahan Produksi* (scrap), *Biaya Produksi Dibebankan* (credit of the month-end close). | Accounting › Pengaturan › Account Mapping | ✅ P201 |

---

## 4. Documents

| Step | Document | What it does | Journal | Status |
| --- | --- | --- | --- | --- |
| 2 | **Tagihan Biaya** `TBP/…` (Produksi › Biaya) | A production cost recognised in its month. Supplier required; each line a Jenis Biaya and an amount. Draft → Posting → Posted; Batalkan a Draft with a reason. | Dr each Jenis Biaya's expense account / Cr Hutang Biaya Produksi (copied onto the bill) | ✅ P202 |
| 2 | **Pembayaran Biaya Produksi** `BKK/…` (Finance › Kas & Bank › Pengeluaran) | Pays posted Tagihan Biaya of one supplier, in parts if wanted, never beyond the bill. No tax. The bill keeps what it was paid. | Dr Hutang Biaya Produksi / Cr Kas & Bank | ✅ P202 |
| 3 | **BSTB Issue** `BSTB_<unit>_<ddmmyy>_<NNNNN>` (Persediaan › Operasi Gudang) | Draft → **Ajukan** (goods locked at the warehouse, books untouched) → **Terima** (goods leave at moving average into the Unit's Persiapan, same lot number, dated Tanggal). *Bahan ke Produksi* goes to the first Unit of the routing; *Bahan Penolong ke Unit* to any Unit, as that Unit's balance, not a partai's contents. No QC. | Dr WIP / Cr Persediaan, at Terima | ✅ P228 |
| 8 | Reports (Produksi › Laporan): **Saldo Produksi** (per workstation and lot as of a date), **Kartu Lot** (a lot in production and in stock). | Read from the ledgers; a past date as it stood. | none | ✅ P209 |
| 11 | Report: **Telusur Produksi** (Produksi › Laporan) | From a lot number: backward through every execution (number, workstation, quantity, value) to the lots that came from a supplier or an injection; forward to every lot made from it and where each is now — at a workstation, in stock, or delivered to a customer. | none | ✅ P212 |

---

## 5. Change log

| Date | Decision | Change |
| --- | --- | --- |
| 30/10/2026 | P201 | Masters: Workstation, Jenis Biaya, Bobot Nilai, Account WIP, Account Mapping › Produksi, starter accounts. |
| 30/10/2026 | P202 | Tagihan Biaya and Pembayaran Biaya Produksi; menu Produksi. |
| 30/10/2026 | P203 | The production ledger: bucket per lot · workstation, genealogy, WIP = value held. |
| 30/10/2026 | P204 | Stock Issue, direct into the workstation. |
| 30/10/2026 | P205 | Eksekusi Produksi; the shared lifecycle of the production documents. |
| 30/10/2026 | P206–P207 | Production Transfer and Production Release. |
| 01/11/2026 | P208 | Plan extended: Perintah Produksi, BoM, Routing, period frame, Costing Sementara, Telusur, Rencana vs Aktual. |
| 01/11/2026 | P209 | Reports Saldo Produksi, Kartu Lot, Rekap Produksi. |
| 01/11/2026 | P210 | Penutupan Biaya Produksi and its period lock. |
| 01/11/2026 | P211 | Costing Sementara. |
| 01/11/2026 | P212 | Telusur Produksi. |
| 04/11/2026 | P216 | Production replanned in `Produksi Walet (Real).md`; no change to what is built. |
| 04/11/2026 | P217 | Drop list and step D agreed in `Produksi Walet (Real).md` §12–13; no change to what is built. |
| 04/11/2026 | P218 | Step D: Eksekusi, Production Transfer, Production Release, the close, Bobot Nilai, Rekap Produksi and Costing Sementara dropped. |
| 05/11/2026 | P225 | Step 1: Unit and Workstation as masters, Line, Routing, Standard Cost, Karyawan, BJL, one No. Stok system-wide. |
| 05/11/2026 | P226 | One routing per line; Standard Cost never edited, one active, the old closed by the new. |
| 05/11/2026 | P227 | Step 2: bucket No. Stok · Unit · stage · Partai · Job, Partai, No. Job, what a No. Stok locked, standard cost entries; several routings per line again. No document uses them yet. |
| 05/11/2026 | P228 | Step 3: BSTB Issue, Ajukan and Terima, stock reserved from Ajukan, Bahan Penolong ke Unit. |
| 05/11/2026 | P229 | The Reguler Workstations, Units and routings as a seed; clearer routing refusals. |
| 05/11/2026 | P230 | A routing is only the order of Units; Keluar Lewat and No. Job saat Keluar move to the Unit. |
| 05/11/2026 | P231 | The plan compared with the 45 field SOPs in `walet sop.md`; W41–W56 agreed, no change to what is built. |
| 05/11/2026 | P232 | W57–W63 agreed: Dokumen Push, the list of moves, a new No. Stok per grading, a pack as a kotak's contents; no change to what is built. |
