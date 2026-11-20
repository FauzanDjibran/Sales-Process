# Cash Bank Transfer — Plan dan Analisa Kesesuaian

> Status: **disetujui user 20/11/2026** (OD-0 ya, OD-1 nominal valas + kurs,
> OD-2 banyak tujuan, OD-3 menyusul, OD-4 satu seri, OD-5 *Transfer*); dibangun
> sebagai P299.
> Permintaan user: ambil menu *Cash Bank Transfer* dari SIBA, terapkan di ERP
> **menggantikan Penukaran Valas** (P272, MC11a). **Layer kurs SIBA tidak
> dipakai**; penilaian tetap konsep multi-currency ERP (rata-rata bergerak,
> P37, MC11). Yang diambil dari SIBA hanya menunya: satu dokumen untuk semua
> perpindahan dana antar Kas & Bank sendiri, dengan tiga Purpose.
>
> Sumber: SIBA `d39dedc` — `transfer-catalogue.ts`, `transfer-valuation.ts`,
> `transfer.ts`, `transfer-workflow.ts`, `transfer-check.ts`,
> `transfer-form.tsx`, `transfer-lines-card.tsx`, model
> `FinCashBankTransfer(_Line)`. ERP — `cash-exchange.ts`,
> `cash-exchange-workflow.ts`, `fin_cash_exchange`, `cash-bank.ts`
> (`recordCashBankEntry`), `knowledge/multi_currency_concept.md` §5.8.

---

## 1. Ringkasan

ERP sudah punya separuh menu SIBA: Penukaran Valas adalah Pencairan dan
Pembelian Valas SIBA, satu tujuan, tanpa layer. Yang belum ada adalah
**Transfer satu currency** (C14) dan **banyak tujuan per dokumen**. Rencananya:
`fin_cash_exchange` **diganti nama di tempat** menjadi `fin_cash_bank_transfer`
dengan tabel baris tujuan, Purpose `Transfer · Pencairan · PembelianValas`,
menu Finance › Kas & Bank › **Transfer** menggantikan *Penukaran Valas*.
Posting tetap jalur Penukaran Valas yang sekarang (Cash Bank Book Out pada
rata-rata, In pada base tepat, satu journal, selisih kurs hanya di Pencairan),
diperluas per baris. Dokumen PVL yang sudah ada tetap dengan nomornya.

## 2. SIBA: apa yang dilakukan Cash Bank Transfer

| Aspek | SIBA |
| --- | --- |
| Dokumen | `fin_cash_bank_transfer` + `_line`, Finance › Eksekusi › Cash Bank Transfer, `CASH_BANK_TRANSFER_VIEW / CREATE / EDIT / POST / CANCEL` |
| Purpose | **Transfer** (currency sama), **Pencairan** (valas keluar, IDR masuk), **Pembelian Valas** (IDR keluar, valas masuk). Dipilih user sebagai pernyataan niat, lalu pasangan Kas & Bank **dicek terhadapnya** (`transferSourceRefusal`, `transferDestinationRefusal`) — salah pilih rekening menjadi penolakan, bukan penjualan valas diam-diam. Valas ke valas lain ditolak (lewat IDR) |
| Bentuk | Satu sumber, **banyak tujuan** (baris), tiap tujuan sekali, tidak pernah sumbernya sendiri |
| Currency dokumen | Sisi valas pasangan; ikut sumber untuk Transfer dan Pencairan, dipilih (*Valuta Dibeli*) untuk Pembelian Valas |
| Kurs | Diketik **per baris** hanya saat lintas currency (`amount` valas × `exchange_rate` = rupiah); Transfer tidak mengetik kurs |
| Layer | Sumber valas memilih **satu layer** (`cash_bank_layer_id`); tiap baris menarik dari layer itu, tujuan valas membuka layer baru mewarisi kurs layer sumber |
| Nilai per baris | `out_amount / out_base`, `in_amount / in_base`, `fx_difference = in_base − out_base` — hanya bukan nol pada Pencairan |
| Journal | Cr sumber (base yang dilepas) / Dr tiap tujuan (base diterima), selisih kurs sebagai baris penyeimbang |
| Lifecycle | Draft → Post → Posted (final); Batalkan dari Draft; koreksi = transfer baru arah sebaliknya |
| Tanggal | `accounting_date` kosong sampai Post |
| Biaya bank | Tidak ada |
| Pembeda Company, Budget, subject book | Tidak ada (transfer tanpa Partner) |

## 3. ERP sekarang: Penukaran Valas (P272)

`fin_cash_exchange`, `PVL/…`, satu Kas & Bank IDR dan satu valas; jenis
diturunkan dari sisi rupiah (*Pembelian* bila IDR keluar, *Pencairan* bila IDR
masuk); **kedua nominal diketik** dari rekening koran, kurs = hasil bagi,
ditampilkan, tidak disimpan (MC11a). Posting: Out sumber (valas dilepas pada
rata-rata, P37), In tujuan dengan **base tepat** (`recordCashBankEntry`
menerima `base`), satu journal, selisih kurs = base diterima − base dilepas
(hanya Pencairan), dry run (P103), overdraw ditolak per hari (P221), periode
ditahan (P222). Currency sama ditolak (*itu Transfer, C14*). Tanpa biaya bank.

## 4. Analisa kesesuaian

### 4.1 Terhadap konsep multi-currency (`knowledge/multi_currency_concept.md`)

| Aturan konsep | Transfer SIBA | Rencana ERP |
| --- | --- | --- |
| §5.8 transfer **mengonservasi base**; out-leg pada carrying rate sumber | Ya, lewat layer | Ya, lewat rata-rata: Out melepas round(V × q ÷ Q), habis = V tepat |
| §5.8 in-leg menerima base itu; **kurs efektif diturunkan, tidak diketik** | Kurs tujuan mewarisi layer | Ya: In dengan `base` = base dilepas; kurs tujuan tidak pernah diketik |
| §5.3 pembelian = origination: rupiah dibayar **adalah** base valas | Ya | Ya (sudah di PVL) |
| §5.4 penjualan: dua base independen, selisihnya selisih kurs | Ya, hanya Pencairan | Ya (sudah di PVL) |
| §4.2 carrying rate diturunkan, tidak disimpan | Layer menyimpan kurs | Ya: tanpa layer, tanpa kolom kurs tersimpan |
| Inv. 18 transfer tidak menciptakan nilai | Ya | Ya: Transfer dan Pembelian Valas `fx_difference = 0` dibuktikan reconcile |

**Tidak ada deviasi dari konsep KB.** Yang dibuang (layer) memang sudah
dibuang ERP lewat P37; konsep tidak mewajibkan layer.

### 4.2 Terhadap keputusan ERP

| Keputusan | Dampak | Status |
| --- | --- | --- |
| **P19 / C14** — Cash Bank Transfer *on hold* | Dicabut untuk Transfer; Debit / Credit Note sudah jalan sendiri (P292) | Perlu keputusan user (permintaan ini) |
| **P272 / MC11a** — Penukaran Valas dokumen tersendiri | **Digantikan**: menjadi Purpose Pencairan dan Pembelian Valas di Transfer. Aturan nilainya tetap | Perlu keputusan user (permintaan ini) |
| **MC11a** — kedua nominal diketik, kurs tidak disimpan | SIBA mengetik **kurs** per baris. Usul: **pertahankan cara ERP** (TB4) — lebih dekat ke rekening koran dan ke §5.8 | Pilihan, lihat OD-1 |
| **P37** — rata-rata, tanpa layer | Kolom dan pemilih layer SIBA tidak diambil | Sesuai |
| **MC11 / MC14** — tagihan hanya dari Kas & Bank currency sama | Tidak tersentuh; transfer tanpa tagihan | Sesuai |
| **P106** — satu seri nomor per dokumen | Satu seri `TRF/…` untuk tiga Purpose; PVL lama tetap | Sesuai |
| **P15** — `PREFIX/YYYY/MM/NNNN`, tanggal di Draft | SIBA mengisi tanggal saat Post; ERP mengisi di Draft seperti dokumen lain | Ambil cara ERP |
| **P221 / P222** — saldo tidak minus per hari, periode ditahan | Sudah di jalur PVL; tetap | Sesuai |
| **P103** — konfirmasi Post = dry run | Sudah di PVL; tetap | Sesuai |
| **P17** — Penerimaan / Pengeluaran | Kolom laporan Kas & Bank tetap; dokumen menulis entri Out dan In | Sesuai |
| `knowledge/design-convention.md` | Form header + kartu baris + Riwayat (P38); SIBA memakai bentuk yang sama | Sesuai |

### 4.3 Diambil, diubah, dibuang

| Dari SIBA | Keputusan |
| --- | --- |
| Menu, nama, tiga Purpose dan teksnya | **Ambil** |
| Purpose sebagai pernyataan niat, pasangan dicek terhadapnya, pesan menyebut currency kedua sisi | **Ambil** (`transfer-catalogue.ts` hampir apa adanya, client-safe) |
| Satu sumber, banyak tujuan | **Ambil** (OD-2) |
| Lifecycle Draft → Posted / Dibatalkan, tanpa reversal | **Ambil** (sama dengan PVL) |
| Kurs diketik per baris | **Ubah**: ketik dua nominal per baris, kurs ditampilkan (OD-1) |
| `cash_bank_layer_id`, *Kurs Sumber*, `drawFromLayer`, layer tujuan | **Buang** (P37) |
| `transfer-valuation.ts` cabang `drawsLayer` | **Buang**; base keluar dari `recordCashBankEntry` |
| `accounting_date` kosong sampai Post | **Buang**; tanggal di Draft (konvensi ERP) |
| `company_id` | **Buang** (P9) |
| Pencairan Open Item (`fin_item_conversion`) | **Tidak diambil** — butuh subject book (P25); di luar permintaan |

## 5. Aturan (TB1–TB10)

- **TB1. Satu dokumen untuk setiap perpindahan dana antar Kas & Bank sendiri**,
  Finance › Kas & Bank › **Transfer** (`/finance/cash-bank/transfer`),
  menggantikan *Penukaran Valas*. Tanpa Partner, tanpa tagihan, tanpa pajak.
- **TB2. Purpose dipilih user**: *Transfer* (currency sama), *Pencairan Valas*
  (valas → IDR), *Pembelian Valas* (IDR → valas); disimpan (`purpose`) dan
  pasangan dicek terhadapnya di form dan server. Valas ke valas lain ditolak.
  Purpose terkunci setelah dokumen punya baris.
- **TB3. Satu sumber, satu atau lebih tujuan**; tiap tujuan sekali, bukan
  sumbernya; pada Pencairan semua tujuan IDR, pada Pembelian semua tujuan satu
  currency valas yang sama, pada Transfer semua tujuan currency sumber.
- **TB4. Nominal per baris** (OD-1, cara SIBA): yang diketik adalah **nominal
  dalam currency dokumen** — currency bersama pada *Transfer*, **valasnya** pada
  *Pencairan* dan *Pembelian*. Lintas currency juga mengetik **kurs** per baris
  (`exchange_rate`, disimpan), dan sisi rupiah = round(valas × kurs) — satu
  perkalian, tanpa pembagian. Menggantikan MC11a (dua nominal, kurs hasil bagi).
- **TB5. Posting satu transaksi** (`holdPostingPeriod` dulu), **per baris**:
  satu entri Out dari sumber sebesar Jumlah Keluar baris itu — rupiah apa
  adanya, valas pada rata-rata (P37), seperti SIBA menarik per baris — sehingga
  tidak ada pembagian base antar baris; lalu entri In tujuannya:
  - Transfer: In dengan `base` = base yang dilepas baris itu (konservasi, §5.8);
  - Pembelian Valas: In valas dengan `base` = rupiah yang keluar untuk baris itu
    (origination, §5.3);
  - Pencairan: In rupiah = round(valas × kurs); `fx_difference` = rupiah masuk −
    base yang dilepas baris itu (§5.4).
- **TB6. Journal**: Cr akun Kas & Bank sumber (base dilepas) / Dr akun tiap
  tujuan (base diterima); Σ selisih kurs satu baris di *Account Selisih Kurs*
  (laba di kredit, rugi di debit). Transfer dan Pembelian tidak pernah punya
  baris selisih. Transfer IDR → IDR: journal biasa tanpa kurs.
- **TB7. Lifecycle** Draft → *Posting* → Posted (final); *Batalkan* Draft dengan
  alasan. Koreksi = transfer baru arah sebaliknya.
- **TB8. Nomor `TRF/YYYY/MM/NNNN`** satu seri untuk tiga Purpose; dokumen `PVL/…`
  yang sudah ada **tetap nomornya** (teks yang sudah tertulis tidak diubah,
  seperti P78).
- **TB9. Overdraw** ditolak per hari (P221) pada entri Out sumber; tanggal
  sebelum Saldo Awal sumber ditolak.
- **TB10. Tanpa biaya bank** pada fase ini (OD-3, menyusul).
- **TB11. Currency dokumen** mengikuti sumber pada Transfer dan Pencairan, dan
  tujuan pada Pembelian Valas (semua tujuan satu valas yang sama); tidak dipilih
  terpisah.

## 6. Model data

Migrasi `cash_bank_transfer` **mengganti nama di tempat** (seperti P107), tanpa
memindah id, journal, Cash Bank Book, atau audit trail:

```
fin_cash_exchange          → fin_cash_bank_transfer
  exchange_no              → transfer_no
  exchange_date            → transfer_date
  status (CashExchangeStatus → CashBankTransferStatus, nilai sama)
  + purpose CashBankTransferPurpose  (diisi dari pasangan: IDR keluar = PembelianValas, IDR masuk = Pencairan)
  from_cash_bank_id, reference, note, journal_id, cancel_reason   tetap
  from_amount              → total keluar (Σ baris)
  from_base, fx_difference → tetap, = Σ baris
  + currency_id, transfer_amount (Σ nominal baris, currency dokumen)
  to_cash_bank_id, to_amount, to_base  → pindah ke baris 1, lalu di-drop
  (kurs baris 1 = round(IDR ÷ valas, 6) dari angka lama; angka tersimpan tidak berubah)

fin_cash_bank_transfer_line (baru)
  id, transfer_id, line_no (unik per dokumen), to_cash_bank_id (unik per dokumen)
  amount Decimal(18,2)        — currency dokumen (diketik)
  exchange_rate Decimal(18,6) — 1 pada Transfer, diketik lintas currency
  out_amount Decimal(18,2)   — currency sumber
  in_amount  Decimal(18,2)   — currency tujuan (= out_amount pada Transfer)
  out_base, in_base Decimal(18,2)?  — ditulis saat Posting
  fx_difference Decimal(18,2) default 0
  CHECK out_amount > 0, in_amount > 0
```

Ikut diganti di tempat: tipe dokumen *Penukaran Valas* → *Transfer Kas & Bank*
(tabel `fin_cash_bank_transfer`, posisi di daftar seed sama), izin
`CASH_EXCHANGE_*` → `CASH_TRANSFER_*` (grant role tetap), nama tabel di
`audit_log`. Route lama `/finance/cash-bank/exchange` di-redirect. `DBML/erp.dbml.md`
diperbarui di commit yang sama.

## 7. Langkah bangun

| # | Langkah | Selesai bila |
| --- | --- | --- |
| 1 | Migrasi §6, `cash-bank-transfer.ts` dan `-workflow.ts` dari `cash-exchange*.ts` + katalog Purpose dari SIBA (tanpa layer), action, izin, nav, tipe dokumen, document-links | Posting tiga Purpose lewat test; PVL lama terbaca sebagai Transfer satu baris |
| 2 | Layar: register (kolom Purpose, Sumber, Tujuan — *n tujuan* bila banyak — Total), form header (Purpose, Sumber, Tanggal, Referensi, Catatan) + kartu Tujuan (Tujuan · Jumlah Keluar · Jumlah Masuk · Kurs) + kotak total + *Dampak Transaksi* sumber (P243), `DocumentHeader` / `Amount` | Dicek di browser, `ui-audit` terhadap Pengeluaran |
| 3 | `db:reconcile`: cek 79 per baris (dua buku bergerak sebesar base baris; selisih = in − out; Transfer dan Pembelian selisih 0; header = Σ baris); `tests/cash-bank-transfer.test.ts` menggantikan `cash-exchange.test.ts`: IDR→IDR, USD→USD (base konservasi, rata-rata tujuan berubah benar), Pembelian, Pencairan ke dua bank IDR, overdraw, Purpose salah pasangan | `npm run build`, `lint`, `test`, reconcile hijau; `db:neon-migrate` |
| 4 | Dokumen: Claude-ERP.md (P-baru, §1.5, §3.2, C14 ditutup separuh, P272 diubah), `Multi-Currency-Plan.md` MC11a dan OD-10 ditandai digantikan, `git_command.md` bila perlu | Satu commit per langkah ke `main` (P33) |

## 8. Keputusan (dijawab user 20/11/2026)

| # | Pertanyaan | Rekomendasi |
| --- | --- | --- |
| OD-0 | Cabut C14 (Transfer) dan ganti P272 Penukaran Valas dengan menu ini? | **Ya** |
| OD-1 | Lintas currency: ketik **dua nominal** (ERP, MC11a) atau **nominal valas + kurs** (SIBA)? | Diusulkan dua nominal; **diputuskan: nominal valas + kurs, tanpa pembagian** (TB4) |
| OD-2 | Banyak tujuan per dokumen (SIBA) atau tetap satu tujuan? | **Ya**, entri Out per baris (TB5) |
| OD-3 | Biaya transfer bank (BI-FAST, RTGS) di dokumen ini? | **Menyusul** |
| OD-4 | Nomor: satu seri `TRF/…` atau `PVL/…` tetap untuk valas dan `TRF/…` untuk Transfer? | **Satu seri `TRF/…`**; PVL lama tetap |
| OD-5 | Nama menu: *Transfer* atau *Cash Bank Transfer* (nama SIBA)? | **Transfer** |

## 9. Risiko dan batas

- **Migrasi rename**: data PVL di lokal dan Neon dipindah ke baris 1; reconcile
  membuktikan base buku sama sebelum dan sesudah. Teks journal lama tetap
  menyebut "Penukaran Valas".
- **Entri Out per baris** (TB5): Buku Kas & Bank sumber menampilkan satu baris
  per tujuan, bukan satu per dokumen.
- Sisi rupiah = round(valas × kurs) bisa berbeda dari angka bank bila bank
  membulatkan lain; kurs diketik sampai 6 desimal untuk mengejarnya.
- Transfer valas → valas **lain** (USD → SGD) tetap ditolak; dilakukan sebagai
  Pencairan lalu Pembelian, seperti SIBA.
- Transfer antar Kas & Bank **dalam perjalanan** (uang keluar hari ini, masuk
  besok) tidak dimodelkan: satu tanggal untuk kedua sisi, seperti SIBA.
