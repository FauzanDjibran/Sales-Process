# Keluar Masuk Barang 00 — Baca dulu: empat dokumen dan cerita contoh

Seri ini menjelaskan empat dokumen (P317, P324):

| Dokumen | Aplikasi | Tabel | Singkatnya |
| --- | --- | --- | --- |
| **Stock Issue** | ERP | `log_stock_issue*` | barang **keluar gudang** tanpa partner |
| **Stock Receipt** | ERP | `log_stock_receipt*` | barang **masuk gudang** tanpa partner |
| **Production Receipt** | Produksi | `prd_receipt*` | barang **masuk produksi** |
| **Production Issue** | Produksi | `prd_issue*` | barang **keluar produksi** |

Ada dua cara membacanya:

| Sudut pandang | Pertanyaan | Bagian |
| --- | --- | --- |
| **Transfer** | bagaimana barang pindah dari logistik ke produksi dan kembali? | **02** |
| **Alat keluar masuk** | menu mana yang mengeluarkan atau memasukkan barang, dari buku mana, dengan nilai apa? | **03** |

| Bagian | Isi |
| --- | --- |
| **00** | Peta, istilah, cerita contoh |
| **01** | DBML empat dokumen dan buku yang mereka tulis |
| **02** | Simulasi transfer logistik ⇄ produksi |
| **03** | Keempatnya sebagai alat keluar dan masuk barang |

Ditulis menurut kode per 27/11/2026. **Angka contoh dihitung tangan** menurut rumus
di kode dan aritmetikanya dicek ulang dengan skrip. Cerita ini **tidak** dijalankan
di database, jadi nomor dokumennya contoh. Contoh yang berasal dari menjalankan kode
asli ada di seri `Produksi/` (bagian 03 dan 10).

---

## 1. Peta

```
            ERP (buku stok)                    │             PRODUKSI (buku produksi)
                                               │
 STOCK ISSUE  ── Kirim ──── pesan IssueSent ───┼──────►  PRODUCTION RECEIPT  (lahir, menunggu)
 (BSTB Issue)    stok keluar                   │              │ Terima oleh Unit
   ▲             Dr WIP / Cr Persediaan        │              ▼ masuk Persiapan
   └──────────────── pesan IssueReceived ◄─────┼──────────────┘
                                               │
                                               │        … grading, kerja, QC, push, kotak …
                                               │
 STOCK RECEIPT (lahir, menunggu) ◄─────────────┼── pesan ReceiptSent ──  PRODUCTION ISSUE
      │ Terima oleh Gudang                     │                         Kirim: Dalam Perjalanan
      ▼ stok masuk                             │                              ▲
      Dr Persediaan / Cr WIP ── pesan ReceiptReceived ────────────────────────┘ keluar dari buku
```

Yang perlu diingat:

1. **Berpasangan, nomor sama.** Satu perpindahan = dokumen pengirim + dokumen penerima.
2. **Pengirim membekukan nilai.** Penerima tidak pernah menghitung ulang.
3. **Dokumen penerima tidak pernah diketik.** Ia lahir dari Kirim.
4. **Jurnal selalu ditulis ERP.** Stock Issue menjurnal saat Kirim; Stock Receipt saat
   Terima. Production Receipt dan Production Issue tidak menjurnal apa pun.
5. **Tiap sisi hanya menulis tabel dan bukunya sendiri.** Satu-satunya titik temu
   adalah `handover.ts`.

## 2. Istilah

| Istilah | Arti |
| --- | --- |
| **No. Stok** | identitas barang, `log_stock_tracking.tracking_no`, unik di seluruh sistem. Tetap sama saat menyeberang. Di layar ERP: *Lot* |
| **Pool** | qty (Q) dan nilai (V) satu barang untuk **seluruh perusahaan**. Rata-rata = V ÷ Q |
| **Bucket** | saldo per tempat. Gudang: gudang · lokasi · lot · status. Produksi: No. Stok · Unit · tahap · … |
| **WIP** | nilai barang yang sudah keluar stok dan belum kembali, **termasuk yang masih di jalan** |
| **Nilai beku** | nilai yang ditetapkan pengirim saat Kirim, disalin ke dokumen penerima |
| **Pesan** | `IssueSent`, `IssueReceived`, `ReceiptSent`, `ReceiptReceived` |

## 3. Cerita contoh

Barang **SM-A** (sarang mentah, gram), Unit **UGH**, Gudang Bahan Baku **GBB**, tanpa lokasi.

Saldo awal:

| Pool SM-A | Q | V |
| --- | ---: | ---: |
| seluruh perusahaan | 1.500 g | 18.000.100 |

| Bucket GBB (Tersedia) | Qty |
| --- | ---: |
| STK-0001 | 1.000 g |
| STK-0002 | 500 g |

| # | Tanggal | Kejadian | Dokumen |
| --: | --- | --- | --- |
| A | 27/11 | Gudang kirim 600 g STK-0001 + 100 g STK-0002 ke UGH | `BSTB_UGH_271126_00001` |
| B | 27/11 | Sebelum UGH menerima, ada pembelian 200 g (STK-0003), Rp 3.000.000 | Receipt Note |
| C | 28/11 | UGH menekan Terima | Production Receipt, nomor A |
| D | 28/11 | UGH mengembalikan STK-0002 (100 g, belum dikerjakan) | `BPG_UGH_281126_00001` |
| E | 28/11 | Gudang menekan Terima | Stock Receipt, nomor D |
| F | 28/11 | Gudang memusnahkan 10 g STK-0002 | `SIS/2026/11/0001` |
