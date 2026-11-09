# Perhitungan Penerimaan Uang Muka Customer — penjelasan untuk developer FE

Dokumen ini menjelaskan apa yang dihitung di tampilan **sebelum data disimpan**,
untuk Penerimaan (`fin_cash_bank_tx`) yang membayar **Uang Muka Penjualan**,
PPN Include dan Exclude, **tanpa PPh**.

Sumber kebenarannya `src/lib/erp/sales-tax.ts`. Kode di §7 sudah dibandingkan
dengan fungsi aslinya pada 300.000 kasus acak dan hasilnya sama. Aturan bisnisnya
ada di `tax_concept.md` dan `Cash-Bank-Tx-Line-Logic.md`.

---

## 1. Tiga hal yang perlu dipahami dulu

1. **Include / Exclude hanya berpengaruh di Tagihan Uang Muka**, yaitu saat nilai
   yang diketik diubah menjadi DPP dan PPN. Setelah tagihan terbit, tagihan hanya
   membawa `total` dan `ppn`.
2. **Layar Penerimaan tidak pernah tahu Include atau Exclude.** Rumusnya satu dan
   sama untuk keduanya, karena hanya membaca `total`, `ppn` dan `paid` dari tagihan.
3. **Perhitungan FE hanya pratinjau.** Yang dikirim ke server hanya input user;
   server menghitung ulang semuanya dan hasil server yang disimpan. Jadi FE harus
   memakai rumus yang persis sama, supaya angka di layar tidak berbeda dengan yang
   tersimpan.

Alurnya:

```
Customer Order  →  Tagihan Uang Muka  →  Penerimaan
(mode Include/      nilai → DPP, PPN,     Diterima → bagian DPP dan
 Exclude)           Total                 bagian PPN, sisa tagihan
```

---

## 2. Aturan pembulatan

Semua angka pajak **rupiah penuh, dibulatkan setengah ke atas**, dengan satu cara
hitung: kali dulu, bagi terakhir, sekali bulatkan.

**Pakai BigInt, bukan `number`.** `ppn × paid` bisa melewati 2^53 dan hasilnya
kehilangan presisi tanpa ada error. Fungsi `mulDivRound` di §7 sudah menanganinya.

Tarif tidak boleh ditulis mati di kode. Selalu ambil dari server:

```
rate = 12          tarif PPN, persen
otherNum = 11      faktor DPP Nilai Lain
otherDen = 12
```

Rantai PPN dari sebuah DPP:

```
DPP Nilai Lain = round(DPP × 11 / 12)
PPN            = round(DPP Nilai Lain × 12 %)
Total          = DPP + PPN
```

Tagihan yang tidak Kena PPN: `DPP = nilai`, `PPN = 0`, dan modenya selalu Exclude.

---

## 3. Layar Tagihan Uang Muka

User memilih Customer Order, lalu mengetik satu nilai dalam **Persen** atau
**Nominal**.

**Langkah 1: tentukan nilai dasar persen.** Nilai dasarnya mengikuti mode harga order.

| Mode order | Nilai dasar | Arti nilai yang diketik |
| --- | --- | --- |
| Exclude | DPP order | sebelum PPN |
| Include | Total order | sudah termasuk PPN |

```
Persen  → nilai = round(nilai dasar × persen / 100)
Nominal → nilai = round(angka yang diketik)
```

**Langkah 2: pecah nilai menjadi DPP dan PPN.**

**Exclude** langsung, karena nilainya sudah DPP:

```
DPP = nilai
lalu rantai PPN (§2)
Total = DPP + PPN
```

**Include** harus mencari DPP. Hasilnya adalah **DPP terbesar yang DPP + PPN-nya
tidak melebihi nilai**:

```
1. perkiraan: DPP = floor(nilai / (1 + 12 % × 11/12))     = floor(nilai / 1,11)
2. selama DPP + PPN(DPP) > nilai    → DPP turun 1
3. selama (DPP + 1) + PPN(DPP + 1) ≤ nilai  → DPP naik 1
```

Jangan berhenti di langkah 1. PPN dibulatkan dua kali, jadi perkiraannya bisa
meleset beberapa rupiah. Membagi dengan 1,11 saja akan memberi angka yang salah.

**Total Include bisa Rp1 di bawah nilai yang diketik.** Sekitar satu dari sepuluh
nilai tidak punya pecahan yang tepat. Itu bukan bug. Tampilkan `total` hasil
hitungan, bukan nilai yang diketik, dan `total` inilah yang ditagih.

### Contoh

Customer Order: DPP 10.000.000, PPN 1.100.000, Total 11.100.000.

| Kasus | Diketik | Nilai | DPP | DPP Nilai Lain | PPN | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Exclude, persen | 30 % | 3.000.000 | 3.000.000 | 2.750.000 | 330.000 | 3.330.000 |
| Include, persen | 30 % | 3.330.000 | 3.000.000 | 2.750.000 | 330.000 | 3.330.000 |
| Exclude, nominal | 1.000.000 | 1.000.000 | 1.000.000 | 916.667 | 110.000 | 1.110.000 |
| Include, nominal | 1.000.000 | 1.000.000 | 900.901 | 825.826 | 99.099 | 1.000.000 |
| Include, tidak tepat | 1.000.004 | 1.000.004 | 900.904 | 825.829 | 99.099 | **1.000.003** |

Perhatikan dua baris nominal: angka yang diketik sama, tetapi Exclude menagih
1.110.000 sedangkan Include menagih 1.000.000.

Uraian baris Include nominal 1.000.000:

```
perkiraan   DPP = floor(1.000.000 / 1,11)  = 900.900
cek         900.900 → DNL 825.825 → PPN 99.099 → total   999.999   (masih boleh naik)
naik 1      900.901 → DNL 825.826 → PPN 99.099 → total 1.000.000   (masih ≤ nilai)
coba naik   900.902 → DNL 825.827 → PPN 99.099 → total 1.000.001   (melebihi, berhenti)
hasil       DPP 900.901, PPN 99.099
```

---

## 4. Layar Penerimaan

### 4.1 Data dari server

Untuk setiap tagihan yang dipilih, server memberi tiga angka. Ketiganya dibaca
dari tabel, tidak dihitung ulang:

| Field | Arti | Uang Muka diambil dari | Invoice diambil dari |
| --- | --- | --- | --- |
| `total` | total tagihan, termasuk PPN | `fin_ar_advance.total_amount` | `fin_ar_invoice.total_amount` |
| `ppn` | PPN tagihan | `fin_ar_advance.ppn_amount` | `fin_ar_invoice.ppn_amount` |
| `paid` | yang sudah dibayar | `fin_ar_item.paid_amount` milik tagihan itu | `fin_ar_item.paid_amount` milik Invoice itu |

Catatan per kolom:

- **`total` dan `ppn` tagihan uang muka** adalah angka saat tagihan diterbitkan
  (§3). Penerimaan tidak menghitung ulang dari Customer Order, jadi Include atau
  Exclude tidak berpengaruh lagi di sini.
- **`total` Invoice sudah bersih dari uang muka**, dan `ppn` Invoice adalah PPN
  penuh dikurangi PPN uang muka yang dipakai. Jadi yang ditagih ke customer
  memang angka ini, bukan nilai bruto Invoice.
- **`paid` tidak disimpan di tagihan atau di Invoice.** Tempatnya di AR item
  milik dokumen itu (satu dokumen, satu item). Item dicari lewat pasangan
  sumbernya:

  ```sql
  SELECT i.paid_amount
  FROM fin_ar_item i
  JOIN sys_doc_type t ON t.id = i.source_doc_type_id
  WHERE t.doc_table = 'fin_ar_advance'   -- atau 'fin_ar_invoice'
    AND i.source_doc_id = :id_tagihan;
  ```

  Bila tidak ada baris, `paid = 0`. Itu normal untuk tagihan uang muka yang
  belum pernah dibayar, karena item Uang Muka baru lahir di pembayaran pertama.
  Item Invoice lahir saat Invoice di-posting, jadi `paid`-nya mulai dari 0.
- **`paid` hanya naik saat Posting.** Penerimaan yang masih Draft belum
  menambahnya, jadi Draft lain tidak ikut dihitung.

Di kode, ketiga angka ini disiapkan oleh `settlementAdvances` (`ar-advance.ts`),
`settlementInvoices` (`ar-invoice.ts`) dan `arPaidByDocument` (`ar-item.ts`),
lalu digabung `openBills` di `cash-bank-tx.ts`.

### 4.2 Input user

| Input | Level | Disimpan di |
| --- | --- | --- |
| Diterima | per baris | `fin_cash_bank_tx_line.settled_amount` (tanpa PPh, Diterima = Dilunasi) |
| Biaya Bank | header | `fin_cash_bank_tx.bank_charge` |

### 4.3 Hitungan per baris

Tanpa PPh, semua yang diterima melunasi tagihan: **Dilunasi = Diterima**.

```
Sisa sekarang  = total − paid
Dilunasi       = Diterima
after          = paid + Dilunasi

Bagian PPN     = round(ppn × after / total) − round(ppn × paid / total)
Bagian DPP     = Dilunasi − Bagian PPN
Sisa setelah   = Sisa sekarang − Dilunasi
```

Asal dan tujuan setiap angka:

| Angka | Rumus | Asal data | Disimpan di |
| --- | --- | --- | --- |
| `total` | dibaca | `total_amount` tagihan atau Invoice | tidak disimpan ulang |
| `ppn` | dibaca | `ppn_amount` tagihan atau Invoice | tidak disimpan ulang |
| `paid` | dibaca | `fin_ar_item.paid_amount` | tidak disimpan ulang |
| Sisa sekarang | `total − paid` | hitungan layar | tidak disimpan; batas atas Diterima |
| Dilunasi | `= Diterima` | input user | `fin_cash_bank_tx_line.settled_amount` |
| `after` | `paid + Dilunasi` | hitungan layar | tidak disimpan; jadi `paid_amount` baru saat Posting |
| Bagian PPN | rumus kumulatif | hitungan layar | `fin_cash_bank_tx_line.ppn_part` |
| Bagian DPP | `Dilunasi − Bagian PPN` | hitungan layar | `fin_cash_bank_tx_line.dpp_part` |
| Sisa setelah | `Sisa sekarang − Dilunasi` | hitungan layar | tidak disimpan; tampil di baris |

Langkah demi langkah, dengan angka contoh B bayar kedua (§5): tagihan Exclude
`ARA/2026/11/0001`, sudah dibayar 1.000.000.

1. **Baca tagihan.** `fin_ar_advance`: `total_amount` 3.330.000,
   `ppn_amount` 330.000.
2. **Baca yang sudah dibayar.** `fin_ar_item` dengan sumber tagihan itu:
   `paid_amount` 1.000.000.
3. **Sisa sekarang** = 3.330.000 − 1.000.000 = 2.330.000. Diterima tidak boleh
   lebih dari ini.
4. **User mengetik Diterima** 2.330.000, jadi Dilunasi = 2.330.000.
5. **after** = 1.000.000 + 2.330.000 = 3.330.000, yaitu posisi tagihan setelah
   pembayaran ini.
6. **Bagian PPN** = PPN tagihan sampai `after` dikurangi PPN tagihan sampai
   `paid`:
   `round(330.000 × 3.330.000 / 3.330.000) − round(330.000 × 1.000.000 / 3.330.000)`
   = 330.000 − 99.099 = 230.901.
   Angka 99.099 sama dengan Bagian PPN bayar pertama, jadi cicilan tidak
   menghitung PPN yang sudah dihitung cicilan sebelumnya.
7. **Bagian DPP** = 2.330.000 − 230.901 = 2.099.099.
8. **Sisa setelah** = 2.330.000 − 2.330.000 = 0, tagihan lunas.

Saat **Simpan**, baris `fin_cash_bank_tx_line` ditulis dengan
`settled_amount` 2.330.000, `ppn_part` 230.901 dan `dpp_part` 2.099.099.
Saat **Posting**, server menghitung ulang semuanya dari `paid` terbaru, lalu
`fin_ar_item.paid_amount` naik menjadi 3.330.000 dan saldo item Uang Muka naik
sebesar `dpp_part`. Rinciannya ada di `Penjelasan-AR-Item-dan-Buku-Piutang.md`.

**Bagian DPP dihitung dengan pengurangan, bukan dibagi sendiri**, supaya
`Bagian DPP + Bagian PPN = Dilunasi` selalu tepat.

**Bagian PPN memakai rumus kumulatif.** Jangan memakai `ppn × Dilunasi / total`.
Rumus sederhana itu bisa benar pada pembayaran pertama, tetapi jumlah cicilannya
bisa selisih Rp1 dari PPN tagihan. Rumus kumulatif menjamin semua cicilan
berjumlah tepat sama dengan `ppn`. Bukti ada di contoh C (§5).

### 4.4 Hitungan header

```
Total Diterima      = Σ Diterima semua baris
Dana Masuk ke Bank  = Total Diterima − Biaya Bank
```

Biaya Bank **tidak dibagi ke baris** dan tidak mengurangi pelunasan tagihan.
Customer tetap dianggap membayar penuh; biayanya ditanggung perusahaan.

---

## 5. Contoh Penerimaan

Biaya Bank 0 kecuali disebut.

**A. Exclude, lunas sekali.** Tagihan `total 3.330.000`, `ppn 330.000`, `paid 0`.

| Diterima | Bagian PPN | Bagian DPP | Sisa setelah |
| --- | --- | --- | --- |
| 3.330.000 | 330.000 | 3.000.000 | 0 |

**B. Exclude, dua kali bayar.** Tagihan yang sama.

| Bayar | `paid` | Diterima | Bagian PPN | Bagian DPP | Sisa setelah |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 1.000.000 | 99.099 | 900.901 | 2.330.000 |
| 2 | 1.000.000 | 2.330.000 | 230.901 | 2.099.099 | 0 |
| Jumlah | | 3.330.000 | 330.000 | 3.000.000 | |

Bayar 1: `round(330.000 × 1.000.000 / 3.330.000) − 0 = 99.099`.
Bayar 2: `330.000 − 99.099 = 230.901`.

**C. Include, tiga kali bayar.** Tagihan `total 1.000.000`, `ppn 99.099`, `paid 0`.

| Bayar | `paid` | Diterima | Bagian PPN | Bagian DPP | Sisa setelah |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 400.000 | 39.640 | 360.360 | 600.000 |
| 2 | 400.000 | 300.000 | 29.729 | 270.271 | 300.000 |
| 3 | 700.000 | 300.000 | 29.730 | 270.270 | 0 |
| Jumlah | | 1.000.000 | 99.099 | 900.901 | |

Bayar 2 dihitung:

```
round(99.099 × 700.000 / 1.000.000) = round(69.369,3) = 69.369
round(99.099 × 400.000 / 1.000.000) = round(39.639,6) = 39.640
Bagian PPN = 69.369 − 39.640 = 29.729
```

Kalau memakai rumus sederhana, bayar 2 menjadi `round(29.729,7) = 29.730`, dan
jumlah ketiga cicilan menjadi 99.100, **selisih Rp1** dari PPN tagihan.

**D. Header dengan Biaya Bank.** Satu Penerimaan membayar dua tagihan, 3.330.000
dan 1.000.000, Biaya Bank 6.500.

```
Total Diterima     = 3.330.000 + 1.000.000 = 4.330.000
Dana Masuk ke Bank = 4.330.000 − 6.500     = 4.323.500
```

Untuk tagihan **tidak Kena PPN**, rumusnya sama: `ppn = 0`, jadi Bagian PPN 0 dan
Bagian DPP = Diterima.

---

## 6. Validasi dan yang dikirim

Tampilkan di form. Server tetap mengecek ulang semuanya.

| Kondisi | Pesan |
| --- | --- |
| Diterima kosong atau 0 | Isi nilai yang diterima. |
| Diterima bukan rupiah penuh | Nilai diterima harus dalam rupiah penuh. |
| Diterima > `total − paid` | Melebihi sisa tagihan. |
| Biaya Bank negatif atau berdesimal | Biaya bank harus rupiah penuh, nol atau lebih. |
| Biaya Bank ≥ Total Diterima | Biaya bank harus lebih kecil dari total diterima. |

Tidak ada lebih bayar: uang lebih tidak bisa disimpan di Penerimaan ini. Bayar
sebagian boleh, sisanya tetap terbuka di tagihan.

**Yang dikirim saat Simpan hanya input.** Bagian DPP, Bagian PPN dan Dana Masuk
ke Bank tidak dikirim:

```
{ purpose, partner_id, cash_bank_id, tx_date, bank_ref, note, bank_charge,
  lines: [{ doc_type, doc_id, cash, withhold: false }] }
```

Simpan menghasilkan Draft dan belum mengubah `paid`. `paid` baru naik saat
Posting, jadi kalau dua Draft membayar tagihan yang sama, Draft yang di-posting
belakangan bisa ditolak server walaupun saat disimpan lolos.

---

## 7. Kode

JavaScript murni, tanpa dependensi.

```js
// round(a × b / c), setengah ke atas, di atas BigInt: a × b bisa melewati 2^53.
function mulDivRound(a, b, c) {
  const n = BigInt(Math.round(a)) * BigInt(Math.round(b));
  const d = BigInt(Math.round(c));
  let q = n / d;
  if ((n % d) * 2n >= d) q += 1n;
  return Number(q);
}

// DPP → DPP Nilai Lain → PPN. rates = { rate: 12, otherNum: 11, otherDen: 12 }
function ppnChain(dpp, r) {
  const dppOther = mulDivRound(dpp, r.otherNum, r.otherDen);
  const ppn = mulDivRound(dppOther, Math.round(r.rate * 10000), 1000000);
  return { dppOther, ppn };
}

// Harga termasuk PPN → DPP terbesar yang DPP + PPN-nya tidak melebihi harga.
function inclusiveSplit(price, r) {
  const p = Math.round(price);
  if (p <= 0) return { dpp: p, dppOther: 0, ppn: 0 };
  const total = (d) => d + ppnChain(d, r).ppn;
  let d = Math.floor(p / (1 + ((r.rate / 100) * r.otherNum) / r.otherDen));
  while (d > 0 && total(d) > p) d--;
  while (total(d + 1) <= p) d++;
  return { dpp: d, ...ppnChain(d, r) };
}

// LAYAR TAGIHAN UANG MUKA
// order: { mode: "Include" | "Exclude", taxable, dpp, total } milik Customer Order
// type: "Percent" | "Amount", typed: angka yang diketik user
export function computeAdvanceBill(order, type, typed, rates) {
  const base = order.taxable && order.mode === "Include" ? order.total : order.dpp;
  const amount = type === "Percent" ? Math.round((base * (Number(typed) || 0)) / 100) : Math.round(Number(typed) || 0);
  let tax;
  if (!order.taxable || !rates) tax = { dpp: amount, dppOther: 0, ppn: 0 };
  else if (order.mode === "Include") tax = inclusiveSplit(amount, rates);
  else tax = { dpp: amount, ...ppnChain(amount, rates) };
  return { amount, ...tax, total: tax.dpp + tax.ppn };
}

// LAYAR PENERIMAAN, satu baris, tanpa PPh
// bill: { total, ppn, paid } dari server. cash: Diterima yang diketik user
export function computeReceiptLine(bill, cash) {
  const open = Math.max(0, bill.total - bill.paid);
  const settled = Math.max(0, Math.round(Number(cash) || 0));
  const after = bill.paid + settled;
  const upTo = (u) => (bill.total > 0 ? mulDivRound(bill.ppn, Math.min(u, bill.total), bill.total) : 0);
  const ppnPart = upTo(after) - upTo(bill.paid);
  let error = null;
  if (!(settled > 0)) error = "Isi nilai yang diterima.";
  else if (settled > open) error = "Melebihi sisa tagihan.";
  return { open, settled, ppnPart, dppPart: settled - ppnPart, remaining: open - settled, error };
}

// LAYAR PENERIMAAN, header
export function computeReceiptHeader(lines, bankCharge) {
  const received = lines.reduce((a, l) => a + l.settled, 0);
  const charge = Number(bankCharge) || 0;
  let error = null;
  if (charge < 0 || charge !== Math.round(charge)) error = "Biaya bank harus rupiah penuh, nol atau lebih.";
  else if (lines.length && charge >= received) error = "Biaya bank harus lebih kecil dari total diterima.";
  return { received, intoBank: received - charge, error };
}
```

Pemakaian:

```js
const rates = { rate: 12, otherNum: 11, otherDen: 12 };
const order = { mode: "Include", taxable: true, dpp: 10000000, total: 11100000 };

const bill = computeAdvanceBill(order, "Amount", 1000000, rates);
// { amount: 1000000, dpp: 900901, dppOther: 825826, ppn: 99099, total: 1000000 }

const line = computeReceiptLine({ total: bill.total, ppn: bill.ppn, paid: 400000 }, 300000);
// { open: 600000, settled: 300000, ppnPart: 29729, dppPart: 270271, remaining: 300000, error: null }

const header = computeReceiptHeader([line], 6500);
// { received: 300000, intoBank: 293500, error: null }
```

`computeReceiptLine` memakai `Math.round` pada input, jadi validasi "rupiah penuh"
dicek dari nilai mentah sebelum memanggilnya. Field input uang di aplikasi ini
memang hanya menerima rupiah penuh.

**Batas kode ini: hanya berlaku bila tidak ada PPh** (`withhold: false`). Begitu
Potong PPh menyala, Dilunasi tidak lagi sama dengan Diterima, dan perhitungannya
memakai `settleBillFromCash` di `sales-tax.ts`.

---

## 8. Angka uji

Pakai tabel ini sebagai test FE.

| Fungsi | Input | Hasil yang diharapkan |
| --- | --- | --- |
| Tagihan | Exclude, 30 % | DPP 3.000.000, PPN 330.000, Total 3.330.000 |
| Tagihan | Include, 30 % | DPP 3.000.000, PPN 330.000, Total 3.330.000 |
| Tagihan | Exclude, Rp 1.000.000 | DPP 1.000.000, PPN 110.000, Total 1.110.000 |
| Tagihan | Include, Rp 1.000.000 | DPP 900.901, PPN 99.099, Total 1.000.000 |
| Tagihan | Include, Rp 1.000.004 | DPP 900.904, PPN 99.099, Total 1.000.003 |
| Baris | total 3.330.000, ppn 330.000, paid 0, terima 1.000.000 | PPN 99.099, DPP 900.901, sisa 2.330.000 |
| Baris | total 3.330.000, ppn 330.000, paid 1.000.000, terima 2.330.000 | PPN 230.901, DPP 2.099.099, sisa 0 |
| Baris | total 1.000.000, ppn 99.099, paid 0, terima 400.000 | PPN 39.640, DPP 360.360, sisa 600.000 |
| Baris | total 1.000.000, ppn 99.099, paid 400.000, terima 300.000 | PPN 29.729, DPP 270.271, sisa 300.000 |
| Baris | total 1.000.000, ppn 99.099, paid 700.000, terima 300.000 | PPN 29.730, DPP 270.270, sisa 0 |
| Baris | total 3.330.000, paid 1.000.000, terima 2.330.001 | error Melebihi sisa tagihan. |
| Header | terima 4.330.000, biaya 6.500 | Dana Masuk ke Bank 4.323.500 |
| Header | terima 5.000, biaya 5.000 | error Biaya bank harus lebih kecil dari total diterima. |
