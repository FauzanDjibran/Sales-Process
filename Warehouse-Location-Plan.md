# Lokasi Gudang — Plan

> Draft 07/10/2026, for the user to agree; L5 and L6 answered 07/10/2026. Nothing is built until the open
> points (§8) are answered; then it becomes a decision in `Claude-ERP.md` §12.

## 1. The request

A warehouse carries a switch: **does it keep stock by location?**

- **No** — stock sits in the warehouse; every stock row's location is
  **empty (null)**, as today.
- **Yes** — the warehouse has its own locations in **`ref_warehouse_location`**,
  and **every stock row in that warehouse must name one of them**.

P120 left `location_id` out of the stock books "until its master exists"; this
is that master.

## 2. What mainstream ERPs do

| ERP | Shape |
| --- | --- |
| SAP | Plant → storage location → (with WM / EWM) **storage bin**. Bins are switched on per warehouse number; a plant without WM keeps stock at storage location only |
| Odoo | Warehouse → **locations** (a tree). *Storage Locations* is a setting; without it, everything is the warehouse's stock location. Every quant names a location |
| ERPNext | Warehouses are themselves a tree (a "bin" is just a child warehouse); no separate location |
| Dynamics 365 BC | **Bins** switched on per Location by *Bin Mandatory*; when on, every movement must name a bin |

**Ours matches Dynamics' *Bin Mandatory* and SAP's per-warehouse switch**: the
warehouse decides, and when it says yes the location is required everywhere
stock moves. A flat list per warehouse (no tree) is the simple start; Odoo's
tree can come later if ever needed.

## 3. The master

**`ref_warehouse.use_location`** — Boolean, default false, shown on the Gudang
form as **Gunakan Lokasi** (Ya / Tidak).

**`ref_warehouse_location`** — the warehouse's locations:

| Column | Note |
| --- | --- |
| `id` | |
| `warehouse_id` | FK → `ref_warehouse` |
| `location_code` | system code `loc.NNNN`, generated |
| `location_label` | e.g. `A-01-03`; **unique within its warehouse** |
| `location_name` | e.g. *Rak A, baris 1, level 3* — **required** (L6) |

**How a location reads (L6):** its own label is stored short (`A-01-03`), and
everywhere it is shown — pickers, documents, reports — it reads **`<warehouse
label>-<location label>`**, e.g. **`GD-CKR-A-01-03`**, with its name beside it
where there is room. The composed label is built in one place (a client-safe
`locationDisplayLabel(warehouseLabel, locationLabel)`), never stored, so
relabelling a warehouse relabels its locations.
| `status` | Active / Inactive — never deleted (§2 rule 11) |
| `note`, `created_*`, `updated_*` | as every master |

**Where it is kept:** a **Lokasi** tab on the Gudang form (P38), shown only when
Gunakan Lokasi is Ya, listing the locations and adding / changing one in a
panel dialog — the Item's *Konversi Satuan* pattern; saved with the warehouse,
one transaction, one audit entry. A location that ever held stock cannot be
removed from the tab, only deactivated.

**Rules:**

1. **The switch is decided before stock arrives.** Gunakan Lokasi **cannot be
   changed while the warehouse holds any stock** (any non-zero bucket) or has a
   **Draft** Receipt Note / Delivery Note — otherwise rows already in the books
   would break the rule in one direction or the other. An empty warehouse may
   switch freely. *(Open point L1.)*
2. **Yes needs at least one active location** to be saved.
3. **A location cannot be deactivated while it holds stock.**
4. A deactivated warehouse location is no longer offered; stock already in it
   still reads it.

## 4. The stock books

`location_id Int?` (FK → `ref_warehouse_location`) is added to:

- `log_stock_ledger` and `log_stock_balance` — the bucket becomes
  **warehouse · location · lot · status**;
- `log_receipt_note_lot` — where each received lot is put;
- `log_delivery_note_lot` — where each picked lot is taken from.

The valuation books (`log_stock_valuation_*`) **do not change**: value is one
pool per item, company-wide (P114, P120).

**The bucket key with a null.** Postgres treats nulls as distinct in a unique
index, so `@@unique([warehouse_id, location_id, tracking_id, stock_status_id])`
would let two "no location" buckets of one lot exist. The migration replaces
the unique key with **`UNIQUE NULLS NOT DISTINCT`** (PostgreSQL 15+, we run 18),
written by hand in the migration SQL since Prisma cannot express it (the
schema notes it beside an `@@index` on the same columns). `inventory.ts`'s
`lockBucket` already creates a bucket with raw `INSERT … ON CONFLICT (key) DO
NOTHING` and locks it with `SELECT … FOR UPDATE`; it adds `location_id` to the
conflict key (a `NULLS NOT DISTINCT` index is a valid arbiter) and matches it
with `IS NOT DISTINCT FROM`, so the no-location bucket is still one row.

**Enforced in one place — `inventory.ts`**, the only writer (§14):
`receiveStock` and `issueStock` take `locationId: number | null`, and refuse
- a null location in a warehouse with Gunakan Lokasi (*Gudang X memakai lokasi:
  pilih lokasinya.*);
- a location in a warehouse without it, or one of another warehouse, or an
  inactive one for a receipt.

A **CHECK** cannot read the warehouse, so the database adds a FK and the
module enforces the rule; `db:reconcile` gains a check: *no stock row in a
location warehouse without a location, none with a location elsewhere, every
location belonging to its row's warehouse.*

**Existing data:** every warehouse starts with Gunakan Lokasi = Tidak and every
existing row keeps `location_id` null, so nothing is migrated. Because the
switch cannot turn on while stock is held (rule 1), no old row ever lands in a
location warehouse without a location.

## 5. Documents that move stock

| Document | Change |
| --- | --- |
| **Receipt Note** (stock in) | Each **lot row** gets a **Lokasi** picker when the note's Gudang uses locations (*Pilih Lokasi…*; *Pilih Gudang dulu…* before one is chosen). One lot may be split over several rows in different locations. Required to post; refused at save if it is of another warehouse. Changing the note's Gudang clears the locations |
| **Delivery Note** (stock out) | A **pick becomes a lot in a location** — the bucket. *Pilih Lot* lists lot × location with what each holds, earliest expiry first, then location label; *Isi FEFO* fills in that order. Unique pick key becomes `(line, lot, location)`. Posting refuses short stock naming lot, location and both figures |
| **Injection** (`db:stock-inject`) | The CSV gets a `location` column (the location label); required for a location warehouse, refused otherwise |
| Delivery Order, Purchase Request, Purchase Order | **No change** — they name a warehouse, never a location. Where in the warehouse is decided when the goods physically move |

`lotOptions` returns buckets with their location; the Draft-takes-no-stock rule
(§17) is unchanged.

## 6. Reports

**Location is a column inside the grouping (L5)**, not a grouping of its own.
The blocks and rows stay as P135 built them (item × warehouse cards); the
location sits on the detail rows, read as `GD-CKR-A-01-03` (§3), and `—` for a
warehouse without locations.

- **Saldo Stok, Per Barang** — block = item, row = warehouse; the folded rows
  under a warehouse are its buckets with columns **Lokasi · Lot · Kadaluarsa ·
  Jumlah**, sorted by location, then expiry. A lot spread over two locations
  is two rows.
- **Saldo Stok, Per Gudang** — block = warehouse, row = item; the folded rows
  under an item carry the same columns, the **Lokasi** column reading
  *warehouse-then-location* (`GD-CKR-A-01-03`).
- **Kartu Stok** (both groupings) — each movement gets a **Lokasi** column
  between Entri and Lot. The running balance stays per item × warehouse
  (P135).
- No *Per Lokasi* grouping in Kelompok.
- Kartu Nilai Persediaan and Nilai Persediaan: unchanged.

## 7. Order of work

1. Migration: `use_location`, `ref_warehouse_location`, `location_id` on the
   four tables, the `NULLS NOT DISTINCT` bucket key; DBML in step; permissions
   ride on the Gudang master's.
2. Master: Gunakan Lokasi field and the Lokasi tab; rules 1–4.
3. `inventory.ts`: location in the bucket, the refusals; reconcile check.
4. Receipt Note, Delivery Note, injection.
5. Reports.
6. Tests (receive / issue with and without location, the refusals, the switch
   guard, a lot over two locations, the null bucket being one bucket), browser
   walk-through on a location warehouse and a plain one.

**Not in this step:** moving stock between locations (a transfer, C34), a
location tree / zone, capacity, a default putaway location.

## 8. Open points

| # | Question | Recommended |
| --- | --- | --- |
| L1 | May Gunakan Lokasi change on a warehouse **that holds stock**? | **No** — only while empty and with no Draft note; otherwise stock rows would break the rule. (Alternative: allow turning on by moving all stock into a chosen default location in one step — more work, and a transfer in disguise) |
| L2 | Locations **flat per warehouse**, or a tree (zone → rack → bin)? | **Flat** now; the label can carry the structure (`A-01-03`) |
| L3 | On the Receipt Note, location **per lot row** (a lot may be split) or one per line? | **Per lot row** |
| L4 | Table name: `ref_warehouse_location` (reference-master prefix, as `ref_warehouse`), or exactly `warehouse_location`? | **`ref_warehouse_location`** |
| L5 | Add **Per Lokasi** grouping to Saldo Stok now? | **Decided:** no grouping — Lokasi is a column inside the existing groupings (§6) |
| L6 | Location name: optional, or required like a warehouse's? | **Decided:** required; the location has its own code, label and name, and reads `<warehouse label>-<location label>` (§3) |
