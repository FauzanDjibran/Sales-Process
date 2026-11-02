# Production Process

> **The living reference for how production works in this ERP, step by step.**
> It is updated in the same commit as every production change, so it always
> describes what is on `main` (✅) and what is still planned (🔜). The plan and
> its decisions R1–R19 are in `Production-Plan.md`; each built step is a
> P2xx decision in `Claude-ERP.md` §12.
>
> Last updated: **01/11/2026 — P210** (Penutupan Biaya Produksi).

---

## 1. The picture in one paragraph

Logistik issues lots from a warehouse straight into a **workstation** (Stock
Issue). There an **Eksekusi Produksi** consumes any lots the station holds and
makes **new lots**, whose value is the inputs' value shared by quantity ×
**Bobot Nilai**. Goods move between stations with a **Production Transfer**
and leave production with a **Production Release** — into a warehouse at the
same lot, or written off (Pemusnahan). Every move is direct: no transit, no
receipt. Non-material cost is booked during the month by **Tagihan Biaya** (or
a manual journal) on the expense accounts of the **Jenis Biaya**, and absorbed
at **month end** by a close that shares the month's pool over the executions
by their **Driver** and follows it forward to WIP, Persediaan, HPP or scrap.

---

## 2. Identity

| Identity | What it is | Status |
| --- | --- | --- |
| **Lot** | The only identity (R3). Lots stay unique per item (P120). Production holds goods per **lot · workstation**; quantity and value per bucket, Σ value = WIP. An execution's outputs are new lots, numbered `<execution number>-<n>` or typed (R17). | ✅ P203 |

---

## 3. Masters

| Master | What it holds | Where | Status |
| --- | --- | --- | --- |
| **Workstation** | Label, name. Where production happens. | Master › Entitas | ✅ P201 |
| **Jenis Biaya** | Label, name and the **expense account** a Tagihan Biaya line debits (fixed once chosen). The close pools the net debit on these accounts. Starter rows by `db:seed-accounts`: upah langsung / tidak langsung, listrik, penyusutan, pemeliharaan, overhead lain. | Master › Referensi | ✅ P201 |
| **Bobot Nilai** | On the Item (Barang): the relative value per base unit by which an execution shares its value over its outputs. Empty or 0 = an output without value. | Master › Item | ✅ P201 |
| **Account WIP** | A column on Account Kategori Item (Barang). **No fallback**: a production posting is refused naming the category without one (R16). `db:seed-accounts` points every Barang category at *Persediaan Barang Dalam Proses*. | Accounting › Pengaturan › Account Kategori Item | ✅ P201 |
| **Account Mapping › Produksi** | *Hutang Biaya Produksi* (credit of every Tagihan Biaya), *Beban Pemusnahan Produksi* (scrap), *Biaya Produksi Dibebankan* (credit of the month-end close). | Accounting › Pengaturan › Account Mapping | ✅ P201 |

---

## 4. Documents

| Step | Document | What it does | Journal | Status |
| --- | --- | --- | --- | --- |
| 2 | **Tagihan Biaya** `TBP/…` (Produksi › Biaya) | A production cost recognised in its month. Supplier required; each line a Jenis Biaya and an amount. Draft → Posting → Posted; Batalkan a Draft with a reason. | Dr each Jenis Biaya's expense account / Cr Hutang Biaya Produksi (copied onto the bill) | ✅ P202 |
| 2 | **Pembayaran Biaya Produksi** `BKK/…` (Finance › Kas & Bank › Pengeluaran) | Pays posted Tagihan Biaya of one supplier, in parts if wanted, never beyond the bill. No tax. The bill keeps what it was paid. | Dr Hutang Biaya Produksi / Cr Kas & Bank | ✅ P202 |
| 4 | **Stock Issue** `SI/…` (Persediaan › Operasi Gudang) | Lots leave a warehouse straight into a workstation at moving average, the same lot number; picked by lot (and location) as a Delivery Note. No transit, no receipt. | Dr WIP / Cr Persediaan | ✅ P204 |
| 5 | **Eksekusi Produksi** `EKS/…` (Produksi › Operasi Produksi) | Inputs: any lots held at the station, any quantity. Outputs: new lots — typed number or `<EKS no>-<n>` — valued by Σ input × (qty × Bobot Nilai) share; all outputs weighing 0 is refused. Driver > 0 for the close. | Dr WIP (output) / Cr WIP (input), only where the accounts differ | ✅ P205 |
| 6 | **Production Transfer** `PT/…` (Produksi › Operasi Produksi) | Any quantity of a lot moves directly to another station, out at round(V × q ÷ Q) and in at the same value. | none | ✅ P206 |
| 7 | **Production Release** (Produksi › Operasi Produksi) | *Penerimaan Hasil Produksi* `PHP/…`: into a warehouse (and location) under the same lot at the value released. *Pemusnahan Produksi* `PMS/…`: written off with a reason. | Dr Persediaan / Cr WIP · Dr Beban Pemusnahan Produksi / Cr WIP | ✅ P207 |
| 8 | Reports (Produksi › Laporan): **Saldo Produksi** (per workstation and lot as of a date), **Kartu Lot** (a lot in production and in stock), **Rekap Produksi** (per workstation: in, out, loss, Driver, value per unit) | Read from the ledgers; a past date as it stood. | none | ✅ P209 |
| 9 | **Penutupan Biaya Produksi** (Produksi › Biaya) | One period at a time, oldest first, after its last day, with a checklist (no Drafts, earlier periods costed, accounts set). The month's pool — net debit on the Jenis Biaya accounts — is shared over its executions by Driver, then by qty × Bobot Nilai to their outputs, and followed forward by quantity: still at a workstation → WIP; in stock → sold part to HPP, kept part raises the item's pool; scrapped → Beban Pemusnahan; no execution → HPP. Stores what it closed; irreversible; locks the period for stock, production and the cost accounts; the year does not close before its periods are costed. | Dr WIP / Persediaan / HPP / Beban Pemusnahan — Cr Biaya Produksi Dibebankan | ✅ P210 |
| 10 | Report: **Costing Sementara** | The close run as a dry run for the open period as of a date, per FG item (R26). | none | 🔜 |
| 11 | Report: **Telusur Produksi** | Lot backward to supplier, forward to customer (R27). | | 🔜 |
| 12 | **BoM** and **Routing** (Produksi › Master Data) | BoM per Item Target per workstation; Routing per Item Target; several each, one default (R21). | | 🔜 |
| 13 | **Perintah Produksi** `PP/…` | Item Target, Qty Target, optional Sales Order line; route and BoMs copied at Rilis and frozen; Tutup by hand. Every Eksekusi names one; deviations warned, never refused (R20–R24). | none | 🔜 |
| 14 | Report: **Rencana vs Aktual** | Per Perintah: required vs consumed, target vs output, deviations (R27). | | 🔜 |

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
