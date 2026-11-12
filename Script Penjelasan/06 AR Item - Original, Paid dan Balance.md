# AR Item — original, paid, balance

Ringkasan tiga angka pada `fin_ar_item`, untuk **Uang Muka (Advance)** dan **Invoice**: dari mana datanya, kapan berubah, dan apa gunanya. Dasar: P71–P75, P116–P119, P133, P214. Kode: `src/lib/erp/ar-item.ts`.

## 1. Prinsip

- **Satu dokumen, satu item** (P214). Identitas item adalah dokumen sumbernya `(source_doc_type_id, source_doc_id)`, unik.
- Tiga angka dengan **ukuran berbeda**:

| Kolom | Ukuran | Menjawab |
|---|---|---|
| `original_amount` | Buku (sama dengan akun Buku Besar) | Berapa yang pernah masuk ke buku lewat item ini |
| `current_balance` | Buku | Berapa yang masih terbuka di buku |
| `paid_amount` | Dokumen (kas + PPh, termasuk PPN) | Berapa bagian dokumen yang sudah dilunasi pembayaran |

- `current_balance` = Σ `movement` di `fin_ar_ledger` (Buku Piutang), ditulis dalam transaksi yang sama dengan tiap entri. Ledger append-only; koreksi adalah dokumen baru.
- Dokumen sumber (tagihan / Invoice) **tidak menyimpan angka yang dibayar**. Yang membayar dibaca dari item lewat id dokumennya.

## 2. Uang Muka (`item_type = Advance`)

**Item lahir** saat pembayaran pertama atas tagihan Uang Muka diposting (bukan saat tagihan diterbitkan; tagihan tidak menulis apa pun ke buku).

| Kolom | Sumber saat lahir | Perubahan berikutnya |
|---|---|---|
| `original_amount` | **DPP bagian** dari uang yang diterima (baris Penerimaan) | **Naik** di setiap pembayaran berikutnya (+ DPP bagian). Tidak turun |
| `current_balance` | = DPP bagian pembayaran pertama | **Naik** di setiap pembayaran (`AdvanceReceived`), **turun** saat Invoice memakainya (`AdvanceUsed`) |
| `paid_amount` | kas + PPh pembayaran pertama (bagian tagihan yang terlunasi, termasuk PPN) | **Naik** di setiap pembayaran (kas + PPh). Tidak berubah saat dipakai Invoice |

- DPP bagian = pembagian posisional dari pembayaran atas tagihan: DPP, PPN, PPh (`tax_concept.md` §7.5). Jurnal: Dr Kas & Bank, Dr PPh Dibayar Dimuka / Cr Uang Muka Penjualan (DPP bagian), Cr PPN Keluaran.
- `paid_amount` dibandingkan dengan **total tagihan** (DPP + PPN), bukan dengan `original_amount`. Karena itu `paid` bisa lebih besar dari `original` (selisihnya PPN dan PPh).
- Tidak boleh melebihi total tagihan (ditolak di `receiveAdvance`).
- `original_amount − current_balance` = **DPP yang sudah dipakai Invoice**. Dipakai `advancePpnUsed` untuk PPN kumulatif uang muka (P118). **Rumus ini hanya benar kalau `original` = DPP yang sudah diterima.**
- Laporan: kolom "Diterima" di Uang Muka Customer / Supplier = `original_amount`. Item dicocokkan dengan akun Uang Muka Penjualan per customer (`db:reconcile`).

### Entri ledger Uang Muka

| Event | Kapan | `movement` |
|---|---|---|
| `Create` | Pembayaran pertama | + DPP bagian |
| `AdvanceReceived` | Pembayaran berikutnya | + DPP bagian |
| `AdvanceUsed` (Dipakai Invoice) | Invoice diposting | − DPP yang dipakai |

Pembayaran yang DPP bagiannya nol (misal hanya menutup PPN) tetap menaikkan `paid_amount`, tapi tidak menulis entri ledger.

## 3. Invoice (`item_type = Invoice`)

**Item lahir** saat Invoice diposting, selalu, bahkan bila uang muka menutupnya penuh (P117).

| Kolom | Sumber saat lahir | Perubahan berikutnya |
|---|---|---|
| `original_amount` | **Nilai muka**: DPP penuh + PPN penuh | **Tetap**, tidak pernah berubah |
| `current_balance` | = `original_amount` | **Turun** oleh uang muka yang diterapkan (`AdvanceApplied`) dan oleh pembayaran (`Payment`). Tidak pernah di bawah nol |
| `paid_amount` | 0 | **Naik** hanya oleh `Payment` (kas + PPh). **Tidak naik** oleh `AdvanceApplied` |

- `AdvanceApplied` = DPP uang muka yang dipakai + PPN bagian itu. PPN-nya tidak pernah masuk Piutang (sudah ke PPN Keluaran saat uang muka dibayar), jadi dua sisi (Uang Muka turun DPP, Invoice turun DPP + PPN) berbeda sebesar PPN uang muka.
- **Total bersih** (`total_amount` Invoice) = `original − uang muka diterapkan`. `paid_amount` dibandingkan dengan total bersih ini.
- Hubungan yang dijaga `db:reconcile`: `original − applied = total bersih`, `total bersih − paid = current_balance`.
- Status Belum Dibayar / Sebagian / Lunas dan "Lewat jatuh tempo" dibaca dari item. Lunas ketika `current_balance` = 0.
- PPh pembayaran dihitung dari **DPP bersih setelah uang muka** (PPh uang muka sudah dipotong saat uang muka dibayar), lalu dibagi posisional memakai `paid_amount` sebagai titik "sebelum" (P119).

### Entri ledger Invoice

| Event | Kapan | `movement` |
|---|---|---|
| `Create` | Invoice diposting | + nilai muka |
| `AdvanceApplied` (Uang Muka Diterapkan) | Invoice memakai uang muka | − (DPP dipakai + PPN bagiannya) |
| `Payment` | Penerimaan dari Customer | − kas + PPh yang menyelesaikan |

## 4. Contoh berangkai

Tagihan Uang Muka 6.660.000 (DPP 6.000.000 + PPN 660.000), tanpa PPh. Invoice 22.200.000 (DPP 20.000.000 + PPN 2.200.000) memakai seluruh uang muka.

| Kejadian | Item | original | balance | paid | Ledger |
|---|---|---|---|---|---|
| Tagihan diterbitkan | — | — | — | — | — |
| Bayar 1.000.000 | UM | 900.901 | 900.901 | 1.000.000 | `Create` +900.901 |
| Bayar 5.660.000 | UM | 6.000.000 | 6.000.000 | 6.660.000 | `AdvanceReceived` +5.099.099 |
| Invoice diposting | INV | 22.200.000 | 22.200.000 | 0 | `Create` +22.200.000 |
| Uang muka diterapkan | UM | 6.000.000 | 0 | 6.660.000 | `AdvanceUsed` −6.000.000 |
| | INV | 22.200.000 | 15.540.000 | 0 | `AdvanceApplied` −6.660.000 |
| Customer bayar 5.000.000 | INV | 22.200.000 | 10.540.000 | 5.000.000 | `Payment` −5.000.000 |
| Customer bayar sisanya | INV | 22.200.000 | 0 | 15.540.000 | `Payment` −10.540.000 |

## 5. Perbandingan

| | Uang Muka | Invoice |
|---|---|---|
| Item lahir saat | Pembayaran pertama | Invoice diposting |
| `original_amount` | DPP diterima, **naik** | DPP + PPN, **tetap** |
| `current_balance` naik oleh | Pembayaran | — |
| `current_balance` turun oleh | Dipakai Invoice | Uang muka diterapkan, pembayaran |
| `paid_amount` naik oleh | Pembayaran | Pembayaran (bukan uang muka diterapkan) |
| `paid_amount` dibandingkan dengan | Total tagihan (DPP + PPN) | Total bersih setelah uang muka |
| Cocok dengan akun | Uang Muka Penjualan | Piutang Usaha |

## 6. Aturan yang harus dijaga

1. `current_balance` = Σ `movement` ledger item itu, selalu.
2. `original_amount` Uang Muka = Σ DPP bagian pembayaran; jangan diisi nilai tagihan.
3. `paid_amount` hanya bertambah oleh uang yang benar-benar masuk (kas + PPh). Uang muka diterapkan bukan pembayaran.
4. Item tidak pernah di bawah nol dan `paid_amount` Uang Muka tidak pernah melebihi total tagihan.
5. Jangan membaca `original − balance` untuk Uang Muka bila `original` diubah menjadi nilai tagihan: PPN pemakaian jadi salah (P118).
