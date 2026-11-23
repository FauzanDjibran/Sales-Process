# Produksi 08 — Push, BSTB, Penyebaran, partai dan checkpoint

Memindahkan barang **Stand By** ke Unit berikutnya. Satu dokumen, tiga jenis.

| Jenis | `prd_transfer.kind` | Kapan | Nomor | Terima? |
| --- | --- | --- | --- | --- |
| Dokumen Push | `Push` | Workstation sama | `PSH_<asal>_…` | tidak, langsung masuk |
| BSTB Transfer | `Bstb` | Workstation beda | `BST_<tujuan>_…` | ya |
| BSTB Penyebaran | `BstbPartai` | akhir segmen sebelum partai | `BST_<tujuan>_…` | ya, **partai lahir** |

Jenisnya **dihitung**, bukan dipilih. Tidak ada Draft, tidak ada jurnal.

## Kode acuan

`production-transfer.ts` → `check`, `sendTransfer`, `receiveTransfer`; buku
`transferBucket`, `sendInTransit`, `formPartai`, `issueJob`.

---

## 1. Cara pakai

| Langkah | Di mana |
| --- | --- |
| Kirim | Workspace › Unit asal › tab **Stand By** › **Kirim** atau klik baris |
| Pilih barang | baris input; Job utuh, No. Stok tanpa Job boleh sebagian; *Ambil Semua* satu partai |
| Tujuan | otomatis dari routing; di akhir segmen pilih **Line** |
| Terima (BSTB) | Workspace › Unit tujuan › tab **Penerimaan** › Terima |

Izin `PRODUCTION_TRANSFER_VIEW / _CREATE / _RECEIVE`. Kirim memeriksa Unit asal,
Terima memeriksa Unit tujuan. **BSTB yang sudah diajukan tidak bisa dibatalkan.**

---

## 2. Sumber data

| Data | Sumber |
| --- | --- |
| Barang | `prd_balance` Unit asal, `stage = StandBy`, bukan penolong |
| Routing | partai barang; bila kosong, segmen sebelum partai |
| Unit tujuan | `prd_routing_step` sesudah Unit asal |
| Jenis | `workstation_id` kedua Unit |
| Line (Penyebaran) | routing line aktif yang Unit pertamanya = tujuan |

---

## 3. Tabel

`prd_transfer`:

| Kolom | Isi |
| --- | --- |
| `transfer_no`, `kind`, `transfer_date` | |
| `from_unit_id`, `to_unit_id` | |
| `partai_id` | partai barang; Penyebaran: terisi **saat Terima** |
| `line_id`, `routing_id` | hanya Penyebaran: line dan routing partai baru |
| `status` | Push langsung `Posted`; BSTB `Submitted` → `Posted` |
| `received_at`, `received_by` | Push: saat kirim; BSTB: saat Terima (hari itu) |

`prd_transfer_line`:

| Kolom | Isi |
| --- | --- |
| `from_bucket_id`, `tracking_id` | bucket Stand By, No. Stok |
| `job_id` | Job yang dibawa, atau yang baru dibuat |
| `is_new_job` | Job dibuat oleh kiriman ini |
| `qty`, `grams` | jumlah, gram |
| `value` | nilai yang pindah |
| `transit_bucket_id` | bucket Dalam Perjalanan (BSTB) |
| `to_bucket_id` | bucket Persiapan tujuan (Push: saat kirim; BSTB: saat Terima) |

---

## 4. Yang terjadi

### 4.1 Push

```
tiap baris:
  tanpa Job → issueJob di Unit ASAL
  transferBucket  Stand By asal → Persiapan proses pertama tujuan, nilai sama
status Posted
```

Contoh `PSH_UGH_231126_00001`:

| Barang | Dari | Ke | Job baru | Nilai |
| --- | --- | --- | --- | ---: |
| `LOTA-1` | B9 UGH Stand By | B16 UPC Persiapan Assign | `UGH_231126_00003` | 41.869 |
| `LOTA-2-1` | B14 | B17 | `UGH_231126_00004` | 18.901 |
| `LOTB-1` | B12 | B18 | `UGH_231126_00005` | 40.400 |

Kode `UGH` pada Job menunjukkan **Unit pengirim**.

### 4.2 BSTB

```
Kirim : Stand By → Dalam Perjalanan (masih di Unit ASAL)        status Submitted
Terima: Dalam Perjalanan → Persiapan proses pertama tujuan       status Posted
```

Contoh `BST_UDA_231126_00001` (USR → UDA), satu baris, empat baris ledger:

| Langkah | `movement` | Bucket | Unit, tahap | Nilai |
| --- | --- | --- | --- | ---: |
| Kirim | TransferOut | B64 | USR Stand By | −44.351 |
| Kirim | TransferIn | B67 | USR **Dalam Perjalanan** | +44.351 |
| Terima | TransferOut | B67 | USR Dalam Perjalanan | −44.351 |
| Terima | TransferIn | B70 | UDA Persiapan Grading | +44.351 |

Selama Dalam Perjalanan barang tercatat **milik Unit asal**, dan
`prd_balance.transit_doc_*` menyebut dokumennya.

### 4.3 BSTB Penyebaran

Sama seperti BSTB, ditambah saat **Terima**:

```
formPartai:  prd_partai baru  (line, routing, versi Standard Cost Active hari itu)
semua barang dokumen → partai_id = partai baru
prd_transfer.partai_id = partai baru
tanpa No. Job baru
```

Contoh `BST_UPW_231126_00001`: tiga No. Stok (93 g, Rp 102.914) menjadi partai
`P_231126_00001`, line Reguler, routing REG-1. Versi Standard Cost partai itu dipakai
sampai akhir, walau versi aktif berganti.

**Sebelum** Terima tarif mengikuti No. Stok; **sesudahnya** mengikuti partai.

---

## 5. Aturan No. Job

| Keadaan | Hasil |
| --- | --- |
| barang punya Job | Job sama diteruskan |
| tanpa Job, tujuan biasa | Job baru per ambilan |
| Penyebaran | tanpa Job |
| tujuan punya proses Assembly (UP5) | tanpa Job |

Dalam cerita, UBC → UP5 tidak memberi Job, jadi 18 keping masuk UP5 tanpa No. Job.

---

## 6. Checkpoint

Unit dengan `is_checkpoint` (UDA dan UBC) hanya boleh mengirim **seluruh isi partai
dalam satu dokumen**:

```
partaiHoldings(partai) = semua bucket partai itu di mana pun
semuanya harus: di Unit ini, Stand By, dan ikut seluruhnya
kalau tidak → "UDA adalah checkpoint: seluruh isi partai dikirim bersama. Masih ada …"
```

Barang partai yang sudah keluar produksi (BSTB Pengeluaran diterima) tidak lagi
dihitung. Yang masih Dalam Perjalanan **masih dihitung**.

**Satu dokumen satu partai**, kecuali sesudah checkpoint **terakhir** routing.

---

## 7. Validasi utama

| Aturan | Pesan |
| --- | --- |
| Barang masih Stand By | *Barang ini tidak lagi di Stand By unit ini.* |
| Job utuh | *No. Job … dikirim utuh: … belum ikut.* |
| Tujuan = Unit berikutnya | *Tujuan harus Unit berikutnya pada routing barang ini.* |
| Penyebaran butuh Line | *Pilih Line yang diikuti partai baru.* |
| Hanya barang sebelum partai membentuk partai | *Hanya barang sebelum partai yang membentuk partai baru.* |
| Unit terakhir routing | *… adalah Unit terakhir routing …* → pakai BSTB ke Finish Goods |
| Standard Cost aktif ada (saat Terima Penyebaran) | *Belum ada Standard Cost aktif.* |

---

## 8. Cek

Tiap dokumen: Σ `qty_change` dan Σ `value_change` baris `TransferOut` + `TransferIn`
= **0**.
