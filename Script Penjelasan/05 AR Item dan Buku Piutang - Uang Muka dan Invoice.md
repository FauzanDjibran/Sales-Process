# Pengisian AR Item dan Buku Piutang — Uang Muka dan Invoice

Dokumen ini menjelaskan kapan `fin_ar_item` dan `fin_ar_ledger` (Buku Piutang)
terisi, kolom apa yang ditulis, dan berapa nilainya, untuk **Uang Muka Penjualan**
dan **Invoice Penjualan**.

Satu-satunya penulis kedua tabel ini adalah `src/lib/erp/ar-item.ts`. Contoh di
§6 dijalankan dengan fungsi asli itu di database lokal, lalu di-rollback; angka
dan urutan barisnya hasil keluaran sebenarnya.

Aturan bisnisnya ada di keputusan P71–P73, P110, P116–P118, P133 dan P214
(`Claude-ERP.md`). Perhitungan DPP dan PPN penerimaannya ada di
`01 Penerimaan Customer - Perhitungan Uang Muka di Layar.md`.

---

## 1. Tiga hal yang perlu dipahami dulu

1. **Satu dokumen, satu item.** Satu tagihan uang muka punya satu item, satu
   Invoice punya satu item. Ini dijaga unique index pada
   `(source_doc_type_id, source_doc_id)`.
2. **`fin_ar_item` adalah saldo, `fin_ar_ledger` adalah riwayat.** Setiap
   perubahan saldo menulis satu baris ledger di transaksi yang sama. Ledger
   hanya ditambah, tidak pernah diubah atau dihapus. Selalu berlaku:

   ```
   current_balance = Σ movement baris ledger milik item itu
   ```

3. **Hanya Posting yang menulis.** Membuat atau menerbitkan tagihan uang muka
   tidak menulis apa pun ke dua tabel ini. Draft Penerimaan dan Draft Invoice
   juga tidak.

---

## 2. Isi `fin_ar_item`

| Kolom | Uang Muka | Invoice |
| --- | --- | --- |
| `ar_item_no` | `ARI/YYYY/MM/NNNN`, bulan dari `item_date` | sama |
| `item_type` | `Advance` | `Invoice` |
| `direction` | `Decrease` | `Increase` |
| `partner_id` | customer | customer |
| `item_date` | tanggal Penerimaan **pertama** | tanggal Invoice |
| `due_date` | kosong | jatuh tempo Invoice |
| `source_*` | tagihan uang muka (`fin_ar_advance`) | Invoice (`fin_ar_invoice`) |
| `scope_*` | Customer Order | Customer Order |
| `original_amount` | **total DPP yang sudah diterima**, naik di tiap pembayaran | nilai bruto Invoice (DPP penuh + PPN penuh), tetap |
| `current_balance` | DPP yang diterima, belum dipakai Invoice | sisa piutang |
| `paid_amount` | yang sudah dibayar tagihan: uang + PPh, **termasuk PPN** | yang sudah dibayar Invoice: uang + PPh, **tidak termasuk uang muka** |

**Perhatikan tiga hal yang sering keliru:**

- Saldo item Uang Muka memakai **DPP**, bukan nilai tagihan. PPN-nya sudah masuk
  PPN Keluaran saat uang diterima, jadi tidak pernah ada di item.
- `direction` adalah pengaruh item terhadap Piutang Usaha, bukan tanda
  `movement`. Item Uang Muka ber-`direction` `Decrease`, tetapi `movement` saat
  uang masuk tetap **positif**, karena saldo item itu sendiri bertambah.
- `paid_amount` dan `current_balance` tidak bisa saling menggantikan. Lihat
  baris Uang Muka pada contoh akhir §6: saldo 0, `paid_amount` 3.330.000.

---

## 3. Isi `fin_ar_ledger`

| Kolom | Isi |
| --- | --- |
| `ledger_no` | `BP/YYYY/MM/NNNN`, **satu nomor per Posting** |
| `line_no` | urutan baris dalam Posting itu, mulai 1 |
| `item_id` | item yang saldonya berubah |
| `event` | lihat §4 |
| `entry_date` | tanggal dokumen penyebab |
| `movement` | bertanda pada saldo item: `+` naik, `−` turun |
| `doc_type_id`, `doc_id`, `doc_no` | dokumen yang **menyebabkan** baris ini (Penerimaan atau Invoice) |
| `counter_item_id` | item pasangan, hanya untuk `AdvanceUsed` dan `AdvanceApplied` |

Jadi `source_*` di item menjawab "item ini tentang dokumen apa", sedangkan
`doc_*` di ledger menjawab "dokumen apa yang menggerakkan saldonya".

Beberapa baris dari satu Posting memakai `ledger_no` yang sama. Satu Penerimaan
yang membayar tiga tagihan menghasilkan satu nomor `BP` dengan `line_no` 1, 2, 3.

---

## 4. Event dan perubahan per kolom

| Kejadian | Fungsi | `event` | `movement` | `current_balance` | `original_amount` | `paid_amount` |
| --- | --- | --- | --- | --- | --- | --- |
| Pembayaran **pertama** tagihan uang muka | `receiveAdvance` → `createArItem` | `Create` | + bagian DPP | = bagian DPP | = bagian DPP | = Dilunasi |
| Pembayaran **berikutnya** tagihan uang muka | `receiveAdvance` | `AdvanceReceived` | + bagian DPP | + bagian DPP | + bagian DPP | + Dilunasi |
| Invoice di-posting | `createArItem` | `Create` | + nilai bruto | = nilai bruto | = nilai bruto | 0 |
| Invoice memakai uang muka, pada item Uang Muka | `settleArItem` | `AdvanceUsed` | − DPP dipakai | − DPP dipakai | tetap | tetap |
| Invoice memakai uang muka, pada item Invoice | `settleArItem` | `AdvanceApplied` | − (DPP dipakai + PPN-nya) | turun sebesar itu | tetap | tetap |
| Pembayaran Invoice | `settleArItem` | `Payment` | − Dilunasi | − Dilunasi | tetap | + Dilunasi |

`Dilunasi` adalah `settled_amount` baris Penerimaan: uang yang diterima ditambah
PPh yang dipotong customer. Tanpa PPh, nilainya sama dengan uang yang diterima.
Bagian DPP adalah `dpp_part` baris yang sama.

Saat Posting Invoice dengan uang muka, urutan tulisnya: `Create` item Invoice,
lalu untuk **setiap** uang muka yang dipakai, `AdvanceUsed` disusul
`AdvanceApplied`. Dua baris itu saling menunjuk lewat `counter_item_id`.

**Dua sisi uang muka memang tidak sama nilainya.** `AdvanceUsed` hanya DPP,
sedangkan `AdvanceApplied` DPP + PPN. Selisihnya adalah PPN uang muka, yang tidak
pernah ada di item Uang Muka. PPN yang dipakai dihitung ulang dengan
`advancePpnUsed` di `sales-tax.ts`, bukan dibaca dari item.

---

## 5. Aturan yang dijaga saat menulis

| Aturan | Akibat bila dilanggar |
| --- | --- |
| Baris item dikunci (`FOR UPDATE`) sebelum saldonya diubah | dua Posting bersamaan tidak saling menimpa |
| Saldo tidak boleh di bawah nol | `ArItemOverdrawn`, seluruh Posting batal |
| `paid_amount` Uang Muka tidak boleh melebihi total tagihan | *Pembayaran melebihi sisa …*, seluruh Posting batal |
| Item Invoice **selalu** dibuat, walau uang muka menutup seluruhnya | item lahir lalu saldonya 0 di Posting yang sama |
| Invoice hanya memakai uang muka dari Customer Order yang sama | diperiksa lewat `scope_*` |

Kasus khusus: pembayaran sangat kecil bisa punya bagian DPP 0 (seluruhnya masuk
bagian PPN). Bila itu pembayaran pertama, item tetap lahir dengan saldo 0 dan
`paid_amount` terisi. Bila pembayaran berikutnya, `paid_amount` naik tetapi tidak
ada baris ledger, karena saldo tidak bergerak.

---

## 6. Contoh lengkap

Customer Order Exclude: DPP 10.000.000, PPN 1.100.000, Total 11.100.000.
Tagihan uang muka 30 % `ARA/2026/11/0001`: DPP 3.000.000, PPN 330.000,
Total 3.330.000. Tanpa PPh.

| Tanggal | Dokumen | Kejadian |
| --- | --- | --- |
| 02/11 | `BKM/2026/11/0001` | terima 1.000.000 untuk uang muka (DPP 900.901, PPN 99.099) |
| 05/11 | `BKM/2026/11/0002` | terima 2.330.000 untuk uang muka (DPP 2.099.099, PPN 230.901) |
| 20/11 | `INV/2026/11/0001` | Invoice penuh, bruto 11.100.000, memakai DPP uang muka 3.000.000 + PPN 330.000; yang masih ditagih 7.770.000 |
| 01/12 | `BKM/2026/12/0001` | terima 5.000.000 untuk Invoice |
| 15/12 | `BKM/2026/12/0002` | terima 2.770.000 untuk Invoice |

### `fin_ar_ledger` di akhir contoh

| `ledger_no` | `line_no` | Item | `event` | Tanggal | `movement` | `doc_no` | `counter_item_id` |
| --- | --- | --- | --- | --- | ---: | --- | --- |
| `BP/2026/11/0001` | 1 | Uang Muka | `Create` | 02/11 | +900.901 | `BKM/2026/11/0001` | |
| `BP/2026/11/0002` | 1 | Uang Muka | `AdvanceReceived` | 05/11 | +2.099.099 | `BKM/2026/11/0002` | |
| `BP/2026/11/0003` | 1 | Invoice | `Create` | 20/11 | +11.100.000 | `INV/2026/11/0001` | |
| `BP/2026/11/0003` | 2 | Uang Muka | `AdvanceUsed` | 20/11 | −3.000.000 | `INV/2026/11/0001` | item Invoice |
| `BP/2026/11/0003` | 3 | Invoice | `AdvanceApplied` | 20/11 | −3.330.000 | `INV/2026/11/0001` | item Uang Muka |
| `BP/2026/12/0001` | 1 | Invoice | `Payment` | 01/12 | −5.000.000 | `BKM/2026/12/0001` | |
| `BP/2026/12/0002` | 1 | Invoice | `Payment` | 15/12 | −2.770.000 | `BKM/2026/12/0002` | |

### `fin_ar_item` setelah setiap langkah

Item Uang Muka `ARI/2026/11/0001` (`source_no` `ARA/2026/11/0001`, `item_date`
02/11, tanpa `due_date`):

| Setelah | `current_balance` | `original_amount` | `paid_amount` |
| --- | ---: | ---: | ---: |
| Penerimaan 02/11 | 900.901 | 900.901 | 1.000.000 |
| Penerimaan 05/11 | 3.000.000 | 3.000.000 | 3.330.000 |
| Invoice 20/11 | 0 | 3.000.000 | 3.330.000 |

Item Invoice `ARI/2026/11/0002` (`source_no` `INV/2026/11/0001`, `item_date`
20/11, `due_date` 20/12):

| Setelah | `current_balance` | `original_amount` | `paid_amount` |
| --- | ---: | ---: | ---: |
| Invoice 20/11 | 7.770.000 | 11.100.000 | 0 |
| Penerimaan 01/12 | 2.770.000 | 11.100.000 | 5.000.000 |
| Penerimaan 15/12 | 0 | 11.100.000 | 7.770.000 |

Baris Invoice 20/11 sudah merangkum `Create` dan `AdvanceApplied`:
11.100.000 − 3.330.000 = 7.770.000.

---

## 7. Variasi

**Invoice tanpa uang muka.** Satu baris `Create` saja. `current_balance` =
`original_amount` = nilai Invoice.

**Uang muka hanya dipakai sebagian.** Saldo item Uang Muka berkurang sebesar DPP
yang dipakai dan sisanya tetap terbuka untuk Invoice berikutnya dari Customer
Order yang sama.

**Invoice memakai dua uang muka.** Satu `Create`, lalu dua pasang `AdvanceUsed`
dan `AdvanceApplied`, semuanya di satu `ledger_no`.

**Satu Penerimaan membayar uang muka dan Invoice sekaligus.** Satu `ledger_no`,
tiap dokumen satu baris. Item Uang Muka naik, item Invoice turun.

**Dengan PPh.** Item Invoice turun sebesar Dilunasi, yaitu uang + PPh. Item Uang
Muka naik sebesar bagian DPP, sedangkan `paid_amount`-nya naik sebesar uang + PPh.
PPh tidak disimpan di item; tempatnya di `fin_cash_bank_tx_line_wht`.

---

## 8. Cek setelah diisi

Saldo item sama dengan jumlah ledger-nya (harus kosong):

```sql
SELECT i.ar_item_no, i.current_balance, SUM(l.movement) AS ledger
FROM fin_ar_item i
JOIN fin_ar_ledger l ON l.item_id = i.id
GROUP BY i.id
HAVING i.current_balance <> SUM(l.movement);
```

`original_amount` Uang Muka sama dengan total uang muka yang masuk (harus kosong):

```sql
SELECT i.ar_item_no, i.original_amount
FROM fin_ar_item i
JOIN fin_ar_ledger l ON l.item_id = i.id
WHERE i.item_type = 'Advance' AND l.event IN ('Create', 'AdvanceReceived')
GROUP BY i.id
HAVING i.original_amount <> SUM(l.movement);
```

Ke General Ledger:

| Item | Harus sama dengan saldo account |
| --- | --- |
| Σ `current_balance` Invoice per customer | Piutang Usaha |
| Σ `current_balance` Uang Muka per customer | Uang Muka Penjualan |

Pemeriksaan lengkapnya ada di `npm run db:reconcile`.
