# Keluar Masuk Barang 02 — Sudut pandang transfer: logistik ⇄ produksi

Satu transfer = **dua langkah oleh dua orang**: yang menyerahkan menekan **Kirim**,
yang menerima menekan **Terima**. Tiap langkah satu transaksi database.

Cerita dan saldo awal: bagian 00 §3.

## Kode acuan

| Arah | Kirim | Terima | Balasan ke pengirim |
| --- | --- | --- | --- |
| Logistik → Produksi | `stock-issue.ts` `transitionStockIssue` → `production-receipt.ts` `takeIssueSent` | `receiveProductionReceipt` | `takeIssueReceived` |
| Produksi → Logistik | `production-issue.ts` `sendProductionIssue` → `stock-receipt.ts` `takeReceiptSent` | `receiveStockReceipt` | `takeReceiptReceived` |

---

# Bagian I — Logistik ke Produksi

## 1. Langkah di layar

| # | Siapa | Menu | Langkah |
| --: | --- | --- | --- |
| 1 | Gudang | ERP › Persediaan › Operasi Gudang › **Stock Issue** | tujuan *BSTB Issue*, gudang, Unit, tanggal, barang, pilih lot → Simpan Draft |
| 2 | Gudang | halaman yang sama | **Kirim** (konfirmasi menampilkan jurnal) |
| 3 | Unit | Produksi › Dokumen › **Production Receipt**, atau Workspace › tab Penerimaan | **Terima** |

| Tujuan | Unit yang boleh |
| --- | --- |
| Bahan ke Produksi (`production_issue`) | hanya Unit **pertama** routing |
| Bahan Penolong (`auxiliary_issue`) | Unit aktif mana pun |

## 2. Simulasi

### A. Draft (27/11)

600 g STK-0001 + 100 g STK-0002 ke UGH. **Tidak ada yang bergerak**, dan tidak ada
reservasi: dokumen lain masih bisa mengambil lot yang sama. Yang lebih dulu keluar
menang; yang kedua ditolak saat Kirim.

### A. Kirim (27/11)

Pool melepas nilai **per pick, berurutan**: `round(V × q ÷ Q)`.

| Pick | Hitungan | Nilai | Pool sesudahnya (Q / V) |
| --- | --- | ---: | --- |
| STK-0001, 600 g | round(18.000.100 × 600 ÷ 1.500) | **7.200.040** | 900 / 10.800.060 |
| STK-0002, 100 g | round(10.800.060 × 100 ÷ 900) | **1.200.007** | 800 / 9.600.053 |
| **Total** | | **8.400.047** | |

Yang ditulis, semuanya sekaligus:

| Di mana | Isi |
| --- | --- |
| `log_stock_balance` | STK-0001 1.000 → 400; STK-0002 500 → 400 |
| `log_stock_ledger` + `…valuation_ledger` | 2 baris keluar dan 2 kembaran nilainya |
| `log_stock_issue_tracking` | `base_cost_amount` 7.200.040 dan 1.200.007 |
| `log_stock_issue_line`, header | 8.400.047; status `InTransit` |
| `prd_receipt` + 2 baris | nomor sama, `InTransit`, nilai beku sama; **belum ada Job** |
| Buku produksi | **belum ada apa-apa** |

| Jurnal, tanggal 27/11 | Debit | Kredit |
| --- | ---: | ---: |
| WIP (Kategori Item SM-A) | 8.400.047 | |
| Persediaan | | 8.400.047 |

Bila salah satu gagal (stok kurang, akun WIP kosong, periode terkunci, Unit tidak
dikenal), **semuanya batal**.

### B. Ada pembelian sebelum Terima

200 g, Rp 3.000.000. Pool menjadi **1.000 g / 12.600.053**; rata-rata naik menjadi
12.600,053. Kiriman yang sedang di jalan **tidak terpengaruh**: nilainya sudah beku.

### C. Terima oleh UGH (28/11)

| Baris | No. Job lahir | Masuk `prd_balance` | Nilai |
| --- | --- | --- | ---: |
| STK-0001 | `UGH_281126_00001` | UGH · Persiapan proses pertama · 600 g | 7.200.040 |
| STK-0002 | `UGH_281126_00002` | UGH · Persiapan proses pertama · 100 g | 1.200.007 |

- Bahan: **satu No. Job per lot**. Bahan penolong: tanpa Job, `auxiliary = true`.
- `prd_ledger`: 2 baris `Issued`, bertanggal **28/11** (hari Terima).
- **Tidak ada jurnal.** Nilainya sudah WIP sejak Kirim.
- Balasan `IssueReceived`: Stock Issue menjadi **Diterima**, `received_at` 28/11.
  Tidak ada angka di sisi ERP yang berubah.
- Terima selalu **utuh**: tidak ada terima sebagian dan tidak ada catatan selisih (W57).

## 3. WIP selama di jalan

| Saat | Akun WIP | Buku produksi | Dalam perjalanan |
| --- | ---: | ---: | ---: |
| sebelum Kirim | 0 | 0 | 0 |
| sesudah Kirim | 8.400.047 | 0 | 8.400.047 |
| sesudah Terima | 8.400.047 | 8.400.047 | 0 |

> **Akun WIP = nilai di buku produksi + Stock Issue yang masih di jalan.**

`db:reconcile` memeriksa persamaan ini.

---

# Bagian II — Produksi ke Logistik

## 4. Dua jalan pulang

| | BSTB ke Finish Goods | BSTB Pengeluaran |
| --- | --- | --- |
| `purpose` | `finish_goods` | `return` |
| Dari Unit | hanya Unit terakhir routing | mana pun |
| Dari tahap | Stand By | Persiapan atau Stand By |
| Jumlah | utuh | Job utuh; tanpa Job boleh sebagian |
| Bahan penolong | tidak | boleh |
| Nilai di gudang | terbawa | dipilih gudang: terbawa / tanpa nilai |

## 5. Langkah di layar

| # | Siapa | Menu | Langkah |
| --: | --- | --- | --- |
| 1 | Unit | Workspace › Stand By › **Kirim ke Finish Goods**, atau Persiapan / Stand By › **BSTB Pengeluaran** | barang, gudang tujuan, tanggal → **Kirim** |
| 2 | Gudang | ERP › Persediaan › Operasi Gudang › **Stock Receipt** | lokasi (bila ada) dan status per baris → **Terima**; Pengeluaran: pilih nilai |

## 6. Simulasi: pengembalian bahan

### D. Kirim dari UGH (28/11)

STK-0002, Job `UGH_281126_00002`, 100 g, masih di Persiapan. Job harus keluar utuh.

| `prd_balance` | Sebelum | Sesudah |
| --- | --- | --- |
| UGH · Persiapan · STK-0002 | 100 g / 1.200.007 | 0 / 0 |
| UGH · Dalam Perjalanan · STK-0002 · `BPG_UGH_281126_00001` | tidak ada | 100 g / **1.200.007** |

- Nomor `BPG_UGH_281126_00001`; `prd_issue` `InTransit`.
- Stock Receipt lahir dengan nomor sama: 1 baris barang, 1 baris No. Stok, nilai 1.200.007.
- **Stok gudang belum berubah dan tidak ada jurnal.** Barang masih WIP.

Beda dengan arah pergi: di sini nilai **tidak dihitung dari rata-rata mana pun**.
Ia adalah nilai yang ada di bucket (bila hanya sebagian: `round(nilai × q ÷ qty)`,
habis → seluruhnya).

### E. Terima oleh gudang (28/11)

**Pilihan 1: Nilai terbawa** (dipakai cerita ini)

| Di mana | Isi |
| --- | --- |
| `log_stock_balance` | GBB · STK-0002: 400 → **500** (No. Stok yang sama) |
| Pool | 1.000 / 12.600.053 → **1.100 / 13.800.060** |
| `prd_balance` Dalam Perjalanan | 100 / 1.200.007 → 0 / 0 (`Released`) |
| Kedua dokumen | `Received` |

| Jurnal, tanggal Terima | Debit | Kredit |
| --- | ---: | ---: |
| Persediaan | 1.200.007 | |
| WIP | | 1.200.007 |

Rata-rata pool: 12.600,053 → **12.545,51**. Barang pulang membawa nilai lamanya
(12.000,07 per gram), bukan rata-rata hari ini.

**Pilihan 2: Tanpa nilai** (pembanding)

| Di mana | Isi |
| --- | --- |
| Pool | 1.100 g / 12.600.053 (qty naik, nilai tetap) |
| Rata-rata | turun menjadi 11.454,59 |
| `value_mode` / `base_written_off_amount` | `none` / 1.200.007 |

| Jurnal | Debit | Kredit |
| --- | ---: | ---: |
| Beban Pemusnahan Produksi | 1.200.007 | |
| WIP | | 1.200.007 |

Di kedua pilihan WIP berkurang sama besar. Yang beda hanya tujuan nilainya.

### Penutup cerita (pilihan 1)

| WIP | Nilai |
| --- | ---: |
| Dari Stock Issue | 8.400.047 |
| Dikembalikan | − 1.200.007 |
| **Saldo akun WIP** | **7.200.040** |
| Buku produksi: UGH · STK-0001 · 600 g | **7.200.040** ✓ |

## 7. BSTB ke Finish Goods

Langkahnya sama, hanya tanpa pilihan nilai. Bedanya, barang yang pulang biasanya
**bukan barang yang dulu keluar**: sarang mentah masuk, kotak keluar. No. Stok kotak
lahir di produksi dan saat Terima baru pertama kali punya saldo stok. Pool Item kotak
bertambah sebesar nilai yang dibawanya (bahan + biaya Unit + bahan penolong).
Contoh dengan angka hasil menjalankan kode: `Produksi/10`.

---

## 8. Dua arah berdampingan

| Pertanyaan | Logistik → Produksi | Produksi → Logistik |
| --- | --- | --- |
| Dokumen pengirim | Stock Issue | Production Issue |
| Dokumen penerima | Production Receipt | Stock Receipt |
| Draft di pengirim? | ya | tidak |
| Nilai beku berasal dari | rata-rata pool saat Kirim | nilai bucket produksi saat Kirim |
| Saat Kirim, barang tercatat di | dokumen saja (sudah keluar stok) | bucket Dalam Perjalanan di buku produksi |
| Jurnal | **saat Kirim**, tanggal dokumen | **saat Terima**, tanggal hari itu |
| Yang dikreditkan / didebit | Dr WIP / Cr Persediaan | Dr Persediaan atau Beban / Cr WIP |
| Penerima memilih | tidak ada | lokasi, status, nilai (Pengeluaran) |
| No. Stok | tetap | tetap |
| No. Job | lahir saat Terima | berhenti; tersimpan sebagai teks `job_no` |

**Mengapa jurnalnya tidak simetris?** WIP diartikan "milik produksi, termasuk yang di
jalan". Maka barang menjadi WIP begitu meninggalkan gudang, dan berhenti menjadi WIP
begitu gudang benar-benar menerimanya. Selama di jalan, ke arah mana pun, ia WIP.
Jurnal juga selalu lahir di sisi ERP.

## 9. Yang menahan transfer

| Saat | Penyebab |
| --- | --- |
| Kirim Stock Issue | lot belum dipilih penuh; stok kurang; akun WIP kategori kosong; Gudang Transit; periode terkunci |
| Terima Production Receipt | sudah diterima; tanggal kirim masih di depan; periode hari ini terkunci |
| Kirim Production Issue | FG bukan dari Unit terakhir; Job tidak utuh; barang sudah pindah |
| Terima Stock Receipt | lokasi wajib tetapi kosong; nilai belum dipilih; akun belum lengkap; nilai di bucket transit tidak sama dengan nilai beku |

Gudang dibatasi per user (OD-9) pada Stock Issue dan Stock Receipt; Unit dibatasi per
user (P260) pada Production Receipt dan Production Issue.

## 10. Tidak ada jalan batal

Yang sudah dikirim tidak bisa dibatalkan atau ditolak penerima.

| Salah kirim | Koreksinya |
| --- | --- |
| Stock Issue | Unit **Terima**, lalu kembalikan dengan BSTB Pengeluaran |
| Production Issue | gudang **Terima**, lalu kirim lagi dengan Stock Issue (hanya bisa ke Unit pertama routing, atau sebagai bahan penolong) |

## 11. Saat database dipisah (belum dibangun)

Sekarang satu database: pesan diantar **di dalam transaksi pengirim**, jadi kedua
dokumen lahir bersama atau tidak sama sekali. Nanti, dengan dua database, pesan masuk
outbox pengirim dan inbox penerima (P319). Karena itu pesan menyebut barang, gudang
dan Unit dengan **nomor dan kode**, bukan id, dan pesan yang sama datang dua kali
tidak mengubah apa pun.
