# Keluar Masuk Barang 03 — Sudut pandang alat keluar dan masuk barang

Bagian 02 melihat keempatnya sebagai pasangan. Di sini tiap menu dilihat sendiri:
**alat apa ini, buku mana yang disentuh, nilainya dari mana, lawan jurnalnya apa.**

## 1. Empat pintu

```
                 BUKU STOK                              BUKU PRODUKSI
        masuk ◄── Stock Receipt                masuk ◄── Production Receipt
       keluar ──► Stock Issue                 keluar ──► Production Issue
```

| Menu | Buku | Arah | Cara dibuat |
| --- | --- | --- | --- |
| Stock Issue | stok | keluar | **diketik** user |
| Stock Receipt | stok | masuk | lahir dari pesan atau posting dokumen lain |
| Production Receipt | produksi | masuk | lahir dari Stock Issue |
| Production Issue | produksi | keluar | dibuat dari Workspace Unit |

Keempatnya **tanpa partner** sebagai lawan transaksi, tanpa harga jual dan tanpa pajak.

---

## 2. Stock Issue — pintu keluar gudang untuk keperluan internal

Satu dokumen, **tujuan** menentukan sisanya (`stock-issue-purposes.ts`).

| Tujuan | Unit | Nomor | Langkah akhir | Debit | Ada penerima? |
| --- | --- | --- | --- | --- | --- |
| Bahan ke Produksi | Unit pertama routing | `BSTB_…` | **Kirim** | WIP | ya |
| Bahan Penolong | Unit mana pun | `BSTB_…` | **Kirim** | WIP | ya |
| Pemusnahan | tidak ada | `SIS/…` | **Posting** | Beban Pemusnahan | tidak |
| Pengambilan Sampel | tidak ada | `SIS/…` | **Posting** | Beban Pengambilan Sampel | tidak |

Kreditnya selalu **Persediaan**.

| Dimiliki semua tujuan | |
| --- | --- |
| Barang | hanya Barang dengan Kelola Stok, satuan dasar, tiap barang sekali |
| Lot | dipilih; Draft boleh sebagian, Kirim / Posting harus penuh |
| Status stok | hanya **Tersedia** |
| Nilai | `round(V × q ÷ Q)` per pick; pick yang menghabiskan pool melepas V |
| Stok kurang | ditolak |
| Nilai 0 | stok bergerak tanpa jurnal |

### F. Contoh Pemusnahan (28/11)

Lanjutan cerita (pilihan 1 di bagian 02): pool 1.100 g / 13.800.060, STK-0002 500 g.
Musnahkan 10 g, alasan wajib.

round(13.800.060 × 10 ÷ 1.100) = **125.455**

| Jurnal | Debit | Kredit |
| --- | ---: | ---: |
| Beban Pemusnahan | 125.455 | |
| Persediaan | | 125.455 |

| Sesudahnya | |
| --- | --- |
| Pool | 1.090 g / 13.674.605 |
| Bucket GBB | STK-0001 400 + STK-0002 490 + STK-0003 200 = **1.090** ✓ |
| Production Receipt | tidak ada |
| Status | `Posted` (Diposting), final |

---

## 3. Stock Receipt — pintu masuk gudang tanpa tagihan

| Tujuan | Asal | Menunggu Terima? | Nilai masuk | Jurnal |
| --- | --- | --- | --- | --- |
| BSTB ke Finish Goods | Production Issue | ya | nilai beku | Dr Persediaan / Cr WIP |
| BSTB Pengeluaran | Production Issue | ya | nilai beku **atau** 0 | Dr Persediaan atau Beban Pemusnahan Produksi / Cr WIP |
| Bonus Pembelian | posting Receipt Note yang ditimbang | **tidak**, langsung `Received` | selalu 0 | tidak ada |

- **Tidak ada tombol buat.** Menu ini tidak bisa dipakai memasukkan barang sembarang.
- BSTB: No. Stok yang sama masuk lagi. Bonus: **No. Stok baru**, dan nomor yang sudah
  ada ditolak.
- Gudang memilih lokasi dan status saat Terima (BSTB). Status bawaannya Tersedia.
- Barang bernilai 0 menaikkan Q tanpa menaikkan V, jadi **rata-rata turun**.

## 4. Production Receipt — pintu masuk produksi

| Hal | Isi |
| --- | --- |
| Sumber | hanya Stock Issue bertujuan produksi |
| Satu-satunya aksi | **Terima**, utuh |
| Hasil | bucket di **Persiapan proses pertama** Unit |
| Bahan | satu No. Job per lot |
| Bahan penolong | tanpa Job, `auxiliary = true`: dipakai habis oleh pekerjaan di Unit |
| Nilai | nilai beku |
| Jurnal | tidak ada |
| Tanggal | hari Terima |

Barang **hanya** bisa masuk produksi dari luar lewat pintu ini. Barang lain yang
muncul di produksi (hasil grading, Job Order, Kotak) adalah **transformasi** dari yang
sudah masuk.

## 5. Production Issue — pintu keluar produksi

Lihat tabel dua tujuan di bagian 02 §4. Sebagai alat keluar:

| Hal | Isi |
| --- | --- |
| Alasan (Pengeluaran) | opsional: Reject, Rusak atau pecah, Sisa produksi, Sisa bahan penolong, Lain-lain. **Tidak mengubah posting** |
| Kirim | barang belum keluar buku; pindah ke Dalam Perjalanan |
| Keluar sungguhan | saat gudang Terima (`Released`) |
| Nilai | milik bucket, dibekukan saat Kirim |
| Jurnal | tidak ada di dokumen ini; ditulis Stock Receipt |

Barang rusak di produksi **tidak** punya tombol pemusnahan sendiri: keluarkan dengan
BSTB Pengeluaran, lalu gudang memilih *Tanpa nilai*. Barang fisiknya masuk stok
bernilai 0; bila harus dibuang, lanjutkan dengan Stock Issue **Pemusnahan** (yang
melepas nilai rata-rata saat itu, bukan 0, karena pool tidak membedakan lot).

---

## 6. Dokumen lain yang juga menggerakkan barang

Agar jelas kapan **bukan** memakai Stock Issue / Receipt:

| Kejadian | Dokumen | Buku |
| --- | --- | --- |
| Beli dari supplier | Receipt Note `purchase_receipt` | stok masuk |
| Retur dari customer | Receipt Note `sales_return` | stok masuk |
| Kirim ke customer | Delivery Note | stok keluar |
| Pindah antar gudang | Transfer Kirim dan Transfer Terima | stok, tanpa jurnal |
| Selisih hitung fisik | Stock Adjustment | stok, dua arah |
| Isi data awal | `db:stock-inject` | stok masuk, tanpa jurnal |
| Pindah antar Unit | Push dan BSTB (`prd_transfer`) | produksi, tanpa jurnal |

Aturan pilihnya:

| Tanyakan | Jawaban |
| --- | --- |
| Ada customer atau supplier? | Delivery Note / Receipt Note |
| Gudang ke gudang? | Transfer |
| Selisih baru ketahuan saat dihitung? | Stock Adjustment (`11 Stock Adjustment`) |
| Dipakai sendiri atau dibuang dengan sebab jelas? | **Stock Issue** |
| Pulang dari produksi? | **Production Issue**, lalu **Stock Receipt** |

---

## 7. Ringkasan: dampak tiap pintu

| Dokumen / langkah | Qty stok | Pool (Q, V) | Buku produksi | Jurnal |
| --- | --- | --- | --- | --- |
| Stock Issue, Draft | – | – | – | – |
| Stock Issue, Kirim | turun | turun, turun | – | Dr WIP / Cr Persediaan |
| Stock Issue, Posting | turun | turun, turun | – | Dr Beban / Cr Persediaan |
| Production Receipt, Terima | – | – | naik | – |
| Production Issue, Kirim | – | – | pindah ke Dalam Perjalanan | – |
| Stock Receipt, Terima (terbawa) | naik | naik, naik | turun | Dr Persediaan / Cr WIP |
| Stock Receipt, Terima (tanpa nilai) | naik | naik, **tetap** | turun | Dr Beban Pemusnahan Produksi / Cr WIP |
| Stock Receipt, bonus | naik | naik, tetap | – | – |

## 8. Cek (`db:reconcile`)

| Yang diperiksa | Rumus |
| --- | --- |
| Stock Issue yang keluar | nilai dokumen = stok keluar = debit jurnal = nilai Production Receipt (tujuan tanpa Unit: tidak punya) |
| Stock Issue Draft / batal | tidak menggerakkan apa pun |
| Production Receipt | menyebut Stock Issue; yang diterima masuk produksi tepat senilai itu; yang menunggu belum masuk apa pun |
| Stock Receipt | header = Σ barang = Σ No. Stok = Production Issue; yang diterima masuk stok = nilai − tanpa nilai, jurnal = nilai |
| Production Issue | di jalan: bucket transit = nilai beku; diterima: `Released` = nilai beku |
| Akun WIP | = buku produksi + Stock Issue yang masih di jalan |

## 9. Batasan yang perlu diketahui

- Draft Stock Issue **tidak mereservasi** stok.
- Tidak ada terima sebagian, tolak, atau batal sesudah Kirim.
- Stock Issue hanya dari status Tersedia: barang Karantina atau Diblokir tidak bisa
  dimusnahkan lewat menu ini.
- Pemusnahan dan sampel tanpa persetujuan, dan sampel yang diberikan keluar tidak
  menghitung PPN.
- Produksi belum punya dokumen koreksi hitungan seperti Stock Adjustment.
