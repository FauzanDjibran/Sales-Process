# Production Process

> **The living reference for how production works in this ERP, step by step.**
> It is updated in the same commit as every production change, so it always
> describes what is on `main` (✅) and what is still planned (🔜). The plan and
> its decisions R1–R19 are in `Production-Plan.md`; each built step is a
> P2xx decision in `Claude-ERP.md` §12.
>
> Last updated: **30/10/2026 — P201–P207** (masters; Tagihan Biaya; production ledger; Stock Issue; Eksekusi; Transfer; Release).

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
| 8 | Reports: Saldo Produksi, Kartu Lot, Rekap Produksi | | | 🔜 |
| 9 | **Penutupan Biaya Produksi** | Month pool by Driver, followed forward; period locked. | Dr WIP / Persediaan / HPP / Beban Pemusnahan — Cr Biaya Produksi Dibebankan | 🔜 |

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
