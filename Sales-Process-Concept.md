# Sales Process — Customer Order to Piutang

The single, current concept document for developers: **Customer Order → Sales
Order → Uang Muka Penjualan → Penerimaan Kas & Bank → AR items (Buku Piutang)**,
with the Faktur Penjualan where it touches them. It covers flow, table logic in
DBML and how to use the tables, with no program code. Every later change to
the concept is made **here**.

Sources: decisions P49–P86 in `Claude-ERP.md` §12, `tax_concept.md`,
`knowledge/ar_ap_open_item_concept.md`,
`knowledge/multi_currency_concept.md`, and the concept updates in section
14 that are not yet in `Claude-ERP.md`.

**Status labels used throughout**

| Label | Meaning |
| --- | --- |
| **[Built]** | Running in the application today |
| **[Agreed, not built]** | Decided with the user, the application not changed yet |
| **[Planned]** | Comes with a later document (Faktur, Pajak menu, …); shape known, details may change |

---

## Contents

1. The process in one picture
2. Documents and records
3. Rules shared by every document
4. Customer Order
5. Sales Order and Delivery Order
6. Uang Muka Penjualan (the advance bill)
7. Penerimaan Kas & Bank (the receipt)
8. AR items and Buku Piutang
9. Faktur Penjualan (where it touches the above)
10. Multi-currency
11. End-to-end worked example
12. Reports
13. Not built yet, and open points
14. Concept updates not yet in `Claude-ERP.md`
15. Appendix — full DBML and notation

---

## 1. The process in one picture

```
                        ┌──────────────► Sales Order SO/…  (quantity + Tanggal Kirim, to PPIC)
                        │                 posts nothing
                        │                       │ Open lines picked by
                        │                       ▼
                        │                Delivery Order DO/…  (one warehouse, one address)
                        │                 posts nothing
                        │                       │ [Planned] leaves on
                        │                       ▼
                        │                Delivery Note  ── posts HPP / Persediaan (placeholder)
                        │
Customer Order CO/… ────┤
(the commercial         │
 agreement: qty,        └──────────────► Uang Muka Penjualan ARA/…  (the bill: asks for money)
 price, PPN, PPh)                          posts nothing
 posts nothing                                   │ paid by
                                                 ▼
                                    Penerimaan Kas & Bank BKM/…  ── posts: journal + Cash Bank Book
                                                 │ creates
                                                 ▼
                                    AR item ARI/… (Uang Muka)  ── Buku Piutang
                                                 │ used by
                                                 ▼
                         [Planned] Faktur Penjualan  ── posts: journal; creates AR item (Invoice)
                                                 │ paid by
                                                 ▼
                         [Planned] Penerimaan Kas & Bank  ── moves the Invoice item to 0
```

Three lanes, never mixed:

| Lane | Documents | Touches the books? |
| --- | --- | --- |
| **Commercial** | Customer Order, Sales Order, Delivery Order, advance bill | No. They are agreements, instructions and requests |
| **Money** | Penerimaan Kas & Bank | Yes: journal + Cash Bank Book |
| **Position** | AR items, Buku Piutang | It is a book itself; written only by the money lane and the Faktur |

---

## 2. Documents and records

| Record | Number | Menu | Tables | Posts a journal? | Holds a balance? | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Customer Order | `CO/YYYY/MM/NNNN` | Sales › Customer Order | `sal_customer_order`, `_line` | No | No | [Built] |
| Sales Order | `SO/YYYY/MM/NNNN` | Sales › Sales Order | `sal_order`, `_line` | No | No | [Built] |
| Delivery Order | `DO/YYYY/MM/NNNN` | Sales › Delivery Order | `sal_delivery_order`, `_line` | No | No | [Built] |
| Delivery Note | `SJ/YYYY/MM/NNNN` | Persediaan › Delivery Note (standalone, purpose `sales_delivery`, P106) | `log_delivery_note`, `_line`, `_lot` | HPP / Persediaan | No | [Built] (P94, P106) |
| Harga Pokok (Sementara), Lot (Sementara) | — | Master › Sementara | `tmp_item_cost`, `tmp_stock_lot`, `tmp_stock_movement` (temporary) | No | No | [Built] stand-in (U11, U15) |
| Uang Muka Penjualan (bill) | `ARA/YYYY/MM/NNNN` | Finance › Uang Muka | `fin_ar_advance` (was `sal_advance`, P107) | No | No | [Built] |
| Penerimaan Kas & Bank | `BKM/YYYY/MM/NNNN` | Finance › Kas & Bank › Penerimaan | `fin_cash_bank_tx`, `_line`, `_line_wht` | Yes, at Post | No | [Built] |
| AR item + Buku Piutang | `ARI/YYYY/MM/NNNN` | (no menu; seen in reports) | `fin_ar_item`, `fin_ar_ledger` | Never | **Yes** | [Built] (revised shape U1, U9: P96) |
| Invoice Penjualan | `INV/…` | Finance › Invoice (P107) | `fin_ar_invoice(_line, _advance_deduction)` (was `sal_invoice…`) | Yes | Invoice item | [Built] (§9, P97, P107) |

---

## 3. Rules shared by every document

| # | Rule |
| --- | --- |
| 3.1 | **Numbering** `PREFIX/YYYY/MM/NNNN`, a series per prefix per month, taken at first save. Re-dating a Draft into another month does not renumber it. |
| 3.2 | **Draft writes nothing** to any book, journal or tax record. |
| 3.3 | **Post is one database transaction**: journal, Cash Bank Book and AR items are written together or not at all. |
| 3.4 | **A posted document is permanent**: no edit, delete or reversal. A correction is a new document. |
| 3.5 | **A non-transaction document posts no journal**: Customer Order, Sales Order, advance bill, tax records. |
| 3.6 | **Final steps carry a reason** (Batalkan, Tolak, Tutup), stored on the document. |
| 3.7 | **Tax arithmetic** lives in one module and rounds **half up to whole rupiah**: DPP Nilai Lain = round(DPP × 11/12), PPN = round(12 % × DPP Nilai Lain), PPh = round(base × rate). PPN is computed **per line**, the document is the sum of its lines. An inclusive price absorbs the rounding in the DPP (the total may be one rupiah under the typed price). |
| 3.8 | **PPN rate and the 11/12 factor are system settings** (Pengaturan › Sistem). Each document **snapshots** them when saved and freezes them at its lock step (Ajukan / Terbitkan). |
| 3.9 | **Links**: master data (partner, item, unit, bank, Jenis PPh) by hard foreign key. A document of **another module** by the weak pair *document type + id* (+ number as text), so modules don't depend on each other. Within one module (CO → SO) hard keys are fine. |
| 3.10 | **Every write is audited**, every lifecycle step names its event. |
| 3.11 | **Consequences before commitment**: every lifecycle step is confirmed in a dialog stating what will happen (for Post, the journal lines). |
| 3.12 | **Stock is ignored** for now: no stock check, no warehouse movement. |
| 3.13 | **Rupiah only** for sales documents for now (section 10 for later). |

---

## 4. Customer Order  [Built]

### 4.1 What it is

The **commercial agreement** with the customer: what is sold, how many, at what
price, under which tax treatment. It is **the basis of every financial
document**: the advance bill and, later, the Faktur are drawn from it, and AR
items name it. Barang only (items of Tipe Barang marked Dapat Dijual). It posts
nothing.

### 4.2 What the user fills in

| Section | Fields | Rules |
| --- | --- | --- |
| Customer | Customer, Alamat | Customer must be active, have complete tax data and at least one address. Any of the customer's addresses may be chosen; an address used by a document cannot be removed from the Partner |
| Pesanan | Tanggal, No. PO, Tanggal PO, Termin, Salesperson (free text), Catatan | Termin defaults from the customer's *Termin Pembayaran Default* |
| Harga & Pajak | Kena PPN (Ya / Tidak), Mode Harga (Include / Exclude PPN) | Mode Harga asked only when Kena PPN; it defaults from the customer's *Mode Harga Default*. A non-taxable order is stored Exclude |
| Lines | Item, Satuan, Qty, Harga Satuan, Diskon (% or Nominal), Jenis PPh | Each item once per order. Satuan is the base unit or one of the item's conversions; its factor is stored. Empty discount = no discount. Jenis PPh empty = *Tanpa PPh* |

### 4.3 What the system computes

| Per line | Rule |
| --- | --- |
| Gross | Qty × Harga |
| Diskon | % of gross, or the Nominal typed |
| Amount | Gross − Diskon (must stay above zero; % discount below 100) |
| DPP | Amount (Exclude), or the inclusive split of Amount (Include), or Amount (not Kena PPN) |
| DPP Nilai Lain, PPN | By the chain of 3.7; zero when not Kena PPN |

| Per order | Rule |
| --- | --- |
| Gross, Diskon, DPP, DPP Nilai Lain, PPN | Sums of the lines |
| Total | DPP + PPN |
| PPh estimate (shown, not stored) | Per Jenis PPh: round(Σ DPP of the lines carrying it × rate) |
| *Estimasi Penerimaan* (shown, not stored) | Total − PPh estimate. Information only, in its own box |

### 4.4 Lifecycle

```
Draft ──Ajukan──► Diajukan ──Setujui──► Open ──Tutup Pesanan (reason)──► Ditutup
  │                  └──Tolak (reason)──► Ditolak   (final)
  └──Batalkan (reason)──► Dibatalkan               (final)
```

| Step | Permission | Effect |
| --- | --- | --- |
| Save | `CUSTOMER_ORDER_CREATE` / `_EDIT` | Draft is editable; figures recomputed and PPN snapshot refreshed |
| Ajukan | `CUSTOMER_ORDER_SUBMIT` | Locks the order, freezes figures and snapshot. Not taken back |
| Setujui / Tolak | `CUSTOMER_ORDER_APPROVE` | Whoever holds it may approve, own orders included |
| Batalkan | `CUSTOMER_ORDER_CANCEL` | Draft only |
| Tutup Pesanan | `CUSTOMER_ORDER_CLOSE` | Open only. **Refused while a Sales Order drawn from it is Draft, Diajukan, Pra-SO or Open.** Allowed with an issued advance bill |
| Salin | `CUSTOMER_ORDER_CREATE` | Copies into a new Draft (`copied_from_id`); how a rejected order is re-entered |

What an **Open** order allows: Sales Orders, advance bills, later the Faktur.
A **Closed** order takes no new Sales Order and no new bill.

### 4.5 Tables

`sal_customer_order`: one row per order.

| Column | Meaning |
| --- | --- |
| order_no, order_date, status | Number, date, status |
| customer_id, address_id, term_id | Customer, the chosen address, Termin |
| is_taxable, price_mode | Kena PPN, Include / Exclude |
| ppn_rate, ppn_dpp_other_numerator / _denominator | PPN snapshot (null when not Kena PPN) |
| po_no, po_date, salesperson, note | Free information |
| gross_amount, discount_amount, dpp_amount, dpp_other_amount, ppn_amount, total_amount | Order figures = sums of the lines |
| status_reason | Reason of Batalkan / Tolak / Tutup |
| copied_from_id | The order it was copied from (Salin) |

`sal_customer_order_line`: one row per item.

| Column | Meaning |
| --- | --- |
| order_id, line_no | Which order, position |
| item_id, uom_id, uom_factor | Item, unit, the unit's factor to the base unit at the time |
| qty, price | Quantity in that unit, unit price |
| discount_type, discount_value, discount_amount | % / Nominal, as typed, in rupiah |
| amount | Gross − discount |
| dpp_amount, dpp_other_amount, ppn_amount | The line's tax figures (stored, not shown as columns on screen) |
| withholding_tax_id, withholding_rate | Jenis PPh and its rate at the time (null = Tanpa PPh) |

### 4.6 How to use

| Need | How |
| --- | --- |
| Value an advance is drawn from | `total_amount` when Kena PPN and Include, else `dpp_amount` |
| PPh a line carries | `withholding_tax_id` + `withholding_rate` on the line |
| Quantity in base unit | `qty × uom_factor` |
| Can it close? | No Sales Order on it in Draft / Submitted / PreSO / Open |
| Check | Order figures = Σ line figures; `total_amount` = `dpp_amount` + `ppn_amount` |

---

## 5. Sales Order and Delivery Order  [Built]

### 5.1 What it is

A **dated part of one Customer Order, released to PPIC**. A Customer Order of
10.000 PCS delivered over five months becomes five Sales Orders of 2.000, each
with its own **Tanggal Kirim**. Quantity only: **no price, no tax, posts
nothing, never an AR item**. It is the basis for material purchasing and,
later, production.

### 5.2 What the user fills in

| Field | Rules |
| --- | --- |
| Customer Order | Must be **Open**; chosen once, then locked. Customer follows from it |
| Tanggal, Tanggal Kirim, Catatan | Tanggal Kirim is what PPIC plans to |
| Alamat Kirim | Any of the customer's addresses; starts on the Customer Order's |
| Lines | Picked with **Tambah Item**: a dialog lists the Customer Order's lines with *Qty CO*, *Sudah di-SO* and *Sisa*; a line with nothing left is shown but not pickable. Terapkan adds the ticked lines; an unticked line leaves |
| Line quantity | In the Customer Order line's unit, shown `2.000 PCS`, with the ceiling as a hint. **Blank is refused** (every line was picked on purpose). Each Customer Order line once per Sales Order |

### 5.3 The quantity ceiling

For every Customer Order line:
**Σ qty of its Sales Orders (every status except Dibatalkan and Ditolak —
Ditutup included) ≤ the line's qty.** Checked at save and at Ajukan, with the
Customer Order's row locked so two Sales Orders can't both take the last of it.
Batalkan and Tolak give the quantity back.

### 5.4 Lifecycle

```
Draft ──Ajukan──► Diajukan ──Setujui──► Pra-SO ──Konfirmasi──► Open
  │                  └──Tolak (reason)──► Ditolak (final)        │
  └──Batalkan (reason)──► Dibatalkan (final)                     │
                      Pra-SO or Open ──Tutup (reason)──► Ditutup ◄┘
```

| Step | Permission | Meaning |
| --- | --- | --- |
| Ajukan | `SALES_ORDER_SUBMIT` | Locks it |
| Setujui / Tolak | `SALES_ORDER_APPROVE` | Approval |
| Pra-SO | — | May be used to **buy material**, not to produce |
| Konfirmasi | `SALES_ORDER_CONFIRM` | Moves it to **Open**: may also be **produced** |
| Batalkan | `SALES_ORDER_CANCEL` | Draft only |
| Tutup | `SALES_ORDER_CLOSE` | From Pra-SO or Open |

Purchasing and production are not built, so Pra-SO and Open differ only in
name for now.

### 5.5 Tables

`sal_order`: order_no, order_date, **delivery_date**, status,
customer_order_id (hard link, same module), customer_id (for the list),
address_id, note, status_reason.

`sal_order_line`: order_id, line_no, **customer_order_line_id** (its item and
unit are read there), qty, note. Unique (order, line_no) and (order, Customer
Order line).

### 5.6 How to use

| Need | How |
| --- | --- |
| *Sudah di-SO* of a Customer Order line | Σ qty of `sal_order_line` on that line whose order is not Cancelled / Rejected |
| *Sisa* | Line qty − Sudah di-SO |
| Delivery schedule of a Customer Order | Its Sales Orders by `delivery_date`, with their lines |
| Check | Sudah di-SO ≤ line qty for every Customer Order line |
| Can it be closed? | Not while a Delivery Order drawing on it is Draft or Diterbitkan |

### 5.7 Delivery Order — the warehouse instruction  [Built] (P93)

The instruction to **one warehouse** to send goods of **one Customer Order**
to **one address** on **one date**. Its header names the Customer Order; each
line is a quantity of one line of that order's **Open** Sales Orders, so one
Delivery Order may ship from several Sales Orders of the same Customer Order.
Quantity only, **posts nothing** (no journal, no stock movement). The goods
actually leave on the **Delivery Note** [Planned], which will post HPP /
Persediaan at a placeholder cost.

| Field | Rules |
| --- | --- |
| Customer Order | **Open**, with at least one **Open** Sales Order; chosen once, then locked |
| Tanggal DO, Tanggal Kirim | Tanggal DO not before the Customer Order; Tanggal Kirim not before Tanggal DO, and starts on the first Sales Order picked |
| Gudang | One active warehouse — the goods leave from it |
| Alamat Kirim | Any of the customer's addresses; starts on the first Sales Order picked |
| Lines | Picked with **Tambah Item**: a dialog lists the Open Sales Orders' lines with Sales Order, due date, *Qty SO*, *Sudah di-DO* and *Sisa*. Each Sales Order line once per Delivery Order; **blank quantity refused** |

**Quantity ceiling.** For every Sales Order line: **Σ qty of its Delivery
Orders (every status except Dibatalkan — Ditutup included) ≤ the line's qty.**
Checked at save and at Terbitkan, with the Customer Order's row locked.

**Lifecycle — no approval:**

```
Draft ──Terbitkan──► Diterbitkan ──Tutup (reason)──► Ditutup
  └──Batalkan (reason)──► Dibatalkan (final, gives the quantity back)
```

| Step | Permission | Meaning |
| --- | --- | --- |
| Terbitkan | `DELIVERY_ORDER_ISSUE` | Locks it and sends it to the warehouse; rechecks the ceiling, the Sales Orders still Open and the warehouse still active |
| Batalkan | `DELIVERY_ORDER_CANCEL` | Draft only |
| Tutup | `DELIVERY_ORDER_CLOSE` | From Diterbitkan; the Delivery Notes will close it themselves once everything has left |

**Tables.** `sal_delivery_order`: do_no, do_date, delivery_date, status,
customer_order_id, customer_id (for the list), **warehouse_id**, address_id,
note, status_reason. `sal_delivery_order_line`: delivery_order_id, line_no,
**sales_order_line_id** (item and unit read through the Sales Order line from
the Customer Order line), qty, note. Unique (order, line_no) and (order, Sales
Order line).

| Need | How |
| --- | --- |
| *Sudah di-DO* of a Sales Order line | Σ qty of `sal_delivery_order_line` on that line whose order is not Cancelled |
| What a Sales Order has instructed | Its page's *Perintah Kirim* card: per line Qty SO / Di-DO / Sisa, and the Delivery Orders |
| Check | Sudah di-DO ≤ Sales Order line qty for every Sales Order line |

---

### 5.8 Delivery Note — the goods leave  [Built] (P94, P95, P106; C28, U11–U15)

> **Standalone since P106.** The Delivery Note is a logistics document, not a
> sales one: `log_delivery_note(_line, _lot)`, menu Logistik (Persediaan since P131). Its purpose
> `sales_delivery` is what this section describes; it names its Delivery Order by
> the weak pair `source_doc_type_id` / `source_doc_id`, each line its Delivery
> Order line by `source_doc_line_id`, and each line carries its own item, unit
> and factor. Older column names below (`delivery_order_id`, `customer_order_id`,
> `_pick`) read as those.

The document the goods **actually leave on**. It is made from **one issued
Delivery Order**, takes items out of the Delivery Order's warehouse, and is the
only sales document before the Faktur that **posts**: it recognises **HPP
(cost of goods sold) and nothing else** — no Piutang, no revenue, no PPN.
Piutang is born at the Faktur (P71).

**Stock in this cycle — a stand-in inventory module (U11).** No real stock
yet (P5), but the Delivery Note must behave as it will with real stock. So it
asks an **inventory module** to issue goods, exactly as it later will, and is
never aware that the module is a stand-in:

```
Delivery Note posting ──issue(item, warehouse, base qty, date, document)──► inventory module
                       ◄──────────── unit cost, cost ─────────────────────┘
```

Today the inventory module is backed by **temporary tables** of its own,
clearly marked temporary and never named by any sales module:

| Temporary table | Holds | Behaviour |
| --- | --- | --- |
| `tmp_item_cost` | One **Harga Pokok** per item (per base unit), kept by the user in a small menu *Harga Pokok (Sementara)* | The valuation every issue uses; stock is always sufficient |
| `tmp_stock_movement` | One row per item per issue: item, warehouse, date, base qty out, unit cost, cost, source document | What a stock card would show — a real inventory ledger replaces it |

An item with no Harga Pokok cannot be issued, so the Delivery Note refuses to
post and names it. When real inventory is built, the module keeps its
`issue(...)` contract and the temporary tables are dropped; the Delivery Note
does not change. `m_item` gets no cost column.

**Why its line is the unit of billing.** The Faktur Penjualan will be made by
taking Delivery Note lines **whole** — never part of a line. So one Delivery
Note line is exactly one billable quantity: it traces to one Delivery Order
line → one Sales Order line → one Customer Order line, where its price, discount,
PPN and Jenis PPh live. A line is billed once, by one Faktur; a Delivery Note's
lines may go to different Fakturs.

```
CO line (price, PPN, PPh) ◄── SO line ◄── DO line ◄── DN line  ──whole──►  Faktur line
                                                      posts HPP           posts Piutang / Penjualan / PPN
```

**What the user fills in**

| Field | Rules |
| --- | --- |
| Delivery Order | An **issued** one with something left to send; chosen once, then locked. Customer Order, customer, Gudang and Alamat Kirim follow from it, read-only |
| Tanggal Kirim | The day the goods leave — also the PPN tax point the Faktur will carry (§10.2 rule 6); not before the Delivery Order's date |
| No. Kendaraan, Pengemudi, Catatan | Free text, printed on the note |
| Lines | Picked with **Tambah Item** from the Delivery Order's lines: *Qty DO*, *Sudah Dikirim*, *Sisa*. Each Delivery Order line once per note; blank refused |
| Lot (U15) | For a Barang with Kelola Stok: **Pilih Lot** opens the item's lots in the note's warehouse, earliest expiry first, each with the quantity taken from it; *Isi FEFO* puts the rest on the earliest. A Draft may be picked in part; Posting needs the line picked in full. Any other item takes no lot |

**Stock picking (U15).** The goods leave **by lot**: a line of a Barang with
Kelola Stok holds its **picks** (`sal_delivery_note_pick`: lot, quantity, and
the lot number and expiry copied as printed), together never more than the
line and, to post, exactly it. The lots come from the inventory module — today
a stand-in lot list (`tmp_stock_lot`: lot number and expiry per item and
warehouse, no quantity, kept in *Lot (Sementara)*), offered earliest expiry
first; a lot is named by id without a foreign key so real stock can replace
the list. An inactive lot is no longer offered, and a Draft that picked it
does not post until it is changed. At Posting **each pick is issued on its
own** — one stock movement per lot — and stores its cost; the line's cost is
the sum of its picks'. The Faktur still takes the line whole; the lots stay on
the note, where a recall or a customer's complaint traces them.

**Quantity ceiling.** For every Delivery Order line: **Σ qty of its Delivery
Notes (Draft and Posted; not Dibatalkan) ≤ the line's qty.** Checked at save and
at Posting with the Customer Order's row locked. A Delivery Order may be sent
in several notes.

**Lifecycle**

```
Draft ──Posting──► Posted (final; corrected later by a return, never edited)
  └──Batalkan (reason)──► Dibatalkan (final, gives the quantity back)
```

**What Posting writes (one transaction)**

1. Locks the Customer Order, rechecks the ceiling and that the Delivery Order
   is still Diterbitkan.
2. Per line: base qty = qty × the Customer Order line's unit factor; the
   inventory module **issues** it from the note's warehouse and returns the
   **unit cost** and **cost** (whole rupiah), stored on the line (snapshot).
   A picked line is issued pick by pick, each from its lot, and each pick
   stores its own cost (U15); posting refuses a lot-kept line not fully
   picked, and the confirmation says so before the button.
3. **Journal**, dated Tanggal Kirim: Dr **HPP** / Cr **Persediaan**, one pair per
   line, describing item, quantity and cost. Both accounts come from **Account
   Mapping** (two new entries, *HPP* and *Persediaan*); the per-Kategori Item
   mapping (C25) replaces them later (U12).
4. Status Posted; posted quantity now counts as **delivered**.
5. If every line of the Delivery Order is fully delivered, the Delivery Order
   closes itself (fulfilled, no reason); likewise each Sales Order whose lines
   are all fully delivered.

**Delivered quantity is stored on the order lines** (`delivered_qty` on Sales
Order and Delivery Order lines), written by Posting through each module's own
function — a module never reads the Delivery Note's tables, so the order line
carries "qty delivered" as mainstream ERPs do. It is what the closing rule
below reads.

**After posting** — shown, never stored: per line **Belum Ditagih / Ditagih**,
per note **Belum Ditagih / Sebagian / Ditagih**, read from the Faktur lines that
took it (when the Faktur exists).

**Tables (proposed)**

`sal_delivery_note`: dn_no, dn_date, status, delivery_order_id,
customer_order_id, customer_id, warehouse_id, address_id (copied from the
Delivery Order for lists and printing), vehicle_no, driver_name, note,
journal_id, cost_amount (Σ lines), cancel_reason.

`sal_delivery_note_line`: delivery_note_id, line_no,
**delivery_order_line_id**, qty (in the Customer Order line's unit),
**base_qty**, **unit_cost**, **cost_amount**, note. Unique (note, line_no) and
(note, Delivery Order line).

`sal_delivery_note_pick` (U15): delivery_note_line_id, pick_no, lot_id (no
FK), lot_no, expiry_date, qty, base_qty, unit_cost, cost_amount. Unique (line,
pick_no) and (line, lot).

**Worked example.** CO/2026/10/0001: 10.000 PCS × 1.000. DO/2026/10/0001 sends
1.500 from SO/2026/10/0001 and 500 from SO/2026/10/0002 from GDG-FG. Unit cost
600 / PCS.

| Note | Date | Lines | Cost | Journal |
| --- | --- | --- | ---: | --- |
| SJ/2026/10/0001 | 15/10 | 1.000 (SO …0001) | 600.000 | Dr HPP 600.000 / Cr Persediaan 600.000 |
| SJ/2026/10/0002 | 17/10 | 500 (SO …0001) + 500 (SO …0002) | 600.000 | two pairs of 300.000 |

After SJ/…0002 every DO line is fully delivered, so DO/2026/10/0001 closes
itself. A Faktur may later take SJ/…0001's line alone (DPP 1.000.000), and
SJ/…0002's two lines together or apart — never 300 of the 500.

**Closing (U14).** A Delivery Order closes itself when every line is fully
delivered by posted notes; a Sales Order likewise. Closing either by hand
(*Tutup*) then **releases what was never delivered**: a closed Delivery Order
holds only its delivered quantity on the Sales Order line, and a closed Sales
Order only its delivered quantity on the Customer Order line. The Customer
Order stays closed by hand until the Faktur is designed. Numbered
**`SJ/YYYY/MM/NNNN`** (U13) — Surat Jalan, the name on the paper, and no clash
with DN for Debit Note.

**Still open for the Faktur, not the Delivery Note:** a Faktur Pajak carries
one date (the delivery date); if one Faktur may take lines from notes posted on
different days, which date it carries — or whether a Faktur takes lines of
notes of one date only — is decided with the Faktur.

---

## 6. Uang Muka Penjualan — the advance bill  [Built]

### 6.1 What it is

The **request** for a down payment, drawn from one **Open** Customer Order. It
is designed to print later as the proforma sent to the customer. **It books
nothing at any step**; the money, the journal and the tax figures come with
the receipt.

### 6.2 What the user fills in

| Group | Fields |
| --- | --- |
| From the order (read-only) | Customer, address, PO, Mode Harga, Kena PPN — in the order's own sections |
| Tagihan | Tanggal, Jatuh Tempo (default + 7 days), Rekening Pembayaran (a rupiah Bank, printed), Catatan |
| Dasar Uang Muka | The order as **one line**: Uraian (required, the printed line), the order's total and DPP. Below it the value drawn, typed as **%** or **Nominal**, in the order's price mode, with the room left as the field's help |

### 6.3 What the system computes and stores

| Figure | Rule |
| --- | --- |
| Value drawn (`amount`) | % of the order's value (4.6), or the Nominal |
| DPP | The value (Exclude / not Kena PPN), or its inclusive split (Include) |
| DPP Nilai Lain, PPN | Chain of 3.7 on the bill's own snapshot |
| Total | DPP + PPN — what the bill asks for |
| PPh estimate (shown, not stored) | The bill's DPP shared over the order's lines by the Jenis PPh each carries (largest share absorbs rounding), each at its rate |

### 6.4 The order's room

**Room = the order's value − Σ `amount` of its bills not Cancelled** (Draft and
Issued both count). A bill can never take more than the room. Checked at save
and at Terbitkan, with the order locked.

### 6.5 Lifecycle

```
Draft ──Terbitkan──► Diterbitkan
  │                       │
  └──Batalkan (reason)────┴──Batalkan (reason)──► Dibatalkan (final)
```

| Step | Permission | Effect |
| --- | --- | --- |
| Save | `SALES_ADVANCE_CREATE` / `_EDIT` | Takes room; snapshot refreshed |
| Terbitkan | `SALES_ADVANCE_ISSUE` | Locks and freezes; only now can a receipt pay it. No journal, no faktur pajak |
| Batalkan | `SALES_ADVANCE_CANCEL` | Gives the room back. **Refused once any posted receipt paid the bill, even in part** — a leftover is refunded, not cancelled |

### 6.6 Paid state (shown, never stored)

Paid = Σ `settled_amount` of **posted** receipt lines naming the bill, in the
bill's gross terms. **Belum Dibayar** (0) · **Sebagian** (between) · **Lunas**
(= total). Sisa = total − paid.

### 6.7 Table `sal_advance`

| Column | Meaning | Example |
| --- | --- | --- |
| advance_no, advance_date, due_date, status | Number, date, due date, Draft / Issued / Cancelled | ARA/2026/10/0001 |
| customer_order_id, customer_id, cash_bank_id | Order, its customer, bank printed as where to pay | CO/2026/10/0001 |
| description, note | Uraian (printed), Catatan | |
| price_mode, is_taxable | Copied from the order | Exclude, true |
| ppn_rate, ppn_dpp_other_numerator / _denominator | Snapshot | 12, 11, 12 |
| amount_type, amount_value | As typed | Percent, 30 |
| amount | Value drawn (uses up room) | 3.000.000 |
| dpp_amount, dpp_other_amount, ppn_amount, total_amount | Figures | 3.000.000 / 2.750.000 / 330.000 / 3.330.000 |
| cancel_reason | | |

There is **no paid, used or balance column**: paid is read from receipt lines,
held is the AR item's job.

---

## 7. Penerimaan Kas & Bank — the receipt  [Built]

### 7.1 What it is

One table for **every movement of money**, shown as two menus (Penerimaan
`BKM/…`, Pengeluaran `BKK/…`). Its **tujuan** (purpose, a catalogue in code)
decides which documents it settles and how it posts. Built today: **Penerimaan
dari Customer** (`customer_receipt`, P98), which settles advance bills and
Fakturs (§7.8). One receipt may settle several documents of one customer.

### 7.2 How the user builds it

1. Tujuan, customer, bank account, date, bank statement reference.
2. **Pilih Tagihan** opens the customer's **issued** bills with something left
   (dates, total, paid, Sisa); *Pilih semua*; optional *Bagikan Dana* spreads
   one transfer over the ticked bills, oldest first.
3. Per line type **Diterima** — the cash the customer sent for that bill — and
   leave **Potong PPh** on unless the customer did not withhold.
4. Type **Biaya Bank** if the bank kept a fee (the company's expense).

Header: **Total Diterima** = Σ Diterima; **Dana Masuk ke Bank** = Total
Diterima − Biaya Bank. No balancing check.

### 7.3 The cash shortfall rule (what one line settles)

Settled = **cash received + PPh withheld**. PPh is never typed; it follows from
the cash:

| Cash typed | Result |
| --- | --- |
| Reaches the bill's Sisa less its remaining PPh | **Cleared**; the gap is the PPh |
| Less | **Partial**: the part of the bill whose cash after its own PPh share equals the money is settled; the rest stays open |
| More | **Refused**. No overpayment; unmatched money will go to *Penerimaan Belum Teridentifikasi* [Planned] |

What is settled splits into **DPP part, PPN part and PPh per Jenis PPh**, in
proportion; the splits are cumulative, so the instalment that clears the bill
takes exactly what is left.

### 7.4 Lifecycle

`Draft ──Post──► Posted` (final) · `Draft ──Batalkan──► Dibatalkan`.
Permissions `CASH_RECEIPT_VIEW / _CREATE / _EDIT / _POST / _CANCEL`.

### 7.5 What Post writes (one transaction)

1. Locks each bill, re-reads what posted receipts already settled, recomputes
   every line; refuses if a bill no longer has room.
2. **Journal**: Dr Kas & Bank (Dana Masuk ke Bank) · Dr Beban Bank · Dr PPh
   Dibayar Dimuka per Jenis PPh / Cr Uang Muka Penjualan (DPP part, per bill,
   naming the customer) · Cr PPN Keluaran (PPN part). Accounts from Account
   Mapping and each Jenis PPh.
3. **Cash Bank Book** entry for Dana Masuk ke Bank.
4. Lines and PPh rows rewritten with the final figures — the source of the
   future **Faktur Pajak Uang Muka** (per line) and **Bukti Potong** (per PPh
   row: one per bill, per payment, per Jenis PPh).
5. **One Uang Muka AR item per line** with a DPP part (section 8).
6. **The Uang Muka item carries its own Faktur Pajak Uang Muka figures**
   (`tax_dpp`, `tax_dpp_other`, `tax_ppn`, U9), copied from the line. One item
   = one payment of one bill = one Faktur Pajak Uang Muka, dated the receipt
   date. From then on the item is where that tax lives; nothing reads it back
   from the receipt.
7. Status Posted.

**Why the AR item is at DPP, not gross:** PPN on an advance is due when the
money arrives, so it goes straight to PPN Keluaran. Only the DPP part is owed
back to the customer in goods, and only that sits on Uang Muka Penjualan.

### 7.6 Tables

`fin_cash_bank_tx`: tx_no, direction (In), purpose, tx_date, status,
partner_id, cash_bank_id, bank_ref, note, **cash_amount** (into the bank),
**bank_charge**, **settled_amount** (Σ lines), **pph_amount** (Σ lines),
journal_id, cancel_reason.

`fin_cash_bank_tx_line`: tx_id, line_no, **doc_type_id + doc_id** (weak link to
the bill; once per receipt), **settled_amount** (cash + PPh), **withhold**
(Potong PPh), **dpp_part**, **ppn_part**, **pph_amount**. Cash for the bill =
settled − PPh.

`fin_cash_bank_tx_line_wht`: line_id, withholding_tax_id, rate, base_amount,
amount. One row = one future Bukti Potong.

### 7.7 How to use

| Need | How |
| --- | --- |
| Bills offered | Issued bills of the customer with Sisa > 0 |
| Faktur Pajak Uang Muka figures | Per posted line: dpp_part, ppn_part, dated the receipt date |
| Expected Bukti Potong | Each PPh row of a posted receipt |
| Checks | line settled = dpp_part + ppn_part; line pph = Σ its PPh rows; header settled / pph = Σ lines; cash_amount = settled − pph − bank_charge; a posted receipt has a journal, a Draft has none |

### 7.8 Penerimaan dari Customer — paying invoices too  [Built] (P83, P98; U23–U28)

The next step after the Faktur (§9, step 3). **One customer purpose settles
every kind of open customer document** (P83): *Penerimaan Uang Muka
Penjualan* becomes **Penerimaan dari Customer**, and one receipt — one line on
the bank statement — may pay advance bills and invoices together. Each line
still posts by its document's kind.

**What changes for the user**

1. The purpose picker offers one Penerimaan purpose, *Penerimaan dari
   Customer*. Existing receipts are relabelled; their postings do not change.
2. **Pilih Tagihan** lists the customer's open advance bills **and** open
   Fakturs together, each with a type badge (*Uang Muka* / *Faktur*), its
   number, date, due date, total, paid and Sisa — ordered by due date, oldest
   first, which is also the order *Bagikan Dana* spreads a transfer in.
3. A line is typed the same way for both: **Diterima** (the cash for that
   document) and **Potong PPh**; the PPh follows from the cash by the same rule
   (§7.3). No overpayment, no write-off (P84, P85).

**What an invoice line is worth (U23–U25)**

| | Advance bill (as today) | Faktur (new) |
| --- | --- | --- |
| What is open | Bill total − what posted receipts settled | **The Invoice AR item's balance** (U23) — the book, not receipt history, so a later close or Nota Retur that lowers the item is respected |
| Settled before (for the positional shares) | Σ posted receipt lines | Invoice total − item balance |
| PPh a customer withholds | Per Jenis PPh on the bill's DPP | **Per Jenis PPh on the Faktur's net DPP** (after the Uang Muka), from its lines' Jenis PPh (U24) — the advance's PPh was withheld when the advance was paid |
| DPP / PPN split of what is settled | Booked: Cr Uang Muka (DPP) · Cr PPN Keluaran | **Informational only** (U25): PPN was booked at the Faktur; the whole settled amount clears Piutang |

**What Post writes for an invoice line**

- **Journal**: Dr Kas & Bank (its cash, in the one bank line) · Dr PPh Dibayar
  Dimuka per Jenis PPh / **Cr Piutang Usaha** (settled = cash + PPh), naming
  the customer. No PPN. Bank charge as today (P68).
- **AR item**: event **Pembayaran** on the Invoice item for the settled
  amount, naming the receipt (P72). A cleared invoice's item reaches 0.
- **PPh rows** as today: one Bukti Potong per Faktur, per payment, per Jenis
  PPh (P69).
- No AR item is created and no faktur pajak arises from an invoice payment.

**Worked example.** INV/2026/10/0001 (§9.7): net Piutang 2.220.000, net DPP
2.000.000, all lines under PPh 22 1,5 % → PPh 30.000. ARA/2026/10/0002: total
333.000 (DPP 300.000, PPN 33.000), no PPh. One transfer of 2.523.000:

| Line | Diterima | PPh | Settled |
| --- | ---: | ---: | ---: |
| INV/2026/10/0001 | 2.190.000 | 30.000 | 2.220.000 (cleared) |
| ARA/2026/10/0002 | 333.000 | 0 | 333.000 (cleared) |

Journal: Dr Bank 2.523.000 · Dr PPh 22 Dibayar Dimuka 30.000 / Cr Piutang
Usaha 2.220.000 · Cr Uang Muka Penjualan 300.000 · Cr PPN Keluaran 33.000.
AR: *Pembayaran* 2.220.000 on the Invoice item; a new Uang Muka item of
300.000 for the bill.

**Around it (U26–U28)**

| # | Rule |
| --- | --- |
| U26 | **The Faktur shows its paid state** — Belum Dibayar / Sebagian / Lunas, and *Lewat jatuh tempo* when overdue — read from its Invoice AR item, in its header and in the Faktur list; its page lists the receipts that paid it (links only). |
| U27 | **Purpose key and data:** the catalogue key becomes `customer_receipt`; a migration rewrites existing rows' `purpose`, so reports and the register read one purpose. The receipt line keeps its weak `(doc_type_id, doc_id)` pair, now `sal_advance` or `sal_invoice`. |
| U28 | **Locks:** posting locks each advance bill (as today) and each Invoice item (`settleArItem` already locks and refuses an overdraw), so two receipts cannot both clear the same invoice. Drafts reserve nothing, as today. |

**Decided 04/10/2026**

| # | Question | Decision |
| --- | --- | --- |
| Q1 | PPh base on a Faktur | **Decided:** net DPP after the Uang Muka (U24) |
| Q2 | Menu name | **Decided:** the menu stays *Penerimaan*; only the purpose is renamed |

---

## 8. AR items and Buku Piutang

> **Changed 06/10/2026 (P116–P119).** An AR item keeps balances only: it stores
> `original_amount` beside `current_balance` and no tax columns (its tax is its
> faktur's). An Invoice item is born at its **face** and the Uang Muka applied
> in its posting (event *Uang Muka Diterapkan*), the Uang Muka item lowered by
> the DPP used. The advance's PPN is recalculated by the chain; PPh is
> calculated when a payment needs it. Where this section says otherwise, read
> those decisions.

[Built] in this shape (U1, U9; P96, 04/10/2026). The Invoice item, the
*Pembayaran* and *Dipakai Invoice* events in use, come with the Faktur.

### 8.1 The idea

Every money-relevant customer position leaves an **AR item**: what is still
open, with its own balance. Every change is an entry in **Buku Piutang**,
append-only. The General Ledger says *how much* a customer owes; the items say
*which documents* make it up. There is **no allocation step or table**: a
payment or an advance usage moves the item directly inside the document's
posting.

### 8.2 The three questions, each stored once

| Question | Stored in |
| --- | --- |
| What is the position **about**? | Item: **source** document — the advance bill (Uang Muka), the Faktur (Invoice) |
| What **created** it? | Its first Buku Piutang entry (**Terbentuk**): the receipt (Uang Muka), the Faktur (Invoice) |
| What **moved** it later? | Its later entries, and `counter_item_id` when another item took it |

### 8.3 Item types

| Type | Source | Created by | Direction | Valued at | Due date |
| --- | --- | --- | --- | --- | --- |
| **Uang Muka** | Advance bill | Posted receipt, **one item per bill per receipt** | Lowers Piutang | Receipt line's DPP part = credit to Uang Muka Penjualan | No |
| **Invoice** [Planned] | Faktur | The same Faktur | Raises Piutang | Net Piutang after advances = debit to Piutang Usaha | Yes |

A bill paid twice has **two items**, both with the bill as source, told apart
by `ARI/…` number and the receipt in their Terbentuk entries. Each Uang Muka
item = one receipt line = one Faktur Pajak Uang Muka.

Future types need **no new column**: Nota Retur (source and creator = the
note), unidentified receipt (= the receipt), DN/CN (= the note). A refund of a
leftover advance is an event on the Uang Muka item, not a new item.

### 8.4 Events

| Event | Moves | Caused by |
| --- | --- | --- |
| **Terbentuk** (Create) | Opens any item, + | The creating posting |
| **Pembayaran** (Payment) [Planned] | Invoice item, − | A posted receipt (cash + PPh) |
| **Dipakai Invoice** (AdvanceUsed) [Planned] | Uang Muka item, −; names the Invoice item | A posted Faktur |

No reversal event, no edit. After creation an item only goes **down**.

### 8.5 Tables

`fin_ar_item`

| Column | Meaning | Example |
| --- | --- | --- |
| id | Row id | 1 |
| **ar_item_no** | `ARI/YYYY/MM/NNNN`, month of item_date; unique; for people | ARI/2026/10/0001 |
| item_type, direction | Advance / Invoice; Decrease / Increase (follows type) | Advance, Decrease |
| partner_id, currency_id | Customer, currency | |
| item_date | Date of the **creating posting** (receipt date for Uang Muka) | 05/10/2026 |
| due_date | Invoice only | |
| source_doc_type_id + source_doc_id + source_no | The document the item is **about** | ARA/2026/10/0001 |
| customer_order_id | Settlement scope (id only) | CO/2026/10/0001 |
| current_balance | Open amount = Σ its entries' movements; never below zero | 1.500.000 |
| tax_dpp, tax_dpp_other, tax_ppn | Figures of the item's **own** tax document, fixed at creation (U9). Uang Muka: its Faktur Pajak Uang Muka. Empty for an Invoice item (the Faktur holds its tax) and for any item with no tax document | 1.500.000 / 1.375.000 / 165.000 |
| tax_invoice_no | Coretax number of that tax document, typed or imported after upload; empty until then | |

`fin_ar_ledger` (Buku Piutang)

| Column | Meaning |
| --- | --- |
| item_id, event, entry_date | Which item, what, when |
| amount, movement, balance_after | Positive amount; signed movement (+ create, − settle); running balance |
| doc_type_id + doc_id + doc_no | The posting that caused it — on Terbentuk, the **only** record of what created the item |
| counter_item_id | For Dipakai Invoice: the Invoice item |
| note | Free text |

Removed from the earlier shape: `ref_doc_type_id`, `ref_doc_id`, `ref_no`,
`customer_order_no`.

### 8.6 How to use — writing (only inside a posting)

**Create**: next `ARI/…` number → item row (source = what it is about,
item_date = posting date, balance = value) → Terbentuk entry (+value, document
= the posting). Refuse ≤ 0.

**Move down**: lock the item → refuse if amount > balance (the whole posting
fails) → balance − amount → entry (−amount, causing posting, counter item for
Dipakai Invoice).

**Never**: edit/delete an entry, change a balance without an entry, raise an
existing item, delete an item, write from a Draft.

### 8.7 How to use — reading

| Question | How |
| --- | --- |
| Open now | Items with balance ≠ 0 |
| Open **on a past date** | Items with item_date ≤ date; per item Σ movement of entries ≤ date. Never `current_balance` |
| Original value / settled | Terbentuk amount / original − open |
| Which posting created it | Its Terbentuk entry |
| Items of one bill | Items whose source is the bill |
| What posting X did | Entries with that document; its Terbentuk entries are the items it created |
| Advances an invoice may use | Uang Muka items, same customer, same currency, same `customer_order_id`, balance > 0, oldest first |
| Faktur Pajak Uang Muka of an item | The item's own tax columns (U9) — never via the receipt |
| Output tax of a period (no Pajak menu needed) | Uang Muka items by item_date (tax columns) + Fakturs by tax date (net figures) |
| Items an invoice used | Dipakai Invoice entries whose counter_item_id is the Invoice item |
| Net position | Σ balance × (+1 Invoice, −1 Uang Muka) |
| Aging | Open Invoice items by days past due_date |

### 8.8 Checks

Balance = Σ movements · exactly one Terbentuk per item, first, dated item_date
· each balance_after = previous + movement · one Uang Muka item per bill per
receipt · Σ open Invoice items per customer = Piutang Usaha · Σ open Uang Muka
items per customer = Uang Muka Penjualan. A difference is a defect, never an
adjustment.

---

## 9. Faktur Penjualan — the bill for what was sent  [Built] (P97; U16–U22)

> **Changed 05/10/2026.** The Invoice now stores its gross and discount (P111),
> splits partial bills cumulatively (P112), and works out its PPN as **full PPN
> less the advances' PPN**, deducted once at header level (P113; KB choice point
> `settlement-ppn = full-less-advance`, replacing U7 for this ERP). Where this
> section says the PPN is the chain on the net DPP per line, read P113.

> **Named *Invoice Penjualan* in the application since P99**, so that *Faktur* alone means the faktur pajak. This section keeps its original wording.

The document that **bills goods already sent**. It is where Piutang, revenue
and output PPN are born (P71), where the order's paid Uang Muka is deducted,
and where the Invoice AR item is created. It bills **only what left on a posted
Delivery Note**, never an ordered or planned quantity.

```
CO (price, mode, PPN, PPh) ──► Faktur header (one CO)
SJ line (posted, whole)    ──► Faktur line  ──posts──► Dr Piutang · Dr Uang Muka / Cr Penjualan · Cr PPN Keluaran
Uang Muka items of the CO  ──► deduction rows (DPP used, typed)
```

### 9.1 What is agreed

| # | Rule |
| --- | --- |
| **U16** | **One Faktur bills one Customer Order.** Chosen once and locked; customer, Termin, mode harga, Kena PPN, PO and the line prices come from it. |
| **U17** | **Its lines are Delivery Note lines, picked by the user, each taken whole** (U14): only lines of **posted** Delivery Notes of that order, each billed once. So a Faktur can bill only what was actually sent. |
| **U18** | **Include / Exclude PPN and Kena PPN are the Customer Order's**, shown, never chosen. An order without PPN bills without PPN and makes no faktur pajak. |

### 9.2 What the user fills in

| Field | Rules |
| --- | --- |
| Customer Order | An Open or **Closed** order with a posted, unbilled Delivery Note line — a closed order is still billed for what it sent (U21); chosen once, locked. Customer, PO, Termin, Mode Harga, Kena PPN shown read-only |
| Tanggal Faktur | **Typed** — the Faktur's own date and its journal date; not before the latest Tanggal Kirim of the notes picked (U19) |
| Tanggal Pajak | **The latest Tanggal Kirim of the notes picked** (U19), shown — the faktur pajak's date. One Faktur and one faktur pajak may cover many Delivery Notes |
| Jatuh Tempo | **The latest Tanggal Kirim + the order's Termin days** (U19); shown, not typed |
| Alamat Penagihan | Any of the customer's addresses, starting on one flagged Penagihan, else the order's address |
| Rekening Pembayaran | A rupiah Bank, printed on the bill (as on the advance bill) |
| Catatan | Free text |
| Lines | **Pilih Surat Jalan** opens the order's posted, unbilled lines grouped by Delivery Note (SJ no, Tanggal Kirim, item, qty) — tick a whole note or single lines. Nothing to type on a line: quantity, price and discount come from the note and the order |
| Uang Muka | **Pilih Uang Muka** opens a dialog, as *Tambah Item* does (P81): the order's open Uang Muka items with ARI no, receipt date, bill, balance and faktur pajak no, ticked and applied with *Terapkan*. Each picked item becomes a row on the page where the user types the **DPP used**, up to its balance and in total up to the Faktur's DPP (U8); nothing pre-filled, a blank row refused, an unticked one leaves |

### 9.3 A line's figures

A Faktur line = one Delivery Note line: its quantity (in the Customer Order
line's unit) × the order line's price, less the discount:

- **Percent discount**: the same percent on the billed quantity.
- **Nominal discount**: shared by quantity — `round(discount × qty billed ÷
  qty ordered)` — and **the bill that completes the order line takes the
  remainder**, so the Fakturs of a line add up exactly to the order line's
  amount. The same remainder rule holds for the amount itself.
- DPP, DPP Nilai Lain and PPN per line by `sales-tax.ts` (P60): Exclude → the
  amount is the DPP; Include → the inclusive split of the amount. PPN at the
  rates the order snapshotted (U20).
- Jenis PPh and its rate are the order line's, carried for the expected
  withholding (*Estimasi Penerimaan*), as on the order.

**As built (P97):** the Uang Muka used is shared over the lines by DPP, the
largest absorbing the rounding, and each line's DPP Nilai Lain and PPN are the
chain on its own net DPP — so the document is still the sum of its lines (P60)
while PPN is on the net DPP (U7). A Draft reserves the Uang Muka it uses; a
later Faktur may use only what is free.

### 9.4 The totals and the advance

| Figure | How |
| --- | --- |
| DPP (full) | Σ line DPP |
| Uang Muka Dipakai | Σ DPP used typed on the deduction rows |
| DPP setelah Uang Muka (net DPP) | DPP − Uang Muka Dipakai |
| DPP Nilai Lain, PPN | The chain on the **net** DPP (U7; never "full PPN − advance PPN") |
| Total Tagihan = net Piutang | Net DPP + PPN |
| Estimasi PPh | Net DPP shared over the lines (largest absorbs), × each line's Jenis PPh rate, per Jenis PPh — information, as on the order |

A Faktur fully covered by its advances (net DPP 0) posts revenue and clears
the Uang Muka, but carries no new PPN and makes no Faktur Pajak Pelunasan.

### 9.5 Lifecycle and posting

```
Draft ──Posting──► Posted (final; corrected later by Nota Retur / Faktur Pengganti)
  └──Batalkan (reason)──► Dibatalkan (final; its lines are billable again)
```

Numbered **`INV/YYYY/MM/NNNN`** (the simulation's prefix). Permissions
`SALES_INVOICE_VIEW / _CREATE / _EDIT / _POST / _CANCEL`.

**Posting, one transaction under the Customer Order's lock:**

1. Recheck: every line still on a posted Delivery Note and not on another live
   Faktur; each Uang Muka item still has the DPP used; Σ used ≤ DPP; period
   open; accounts mapped.
2. **Journal**, dated Tanggal Faktur (U19):

| Account | Debit | Credit | Partner |
| --- | ---: | ---: | --- |
| Piutang Usaha | net Piutang | | customer |
| Uang Muka Penjualan | Uang Muka Dipakai | | customer |
| Penjualan | | full DPP | |
| PPN Keluaran | | PPN (on net DPP) | |

   Balanced: net DPP + PPN + used = full DPP + PPN. Revenue is net of
   discount (no separate discount account). Piutang Usaha and Penjualan are
   new Account Mapping entries; Uang Muka Penjualan and PPN Keluaran exist.
3. **AR items:** create the **Invoice item** at net Piutang with the due date
   (Terbentuk); write **Dipakai Invoice** on each Uang Muka item used, naming
   the Invoice item. A Faktur with net Piutang 0 creates no Invoice item.
4. Store its own tax (U10): full and net DPP / DPP Nilai Lain / PPN, Uang
   Muka Dipakai, tax date, `tax_invoice_no` empty until typed after Coretax.
5. The billed Delivery Note lines read **Ditagih** from then on (shown on the
   Delivery Note, read from the Faktur lines, never stored there).

### 9.6 Tables (proposed)

`sal_invoice`: invoice_no, invoice_date, due_date, status, customer_order_id,
customer_id, address_id, bank_id, price_mode, is_taxable, ppn_rate,
dpp_other numerator / denominator (from the order), dpp_amount,
advance_dpp_used, net_dpp_amount, net_dpp_other_amount, ppn_amount,
total_amount (net Piutang), tax_date, tax_invoice_no, journal_id,
ar_item_id, note, cancel_reason.

`sal_invoice_line`: invoice_id, line_no, **delivery_note_line_id** (unique
among live Fakturs, checked under the order's lock), customer_order_line_id,
qty, price, discount_amount, amount, dpp_amount, dpp_other_amount,
ppn_amount, withholding_tax_id, withholding_rate.

`sal_invoice_advance_deduction`: invoice_id, **ar_item_id**, dpp_used. Unique
(invoice, item).

The Faktur module reads Delivery Note lines through the Delivery Note
module's functions and moves AR items through the AR book (§3.1), as the
Delivery Note does with the Delivery Order.

### 9.7 Worked example

CO/2026/10/0001: 10.000 PCS × 1.000, Exclude, Kena PPN. Uang Muka paid: one
item ARI/2026/10/0001, DPP 2.000.000. Sent: SJ/…0001 1.000 PCS (15/10),
SJ/…0002 2.000 PCS (17/10).

INV/2026/10/0001, dated 20/10, bills both notes, using 1.000.000 of the advance.
Its tax date is 17/10, the latest Tanggal Kirim, and with Termin NET30 it falls
due 16/11 (U19):

| Figure | Amount |
| --- | ---: |
| DPP (3.000 × 1.000) | 3.000.000 |
| Uang Muka Dipakai | 1.000.000 |
| Net DPP | 2.000.000 |
| DPP Nilai Lain (11/12) | 1.833.333 |
| PPN 12 % | 220.000 |
| Total Tagihan | 2.220.000 |

Journal: Dr Piutang 2.220.000 · Dr Uang Muka Penjualan 1.000.000 / Cr
Penjualan 3.000.000 · Cr PPN Keluaran 220.000. Invoice item ARI/…0002 at
2.220.000; ARI/…0001 falls to 1.000.000 (*Dipakai Invoice*), left for the next
Faktur.

### 9.8 Build order

1. **AR item shape U1 + tax columns U9** (agreed, not built) — the Faktur
   writes the revised shape, so it goes first.
2. **Faktur Penjualan** as above, with the Ditagih state on the Delivery Note
   and the Faktur list on the Customer Order; the Customer Order closing itself
   once fully delivered (U21).
3. **Penerimaan dari Customer** (P83): advance bills and invoices in one
   receipt; the *Pembayaran* event on the Invoice item.

### 9.9 Decided 04/10/2026

| # | Rule |
| --- | --- |
| **U19** | **One Faktur — and its one faktur pajak — may cover many Delivery Notes.** The Faktur has **its own Tanggal Faktur**, typed and not before the latest note's Tanggal Kirim, which dates its journal. The **faktur pajak's date** and the **due date** follow from the **latest Tanggal Kirim**: tax date = that day; Jatuh Tempo = that day + the order's Termin days. |
| **U20** | **PPN at the Customer Order's snapshot** (rate and DPP Nilai Lain factor frozen at Ajukan), as the advance uses, so the order, its advances and its Fakturs share one arithmetic. |
| **U21** | **The Customer Order is finished when its delivery is finished; billing comes after.** It closes itself (no reason, event *Ditutup — seluruhnya terkirim*) once every line is fully delivered by posted Delivery Notes, as the Sales Order and Delivery Order do (U14); Tutup Pesanan by hand stays. A closed Customer Order still takes Fakturs for its posted, unbilled lines, and nothing about billing holds it open. |
| **U22** | **Penjualan and Piutang Usaha come from Account Mapping**, one each, until the Kategori Item mapping (C25), as HPP / Persediaan (U12). |

---

## 10. Multi-currency

Sales are rupiah today. This is the agreed concept for when foreign-currency
sales arrive; it follows `multi_currency_concept.md` and the user's decisions
of 02/10/2026 (section 14, U2–U6).

### 10.1 Measures

Every AR item and entry carries two measures: **foreign** (the document's
currency) and **base** (rupiah). Carrying rate = base balance ÷ foreign
balance, **calculated, never stored**. For a rupiah item rate = 1 and the two
measures are equal.

### 10.2 Columns to add — **later** (U6)

| Table | Add |
| --- | --- |
| `fin_ar_item` | `current_base_balance` |
| `fin_ar_ledger` | `rate`, `base_amount`, `base_movement`, `base_balance_after` |

The same shape as the Cash Bank Book. Customer Order, bill and receipt gain
their currency and kurs when foreign sales are built.

### 10.3 Which kurs each event uses

| Event | Base (rupiah) | FX difference |
| --- | --- | --- |
| Terbentuk – Uang Muka | The rupiah the cash actually brought in (receipt kurs) | None |
| Terbentuk – Invoice | New amounts at the Faktur's kurs; the advance part at the advance's own rupiah | None |
| Pembayaran | Invoice relieved at its **carrying rate**; bank side at the bank's kurs | **Yes, per line**, to Selisih Kurs in the receipt's journal |
| Dipakai Invoice | Advance relieved at **its carrying rate** | **None** (U3) — revenue for the advanced part is recognised at the advance's rate |
| Revaluasi | Base only; foreign 0 | Unrealised, in the revaluation journal |

- Final settlement releases the **exact remaining base**, so an item closes at
  0 / 0.
- "Never below zero" checks the foreign balance.
- **Revaluation is a manual process** run by the user for a chosen date and
  closing kurs, never automatic (U2). It applies to open **Invoice** items;
  whether open **Uang Muka** items are included is open (recommended: no — a
  claim on goods, not on currency).
- **Tax kurs = the document's kurs** for now (U4); a separate Kurs KMK for PPN,
  DPP Nilai Lain and PPh is decided later.
- An invoice uses **only advances in its own currency** (U5).

### 10.4 Example (not Kena PPN, to keep it short)

Advance 1.000 USD received at 16.000 → Uang Muka item 1.000 USD / 16.000.000.
Faktur 5.000 USD at 16.200, using the advance: Penjualan = 16.000.000 (advance
part) + 4.000 × 16.200 = 80.800.000; Invoice item 4.000 USD / 64.800.000; no
FX difference.

| Next | Effect |
| --- | --- |
| Manual revaluation 31/12 at 16.300 | Invoice item base → 65.200.000; unrealised gain 400.000 |
| Paid 01/01 into a rupiah bank at 16.100 | Bank 64.400.000; item relieved at 65.200.000; realised loss 800.000 |

---

## 11. End-to-end worked example

Rupiah, PPN 12 % on DPP × 11/12, PPh 22 1,5 %. Numbers after the Faktur are
illustrative (its prefix is not decided).

### 11.1 Customer Order `CO/2026/10/0001` (01/10/2026)

One line: 10.000 PCS × 1.000, no discount, Exclude, Kena PPN, Jenis PPh PPH22,
Termin NET30.

| DPP | DPP Nilai Lain | PPN | Total | PPh estimate | Estimasi Penerimaan |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10.000.000 | 9.166.667 | 1.100.000 | 11.100.000 | 150.000 | 10.950.000 |

Ajukan → Setujui → **Open**. No journal.

### 11.2 Sales Orders

| SO | Tanggal Kirim | Qty | Sudah di-SO after | Sisa after |
| --- | --- | ---: | ---: | ---: |
| SO/2026/10/0001 | 15/11/2026 | 2.000 PCS | 2.000 | 8.000 |
| SO/2026/10/0002 | 15/12/2026 | 2.000 PCS | 4.000 | 6.000 |

A third asking 7.000 PCS is refused (Sisa 6.000). No journal.

### 11.3 Advance bill `ARA/2026/10/0001` (01/10/2026), 30 %

Amount 3.000.000 · DPP 3.000.000 · DPP NL 2.750.000 · PPN 330.000 · **Total
3.330.000** · PPh estimate 45.000. Room left 7.000.000. Terbitkan. No journal.

### 11.4 Two receipts

| Receipt | Date | Diterima | Biaya Bank | Settled | DPP part | PPN part | PPh 22 | Into bank | Bill after |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| BKM/2026/10/0001 | 05/10 | 1.642.500 | 0 | 1.665.000 | 1.500.000 | 165.000 | 22.500 | 1.642.500 | Sebagian |
| BKM/2026/10/0002 | 20/10 | 1.642.500 | 6.500 | 1.665.000 | 1.500.000 | 165.000 | 22.500 | 1.636.000 | Lunas |

Journal of BKM/2026/10/0002:

| Account | Dr | Cr |
| --- | ---: | ---: |
| Bank | 1.636.000 | |
| Beban Bank | 6.500 | |
| PPh 22 Dibayar Dimuka | 22.500 | |
| Uang Muka Penjualan (customer) | | 1.500.000 |
| PPN Keluaran | | 165.000 |

After 05/10 the bill can no longer be cancelled.

### 11.5 Faktur `FJ/2026/11/0001` (10/11/2026) for the whole order [Planned]

The user types Uang Muka Dipakai 3.000.000 (all that is held). The system
takes ARI/2026/10/0001 then ARI/2026/10/0002, 1.500.000 each.
Full DPP 10.000.000 − Uang Muka Dipakai 3.000.000 = net DPP 7.000.000 → net
PPN round(12 % × round(7.000.000 × 11/12)) = 770.000 → **net Piutang
7.770.000**, due 10/12/2026.

| Account | Dr | Cr |
| --- | ---: | ---: |
| Piutang Usaha (customer) | 7.770.000 | |
| Uang Muka Penjualan (customer) | 3.000.000 | |
| Penjualan | | 10.000.000 |
| PPN Keluaran | | 770.000 |

### 11.6 Invoice paid `BKM/2026/12/0001` (10/12/2026) [Planned]

PPh 22 on 7.000.000 = 105.000; customer sends 7.665.000.
Dr Bank 7.665.000 · Dr PPh 22 Dibayar Dimuka 105.000 / Cr Piutang Usaha
7.770.000.

### 11.7 The rows left behind

`sal_advance`: ARA/2026/10/0001, Issued, Percent 30, amount 3.000.000, DPP
3.000.000, DPP NL 2.750.000, PPN 330.000, total 3.330.000.

`fin_cash_bank_tx_line`

| tx | document | settled | withhold | dpp_part | ppn_part | pph |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| BKM/2026/10/0001 | ARA/2026/10/0001 | 1.665.000 | true | 1.500.000 | 165.000 | 22.500 |
| BKM/2026/10/0002 | ARA/2026/10/0001 | 1.665.000 | true | 1.500.000 | 165.000 | 22.500 |

`fin_ar_item`

| ar_item_no | type | item_date | due_date | source_no | customer_order | balance (end) |
| --- | --- | --- | --- | --- | --- | ---: |
| ARI/2026/10/0001 | Advance | 05/10/2026 | — | ARA/2026/10/0001 | CO/2026/10/0001 | 0 |
| ARI/2026/10/0002 | Advance | 20/10/2026 | — | ARA/2026/10/0001 | CO/2026/10/0001 | 0 |
| ARI/2026/11/0001 | Invoice | 10/11/2026 | 10/12/2026 | FJ/2026/11/0001 | CO/2026/10/0001 | 0 |

`fin_ar_ledger`

| # | item | event | date | movement | balance_after | doc_no | counter_item |
| ---: | --- | --- | --- | ---: | ---: | --- | --- |
| 1 | ARI/2026/10/0001 | Create | 05/10 | +1.500.000 | 1.500.000 | BKM/2026/10/0001 | — |
| 2 | ARI/2026/10/0002 | Create | 20/10 | +1.500.000 | 1.500.000 | BKM/2026/10/0002 | — |
| 3 | ARI/2026/11/0001 | Create | 10/11 | +7.770.000 | 7.770.000 | FJ/2026/11/0001 | — |
| 4 | ARI/2026/10/0001 | AdvanceUsed | 10/11 | −1.500.000 | 0 | FJ/2026/11/0001 | ARI/2026/11/0001 |
| 5 | ARI/2026/10/0002 | AdvanceUsed | 10/11 | −1.500.000 | 0 | FJ/2026/11/0001 | ARI/2026/11/0001 |
| 6 | ARI/2026/11/0001 | Payment | 10/12 | −7.770.000 | 0 | BKM/2026/12/0001 | — |

Customer position over time:

| As of | Uang Muka held | Piutang (invoices) | Net |
| --- | ---: | ---: | ---: |
| 04/10/2026 | 0 | 0 | 0 |
| 31/10/2026 | 3.000.000 | 0 | −3.000.000 (paid ahead) |
| 30/11/2026 | 0 | 7.770.000 | +7.770.000 (owes) |
| 31/12/2026 | 0 | 0 | 0 |

---

## 12. Reports (Finance › Laporan)  [Built]

All read Buku Piutang **as of the chosen date**, so a past date shows the
position as it stood.

| Report | Shows | Permission |
| --- | --- | --- |
| **Buku Piutang** | One customer over a period: every entry, position before/after, open items behind it. Invoices by default; *Sertakan Uang Muka* (`advance=1`) adds advances | `REPORT_AR_LEDGER_VIEW` |
| **Umur Piutang** | Open Invoice items per customer: Belum Jatuh Tempo / 1–30 / 31–60 / 61–90 / > 90 days, beside Uang Muka held and net | `REPORT_AR_AGING_VIEW` |
| **Uang Muka Customer** | Open Uang Muka items per customer and Customer Order, checked against the Uang Muka Penjualan account | own view permission |

Items are shown by `ARI/…` number with their source document and, for an Uang
Muka, the receipt from its Terbentuk entry [Built] (P96).

---

## 13. Not built yet, and open points

| Item | State |
| --- | --- |
| Revised AR item shape (`ar_item_no`, source = what it is about, `ref_*` dropped) | [Built] — U1, P96 |
| Faktur Penjualan, Invoice items, Dipakai Invoice, Pembayaran | [Built] — §9, P97; §7.8, P98 |
| Tax columns on `fin_ar_item` (U9) | [Built] — P96; `tax_invoice_no` is written when the Faktur Uang Muka's upload is recorded (P100) |
| Whether Coretax accepts one Faktur Pajak Uang Muka referenced by two Faktur Pelunasan (partial use) | To verify with a tax consultant |
| A settlement PPN 1 rupiah off "full PPN − advance PPN" after odd partial receipts | Accepted: the chain on the net DPP wins (it is what the Faktur Pajak Pelunasan carries) |
| *Penerimaan dari Customer* (bills and invoices in one receipt) | [Built] — §7.8, P98 |
| Faktur Pajak (Uang Muka, Pelunasan, Normal) and Bukti Potong as records | [Built] — Pajak menu, P100: made by posting, internal records, NSFP an optional correctable reference, BPPU recorded by the user (P101) |
| Coretax XML export, faktur pengganti / pembatalan, Perlu Pembetulan | [Planned] |
| Pengembalian Uang Muka (refund) | [Planned] Pengeluaran purpose |
| Closing a bill / invoice remainder by its owner (write-off) | [Planned] with the close action |
| *Penerimaan Belum Teridentifikasi* and how it is cleared | [Planned]; clearing is open (C31) |
| Delivery Note, closing SO / DO when delivered, releasing undelivered quantity on a hand-closed SO / DO | [Built] (P94) |
| Auto-closing the Customer Order once fully delivered | [Built] — U21, P97 |
| Printing the advance bill | Needs Company Setting and bank account details |
| Multi-currency columns and behaviour | Later (U6) |
| Whether manual revaluation includes Uang Muka items | **Open** (recommended: no) |
| Separate Kurs KMK for tax | **Open**, later (U4) |
| Correcting a posted receipt (C29), approval of Pengeluaran (C30), menu layout (C32) | Set aside by the user |
| WAPU, transaction codes, NITKU | Later |

---

## 14. Concept updates not yet in `Claude-ERP.md`

Agreed with the user on 02/10/2026; to be recorded in §12 when built.

| # | Update |
| --- | --- |
| **U1** | **AR item shape revised.** An item's source is the document it is **about** (advance bill, Faktur, later Nota Retur…); the posting that created it is recorded only in its Terbentuk entry. `ref_doc_type_id`, `ref_doc_id`, `ref_no` and `customer_order_no` are dropped; `customer_order_id` stays as the settlement scope; every item gets `ar_item_no` `ARI/YYYY/MM/NNNN`. One item per bill per receipt is kept, guaranteed by the posting. Amends P71–P73. |
| **U2** | **Revaluation of foreign AR items is manual**, run by the user, never automatic. |
| **U3** | **No FX difference when the Faktur uses an advance**: the advanced part of revenue is recognised at the advance's rupiah (inheritance). |
| **U4** | **Tax uses the document's kurs** for now; a separate Kurs KMK is decided later. |
| **U5** | **An invoice uses only advances in its own currency.** |
| **U6** | **Multi-currency base columns on AR items are added later**, when foreign sales are built — not in the U1 migration. |
| **U7** | **An invoice never searches payment history** (03/10/2026). A receipt is a transaction, not a root document. The Faktur reads only its Customer Order's AR items: their balances give the advance DPP, and its PPN is the chain on the net DPP. The advance's PPN is never needed. |
| **U8** | **The user picks the Uang Muka a Faktur uses and types the DPP used from each** (03/10/2026), up to each item's balance and in total up to the Faktur's DPP. An item may be used in part. Replaces the earlier "one total drawn oldest first". |
| **U9** | **An AR item carries its own tax document's figures** (03/10/2026): `tax_dpp`, `tax_dpp_other`, `tax_ppn`, `tax_invoice_no`. A Uang Muka item is its Faktur Pajak Uang Muka. The columns are generic (a later Nota Retur item fills them the same way), so no type adds a column. **One item per bill per receipt stays** (reconfirmed): a bill paid twice has two Faktur Pajak Uang Muka, so two items. |
| **U11** | **The Delivery Note issues goods through an inventory module; today a stand-in** (03/10/2026). It calls `issue(item, warehouse, base qty, date, document)` and gets the unit cost back, as it will with real stock. The stand-in is backed by temporary tables of its own (`tmp_item_cost`: one Harga Pokok per item kept in a small menu; `tmp_stock_movement`: one row per issue), never named by a sales module; stock is always sufficient. Real inventory later keeps the contract and drops the temporary tables. `m_item` gets no cost column. |
| **U12** | **HPP and Persediaan come from Account Mapping** (03/10/2026), one each for the company, until the Kategori Item mapping (C25). |
| **U13** | **The Delivery Note is numbered `SJ/YYYY/MM/NNNN`** (03/10/2026). |
| **U14** | **Delivery Orders and Sales Orders close themselves when fully delivered** (03/10/2026); closing one by hand releases the undelivered quantity. The Customer Order stays closed by hand until the Faktur. A Faktur takes Delivery Note lines **whole**, never part of a line; the Delivery Note recognises HPP only, never Piutang. |
| **U15** | **The Delivery Note picks stock by lot** (04/10/2026). Every Barang with Kelola Stok leaves by lot: the line holds picks (lot, quantity, lot number and expiry as printed), never more than the line and exactly it to post; a Draft may be picked in part. The lots come from the inventory module — today a stand-in lot list (`tmp_stock_lot`, no quantity, earliest expiry first, kept in *Lot (Sementara)*); each pick is its own stock movement and carries its own cost. Lot-less items take no pick. |
| **U16** | **One Faktur Penjualan bills one Customer Order** (04/10/2026), chosen once and locked; its customer, Termin, prices and tax settings come from it. |
| **U17** | **A Faktur's lines are Delivery Note lines the user picks, each whole** (04/10/2026): only posted notes of that order, each line billed once — so only what was actually sent is billed. |
| **U18** | **The Faktur's Include / Exclude PPN and Kena PPN are the Customer Order's** (04/10/2026), shown and never chosen. |
| **U19** | **One Faktur and its faktur pajak may cover many Delivery Notes** (04/10/2026). The Faktur has its own typed Tanggal Faktur (journal date, not before the latest note); the faktur pajak's date and the due date (+ Termin) follow from the latest Tanggal Kirim. |
| **U20** | **The Faktur uses the Customer Order's PPN snapshot** (04/10/2026). |
| **U21** | **The Customer Order is finished when its delivery is finished** (04/10/2026): it closes itself once every line is fully delivered; billing comes after and a closed order is still billed. |
| **U22** | **Penjualan and Piutang Usaha come from Account Mapping**, one each, until C25 (04/10/2026). |
| **U10** | **The sales process keeps its tax without a Pajak menu** (03/10/2026). The Faktur stores its full, deducted and net figures, its tax date and Coretax number, and its deduction rows (`sal_invoice_advance_deduction`: AR item, dpp_used). Every output-tax figure is on a Uang Muka item or a Faktur; a Pajak menu, if ever built, reads them and owns nothing. Mirrors Accurate / SAP B1 / Odoo, where the down-payment record carries its tax and the final invoice records its own deduction; differs only in the advance's tax point being the receipt, as the law sets it (as SAP S/4HANA does). |

---

## 15. Appendix — full DBML and notation

### 15.1 Notation

| Notation | Meaning |
| --- | --- |
| `Table x { … }` / `Enum X { … }` | A table / a fixed list of values |
| `pk`, `increment` | Primary key, numbered automatically |
| `unique` | No two rows share the value |
| `not null` / `null` | Required / may be empty |
| `default: …` | Starting value |
| `note: '…'` | Explanation |
| `indexes { … }` | Kept sorted for fast lookup |
| `Ref: sal_delivery_order.customer_order_id > sal_customer_order.id
Ref: sal_delivery_order.warehouse_id > ref_warehouse.id
Ref: sal_delivery_order_line.delivery_order_id > sal_delivery_order.id
Ref: sal_delivery_order_line.sales_order_line_id > sal_order_line.id
Ref: a.x > b.id` | Many `a` rows point to one `b` row, enforced by the database |
| `[delete: cascade]` | Deleting the parent deletes these rows (only a Draft receipt's lines are ever replaced) |

Paste the block into <https://dbdiagram.io> to see it as a diagram. AR tables
are shown in the **agreed** shape (U1); the referenced master tables are
trimmed to the columns used.

### 15.2 DBML

```dbml
// ================================================================ values

Enum CustomerOrderStatus {
  Draft      // Draft
  Submitted  // Diajukan
  Open       // Open
  Closed     // Ditutup
  Cancelled  // Dibatalkan
  Rejected   // Ditolak
}

Enum SalesOrderStatus {
  Draft      // Draft
  Submitted  // Diajukan
  PreSO      // Pra-SO
  Open       // Open
  Closed     // Ditutup
  Cancelled  // Dibatalkan
  Rejected   // Ditolak
}

Enum DeliveryOrderStatus {
  Draft
  Issued
  Closed
  Cancelled
}

Enum PriceMode {
  Exclude
  Include
}

Enum DiscountType {
  Percent  // %
  Amount   // Nominal
}

Enum AdvanceStatus {
  Draft      // Draft
  Issued     // Diterbitkan
  Cancelled  // Dibatalkan
}

Enum AdvanceAmountType {
  Percent  // %
  Amount   // Nominal
}

Enum FlowDirection {
  In   // Penerimaan, BKM
  Out  // Pengeluaran, BKK
}

Enum CashBankTxStatus {
  Draft
  Posted
  Cancelled
}

Enum ArItemType {
  Advance  // Uang Muka
  Invoice  // Invoice
}

Enum ArDirection {
  Increase  // raises Piutang Usaha
  Decrease  // lowers Piutang Usaha
}

Enum ArEvent {
  Create       // Terbentuk
  Payment      // Pembayaran
  AdvanceUsed  // Dipakai Invoice
}

// ======================================================= Customer Order

Table sal_customer_order {
  id int [pk, increment, not null]
  order_no varchar [unique, not null, note: 'CO/YYYY/MM/NNNN']
  order_date date [not null]
  status CustomerOrderStatus [not null, default: 'Draft']
  customer_id int [not null]
  address_id int [not null]
  term_id int [not null]
  is_taxable boolean [not null, default: true]
  price_mode PriceMode [not null]
  ppn_rate decimal(9, 4) [null, note: 'snapshot']
  ppn_dpp_other_numerator int [null]
  ppn_dpp_other_denominator int [null]
  po_no varchar [null]
  po_date date [null]
  salesperson varchar [null]
  note varchar [null]
  gross_amount decimal(18, 2) [not null, default: 0]
  discount_amount decimal(18, 2) [not null, default: 0]
  dpp_amount decimal(18, 2) [not null, default: 0]
  dpp_other_amount decimal(18, 2) [not null, default: 0]
  ppn_amount decimal(18, 2) [not null, default: 0]
  total_amount decimal(18, 2) [not null, default: 0]
  status_reason varchar [null, note: 'why cancelled, rejected or closed']
  copied_from_id int [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    customer_id
    (status, order_date)
  }
}

Table sal_customer_order_line {
  id int [pk, increment, not null]
  order_id int [not null]
  line_no int [not null]
  item_id int [not null]
  uom_id int [not null]
  uom_factor decimal(18, 4) [not null]
  qty decimal(18, 4) [not null]
  price decimal(18, 2) [not null]
  discount_type DiscountType [null]
  discount_value decimal(18, 4) [null]
  discount_amount decimal(18, 2) [not null, default: 0]
  amount decimal(18, 2) [not null]
  dpp_amount decimal(18, 2) [not null]
  dpp_other_amount decimal(18, 2) [not null, default: 0]
  ppn_amount decimal(18, 2) [not null]
  withholding_tax_id int [null]
  withholding_rate decimal(9, 4) [null]
  note varchar [null]

  indexes {
    (order_id, line_no) [unique]
    item_id
  }
}

// ========================================================== Sales Order

Table sal_order {
  id int [pk, increment, not null]
  order_no varchar [unique, not null, note: 'SO/YYYY/MM/NNNN']
  order_date date [not null]
  delivery_date date [not null, note: 'Tanggal Kirim, what PPIC plans to']
  status SalesOrderStatus [not null, default: 'Draft']
  customer_order_id int [not null]
  customer_id int [not null]
  address_id int [not null]
  note varchar [null]
  status_reason varchar [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    customer_order_id
    (status, delivery_date)
  }
}

Table sal_order_line {
  id int [pk, increment, not null]
  order_id int [not null]
  line_no int [not null]
  customer_order_line_id int [not null, note: 'item and unit are read there']
  qty decimal(18, 4) [not null]
  note varchar [null]

  indexes {
    (order_id, line_no) [unique]
    (order_id, customer_order_line_id) [unique]
    customer_order_line_id
  }
}

// ======================================================= Advance bill

Table sal_advance {
  id int [pk, increment, not null]
  advance_no varchar [unique, not null, note: 'ARA/YYYY/MM/NNNN']
  advance_date date [not null]
  due_date date [not null]
  status AdvanceStatus [not null, default: 'Draft']
  customer_order_id int [not null]
  customer_id int [not null]
  cash_bank_id int [not null, note: 'rupiah bank printed as where to pay']
  description varchar [not null, note: 'Uraian, the printed line']
  note varchar [null]
  price_mode PriceMode [not null, note: 'copied from the order']
  is_taxable boolean [not null, note: 'copied from the order']
  ppn_rate decimal(9, 4) [null, note: 'snapshot']
  ppn_dpp_other_numerator int [null]
  ppn_dpp_other_denominator int [null]
  amount_type AdvanceAmountType [not null]
  amount_value decimal(18, 4) [not null, note: 'as typed']
  amount decimal(18, 2) [not null, note: 'value drawn, uses up the order room']
  dpp_amount decimal(18, 2) [not null]
  dpp_other_amount decimal(18, 2) [not null]
  ppn_amount decimal(18, 2) [not null]
  total_amount decimal(18, 2) [not null, note: 'DPP + PPN']
  cancel_reason varchar [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    customer_order_id
    customer_id
    (status, advance_date)
  }
}

// ============================================================ Receipt

Table sal_delivery_order {
  id int [pk, increment, not null]
  do_no varchar [unique, not null, note: 'DO/YYYY/MM/NNNN']
  do_date date [not null]
  delivery_date date [not null, note: 'when the goods are to leave']
  status DeliveryOrderStatus [not null, default: 'Draft']
  customer_order_id int [not null]
  customer_id int [not null]
  warehouse_id int [not null, note: 'one warehouse per Delivery Order']
  address_id int [not null]
  note varchar [null]
  status_reason varchar [null]
}

Table sal_delivery_order_line {
  id int [pk, increment, not null]
  delivery_order_id int [not null]
  line_no int [not null]
  sales_order_line_id int [not null, note: 'a line of an Open Sales Order of the same Customer Order']
  qty decimal(18, 4) [not null]
  note varchar [null]

  indexes {
    (delivery_order_id, sales_order_line_id) [unique]
  }
}

Table fin_cash_bank_tx {
  id int [pk, increment, not null]
  tx_no varchar [unique, not null, note: 'BKM/YYYY/MM/NNNN or BKK/…']
  direction FlowDirection [not null]
  purpose varchar [not null, note: 'purpose catalogue key: sales_advance']
  tx_date date [not null]
  status CashBankTxStatus [not null, default: 'Draft']
  partner_id int [not null]
  cash_bank_id int [not null]
  bank_ref varchar [null]
  note varchar [null]
  cash_amount decimal(18, 2) [not null, note: 'into the bank: lines cash less bank charge']
  bank_charge decimal(18, 2) [not null, default: 0]
  settled_amount decimal(18, 2) [not null, default: 0]
  pph_amount decimal(18, 2) [not null, default: 0]
  journal_id int [null]
  cancel_reason varchar [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    (direction, status, tx_date)
    partner_id
  }
}

Table fin_cash_bank_tx_line {
  id int [pk, increment, not null]
  tx_id int [not null]
  line_no int [not null]
  doc_type_id int [not null, note: 'weak link to the settled document']
  doc_id int [not null]
  settled_amount decimal(18, 2) [not null, note: 'cash for the document + its PPh']
  withhold boolean [not null, default: true, note: 'Potong PPh']
  dpp_part decimal(18, 2) [not null, default: 0]
  ppn_part decimal(18, 2) [not null, default: 0]
  pph_amount decimal(18, 2) [not null, default: 0]
  created_by int [not null]
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (tx_id, doc_type_id, doc_id) [unique]
    (doc_type_id, doc_id)
  }
}

Table fin_cash_bank_tx_line_wht {
  id int [pk, increment, not null]
  line_id int [not null]
  withholding_tax_id int [not null]
  rate decimal(9, 4) [not null]
  base_amount decimal(18, 2) [not null]
  amount decimal(18, 2) [not null]

  indexes {
    (line_id, withholding_tax_id) [unique]
  }
}

// ============================================ AR items (agreed shape, U1)

Table fin_ar_item {
  id int [pk, increment, not null]
  ar_item_no varchar [unique, not null, note: 'ARI/YYYY/MM/NNNN, month of item_date']
  item_type ArItemType [not null]
  direction ArDirection [not null]
  partner_id int [not null]
  currency_id int [not null]
  item_date date [not null, note: 'date of the posting that created it']
  due_date date [null, note: 'Invoice only']
  source_doc_type_id int [not null, note: 'the document the item is about']
  source_doc_id int [not null]
  source_no varchar [not null]
  customer_order_id int [null, note: 'weak: settlement scope']
  current_balance decimal(18, 2) [not null, note: 'sum of its ledger movements']
  tax_dpp decimal(18, 2) [null, note: 'own tax document (U9): Uang Muka = its Faktur Pajak Uang Muka']
  tax_dpp_other decimal(18, 2) [null]
  tax_ppn decimal(18, 2) [null]
  tax_invoice_no varchar [null, note: 'Coretax number, typed after upload']
  created_by int [not null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    (partner_id, item_type)
    customer_order_id
    (source_doc_type_id, source_doc_id)
  }
}

Table fin_ar_ledger {
  id int [pk, increment, not null, note: 'Buku Piutang, append-only']
  item_id int [not null]
  event ArEvent [not null]
  entry_date date [not null]
  amount decimal(18, 2) [not null]
  movement decimal(18, 2) [not null]
  balance_after decimal(18, 2) [not null]
  doc_type_id int [not null, note: 'the posting that caused it; on Create, the creator']
  doc_id int [not null]
  doc_no varchar [not null]
  counter_item_id int [null, note: 'the Invoice item that used an advance']
  note varchar [null]
  created_by int [not null]
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (item_id, entry_date)
    (doc_type_id, doc_id)
  }
}

// ================================ referenced tables, trimmed

Table m_partner {
  id int [pk]
  partner_label varchar
  partner_name varchar
}

Table m_partner_address {
  id int [pk]
  partner_id int
}

Table m_item {
  id int [pk]
  item_label varchar
  item_type varchar [note: 'Barang / Jasa']
  can_sell boolean
}

Table ref_uom {
  id int [pk]
  uom_label varchar
}

Table ref_warehouse {
  id int [pk, increment, not null]
  warehouse_label varchar [not null]
  warehouse_name varchar [not null]
}

Table ref_payment_term {
  id int [pk]
  due_days int
}

Table ref_withholding_tax {
  id int [pk]
  wht_label varchar [note: 'Jenis PPh']
  rate decimal(9, 4)
  prepaid_account_id int
}

Table m_cash_bank {
  id int [pk]
  cash_bank_label varchar
  currency_id int
}

Table ref_currency {
  id int [pk]
  currency_label varchar
}

Table sys_doc_type {
  id int [pk]
  doc_code varchar [unique]
  doc_table varchar [note: 'the table a doc id points into']
}

Table acc_journal {
  id int [pk]
  journal_no varchar
}

// ================================================================ refs

Ref: sal_customer_order.customer_id > m_partner.id
Ref: sal_customer_order.address_id > m_partner_address.id
Ref: sal_customer_order.term_id > ref_payment_term.id
Ref: sal_customer_order.copied_from_id > sal_customer_order.id
Ref: sal_customer_order_line.order_id > sal_customer_order.id
Ref: sal_customer_order_line.item_id > m_item.id
Ref: sal_customer_order_line.uom_id > ref_uom.id
Ref: sal_customer_order_line.withholding_tax_id > ref_withholding_tax.id
Ref: sal_order.customer_order_id > sal_customer_order.id
Ref: sal_order_line.order_id > sal_order.id
Ref: sal_order_line.customer_order_line_id > sal_customer_order_line.id
Ref: sal_advance.customer_order_id > sal_customer_order.id
Ref: sal_advance.customer_id > m_partner.id
Ref: sal_advance.cash_bank_id > m_cash_bank.id
Ref: fin_cash_bank_tx.partner_id > m_partner.id
Ref: fin_cash_bank_tx.cash_bank_id > m_cash_bank.id
Ref: fin_cash_bank_tx.journal_id > acc_journal.id
Ref: fin_cash_bank_tx_line.tx_id > fin_cash_bank_tx.id [delete: cascade]
Ref: fin_cash_bank_tx_line.doc_type_id > sys_doc_type.id
Ref: fin_cash_bank_tx_line_wht.line_id > fin_cash_bank_tx_line.id [delete: cascade]
Ref: fin_cash_bank_tx_line_wht.withholding_tax_id > ref_withholding_tax.id
Ref: fin_ar_item.partner_id > m_partner.id
Ref: fin_ar_item.currency_id > ref_currency.id
Ref: fin_ar_item.source_doc_type_id > sys_doc_type.id
Ref: fin_ar_ledger.item_id > fin_ar_item.id
Ref: fin_ar_ledger.counter_item_id > fin_ar_item.id
Ref: fin_ar_ledger.doc_type_id > sys_doc_type.id
```

### 15.3 What each index answers

| Index | Answers |
| --- | --- |
| sal_customer_order (customer_id), (status, order_date) | Orders of a customer; the order list |
| sal_order (customer_order_id) | Sales Orders of a Customer Order (its schedule, its close guard) |
| sal_order_line (customer_order_line_id) | Sudah di-SO of a Customer Order line |
| sal_advance (customer_order_id) | Bills of an order (its room) |
| sal_advance (customer_id) | Bills offered in Pilih Tagihan |
| fin_cash_bank_tx_line (doc_type_id, doc_id) | Which receipts paid a bill (its paid state) |
| fin_cash_bank_tx_line (tx_id, doc_type_id, doc_id) unique | A bill once per receipt |
| fin_ar_item (ar_item_no) unique | Find an item; no duplicate numbers |
| fin_ar_item (partner_id, item_type) | A customer's open invoices / advances |
| fin_ar_item (customer_order_id) | Advances an invoice may use |
| fin_ar_item (source_doc_type_id, source_doc_id) | Items of one bill / Faktur |
| fin_ar_ledger (item_id, entry_date) | Item history; balance as of a date |
| fin_ar_ledger (doc_type_id, doc_id) | What a posting did, including the items it created |
