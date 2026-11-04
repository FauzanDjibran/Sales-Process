# Production Process

> **The living reference for how production works in this ERP, step by step.**
> It is updated in the same commit as every production change, so it always
> describes what is on `main` (✅) and what is still planned (🔜). The plan and
> its decisions R1–R19 are in `Production-Plan.md`; each built step is a
> P2xx decision in `Claude-ERP.md` §12.
>
> Last updated: **05/11/2026 — P225** (step 1: the production masters).
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
| **Lot** | The only identity (R3). Lots stay unique per item (P120). Production holds goods per **lot · workstation**; quantity and value per bucket, Σ value = WIP. An execution's outputs are new lots, numbered `<execution number>-<n>` or typed (R17). | ✅ P203 |

---

## 3. Masters

| Master | What it holds | Where | Status |
| --- | --- | --- | --- |
| **Unit** | Code (in document numbers, locked), name, its Workstation, and the **kinds of work** it may do. Where goods are held in production; no unit is named in code. | Master › Produksi | ✅ P225 |
| **Workstation** | Label, name. Only groups Units. | Master › Produksi | ✅ P225 |
| **Line Produksi** | Label, name, the variance account. | Master › Produksi | ✅ P225 |
| **Routing** | A version of the ordered Units; no line = the segment before the partai. Each step: exit mode, No. Job policy, checkpoint, skippable. | Master › Produksi | ✅ P225 |
| **Standard Cost** | Versions of the rate per gram per Unit; empty = 0. | Master › Produksi | ✅ P225 |
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
| 4 | **Stock Issue** `SI/…` (Persediaan › Operasi Gudang) | Lots leave a warehouse straight into a workstation at moving average, the same lot number; picked by lot (and location) as a Delivery Note. No transit, no receipt. | Dr WIP / Cr Persediaan | ✅ P204 |
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
