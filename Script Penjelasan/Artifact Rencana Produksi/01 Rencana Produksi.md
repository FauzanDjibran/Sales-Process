# Rencana Produksi 01: mengumpulkan Sales Order

ERP › Produksi › Perencanaan › **Rencana Produksi**. Langkah simulasi 1 sampai 3.

## 1. Cara pakai

| # | Layar | Yang dilakukan |
| --: | --- | --- |
| 1 | Register | Kotak atas menampilkan antrean: baris Sales Order yang belum dipenuhi FG dan belum punya Perintah |
| 2 | *Buat Rencana* › **Pilih Sales Order** | Centang baris; Qty terisi sisanya dan boleh dikurangi |
| 3 | Tab **Yang Dibuat** | Item digabung. Naik-turunkan **prioritas**, pilih **keputusan** |
| 4 | Kolom Bahan › **Atur** | Campuran bahan sebar, target Job Order, bahan baku, rendemen |
| 5 | Tab **Bahan** | Yang dibutuhkan, tersedia, kurang |
| 6 | **Simpan & Ajukan**, lalu **Setujui** | Konfirmasi menyebut yang akan terbit per item |

| Status | Arti |
| --- | --- |
| Draft | Bisa diubah atau dibatalkan |
| Diajukan | Menunggu; bisa ditolak |
| Berlaku | Perintahnya sudah terbit |
| Selesai | Semua Perintahnya Selesai atau Ditutup Kurang (dihitung, tidak ditekan) |

## 2. Hitungan

```
Dibutuhkan = Σ Qty yang dipilih per item
FG         = min(FG bebas, Dibutuhkan)        FG bebas = FG − yang sudah jatah Sales Order lain
Dibuat     = Dibutuhkan − FG
```

| Item | Dibutuhkan | FG | Dibuat | Keputusan |
| --- | ---: | ---: | ---: | --- |
| BSD50 | 3 | 3 | 0 | Kirim dari FG |
| BMK50 (SO 0001 + 0002) | 18 | 4 | **14** | Produksi |
| BMK100 | 4 | 0 | **4** | Produksi |
| IDM50 | 5 | 0 | **5** | Beli bahan dulu: SM-PT kurang 293 g |
| BMK100 (Pra-SO) | 6 | 0 | 6 | Beli bahan saja: SM-A kurang 657 g |

- Prioritas awal mengikuti Tanggal Kirim terdekat. Bahan dihitung untuk prioritas lebih tinggi dulu.
- FG dibagi ke Sales Order dengan Tanggal Kirim terdekat: 4 kotak FG menjadi jatah SO 0001, sehingga Perintah BMK50 melayani
  SO 0001 sebanyak 6 dan SO 0002 sebanyak 8.
- *Mulai Dari* menyebut titik terdekat: FG, Siap packing, Siap Penyebaran, atau Bahan baku. *Batas Mulai* mengikutinya.

## 3. Keputusan

| Keputusan | Saat disetujui |
| --- | --- |
| Produksi | Perintah terbit |
| Beli bahan dulu | Perintah terbit **Menunggu Bahan**, Purchase Request menyebut Perintah itu |
| Tunda | Tidak terbit apa pun; baris tetap di antrean |
| Kirim dari FG | Menjadi jatah Sales Order; langsung *Siap Kirim* |
| Pra-SO | Hanya Purchase Request, tanpa Perintah |

## 4. Ditolak bila

| Keadaan | Pesan |
| --- | --- |
| Qty melebihi sisa antrean | *diisi n, sisa yang belum direncanakan m kotak* |
| Tanpa baris | *Pilih minimal satu baris Sales Order.* |
| Batalkan atau Tolak tanpa alasan | tombol tidak aktif |
