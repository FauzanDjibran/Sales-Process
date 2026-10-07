# Kartu Stok and Saldo Stok — Plan

> Agreed and **built 07/10/2026** as `Claude-ERP.md` P135. The user's answers
> to §6: K1, K4, K5 as recommended; **K2 — no Kategori Item filter yet**; K3 —
> yes: grouped per warehouse, each warehouse has its own running balance, and
> the database keeps its running balance only per bucket (warehouse, lot,
> status), so the report works out each card's.

## 1. The two questions

The stock reports answer two questions, and nothing should make the user
work harder for either:

| | Question | Today |
| --- | --- | --- |
| **Q1** | *Barang ini ada di gudang mana?* — one item, across warehouses | Saldo Stok answers it, one block per item; Kartu Stok answers it only for one item at a time |
| **Q2** | *Di gudang ini ada barang apa saja?* — one warehouse, across items | Not answered: Saldo Stok filtered on a warehouse still groups by item, and Kartu Stok needs an item first |

Each question is asked twice: **as a position** (what stands there on a date —
Saldo Stok) and **as a history** (how it got there over a period — Kartu Stok).

## 2. What mainstream ERPs do

| ERP | Q1 — item → where | Q2 — warehouse → what | Movements |
| --- | --- | --- | --- |
| SAP | **MMBE Stock Overview**: one material, a tree company → plant → storage location → batch, quantity per stock type | **MB52 Warehouse Stocks**: per plant / storage location, every material in it | **MB51** document list; **MB5B** stock on a posting date — opening, receipts, issues, closing per material per plant |
| Odoo | Inventory › Reporting › Stock, **Group by Product** then Location (lots under) | the same list, **Group by Location** then Product | Moves History / Moves Analysis, groupable the same way |
| ERPNext | Stock Balance filtered on an item (one row per item × warehouse) | **Warehouse-wise Item Balance**; Stock Balance filtered on a warehouse | Stock Ledger, filter item and / or warehouse, running balance per item × warehouse |
| Accurate / Jurnal | Kartu Stok per barang (all or one gudang) | Laporan *Persediaan per Gudang* | Kartu Stok per barang per gudang |

**What they share:**

1. **The atom is item × warehouse.** Every one of them keeps the balance and
   the running card at that grain; lots / batches sit under it.
2. **The two questions are the same data grouped the other way round**, not
   two different reports (Odoo's group-by, SAP's MMBE / MB52 pair).
3. **Quantities of different items are never added up.** A warehouse total
   is a count of items, not a quantity — units differ.
4. **Value is not per warehouse when valuation is company-wide.** SAP values
   per plant, ERPNext per warehouse; where the valuation area is wider than
   the warehouse, a warehouse report shows quantity only.

## 3. The proposal: one switch, *Kelompokkan per Barang / per Gudang*

Both reports get the same third filter control, **Kelompok** — `Per Barang` |
`Per Gudang` — in the URL (`group=item|warehouse`), default `Per Barang`. It
does what the General Ledger's account blocks do: **one rolled-up block per
subject, its header carrying the totals, the detail one click away** (design
convention §6 *collapsible subject blocks*, §7.5).

The atom is the **card**: one item in one warehouse. Both groupings show the
same cards, nested the other way.

```
Per Barang (Q1)                         Per Gudang (Q2)
▸ BRG.0001  Krim Wajah 50 ml   PCS      ▸ GDG-BB   Gudang Bahan Baku    · 14 barang
    Σ 1.250                               ▸ BRG.0007  Asam Hialuronat  KG   82,5
  ├ GDG-FG   Gudang Barang Jadi  1.000    ▸ BRG.0009  Gliserin         L    40
  │   └ lots …                            …
  └ GDG-TR   Gudang Transit        250  ▸ GDG-FG   Gudang Barang Jadi   ·  6 barang
      └ lots …                            ▸ BRG.0001  Krim Wajah 50 ml PCS 1.000
```

### 3.1 Saldo Stok — the position on a date

Filter: **Barang** (chips, several or all) · **Gudang** (chips, several or
all) · **Kelompok** · **Per Tanggal**. (A Kategori Item filter was offered and
set aside — K2.)

**Per Barang (Q1)** — one block per item:

- **Header:** item code, name, unit, *n gudang · n lot*; summary strip
  **Jumlah** (the item's total — one unit, so it adds up).
- **Body:** one row per warehouse holding it, with its quantity; under each
  warehouse its lots (lot number, *ED* as a sub-line, status as a sub-line only
  when not *Tersedia*), earliest expiry first. Warehouse rows open on the
  block; lot rows fold under their warehouse.

**Per Gudang (Q2)** — one block per warehouse:

- **Header:** warehouse code, name, *n barang · n lot*. **No quantity total**
  (units differ, §2.3) — the count is the summary.
- **Body:** one row per item it holds — code, name, quantity with its unit —
  sorted by code; under each item its lots, folded.

**Both:** blocks start rolled up, with *Buka Semua / Tutup Semua* in the
result bar; a zero bucket is left out (as today). A warehouse chosen in the
filter but empty on the date still gets its block, reading *Tidak ada stok
per <tanggal>* (§7.8: a subject asked for is never silently missing).
**Drill-through (§7.7):** each item × warehouse row opens Kartu Stok for that
item and warehouse, period from the 1st of the as-of month to the as-of date.

### 3.2 Kartu Stok — the history over a period

Filter: **Barang** (chips, or all — no longer required) · **Gudang** (chips,
or all) · **Kelompok** · **Periode**.

The card is item × warehouse, so **its running balance is per item per
warehouse** — the figure a warehouse keeper can count and check. Today's
running balance across all warehouses goes away, because once transfers exist
(C34) a move between two warehouses reads as a pair that nets to nothing.

**Per Barang (Q1)** — one block per item:

- **Header:** strip *Saldo Awal · Masuk · Keluar · Saldo Akhir* for the item
  across the chosen warehouses (one unit, so it adds up).
- **Body:** one summary row per warehouse with the same four figures; opening
  it shows that card's movements — Tanggal, Entri (`MS/…·n` with the source
  document under it), Lot (ED under it), Masuk, Keluar, Saldo — between
  *Saldo awal per …* and *Saldo akhir per …*.

**Per Gudang (Q2)** — one block per warehouse:

- **Header:** *n barang · n mutasi*, **no quantity strip** (units differ).
- **Body:** one summary row per item — Saldo Awal, Masuk, Keluar, Saldo
  Akhir in its unit; opening it shows the same card as above.

**Both:** a card with an opening balance but no movement still appears, with
the in-table *Tidak ada mutasi* row (§7.8); a card with neither is left out.
The *Nilai* column leaves Kartu Stok: value is the pool's, per item, and has
its own card (Kartu Nilai Persediaan). The reconcile warning stays.

### 3.3 What does not change

- Kartu Nilai Persediaan and Nilai Persediaan stay per item, all warehouses —
  one pool per item company-wide (P120). They get no Kelompok switch.
- Both reports still read the ledger, never the balance tables, so a past
  date reports as it stood.
- No new table, no migration: the ledger already holds item, warehouse, lot
  and status on every row.

## 4. How it is built

1. **`stock-report.ts`** — one shape for both reports: a list of **cards**
   `{ item, warehouse, opening, in, out, closing, lots[] | entries[] }`, read
   with one `groupBy` on `log_stock_ledger` for the openings / positions and
   one `findMany` for the period's movements; grouping into blocks is done in
   the component, so the server answers both groupings the same way.
   Filters take id lists (`item=1,4`, `warehouse=2`), as the General Ledger's
   accounts do.
2. **`stock-report-params.tsx`** — Barang and Gudang become chip pickers
   (`subject-params.tsx`'s pattern); a segmented *Per Barang / Per Gudang*
   on the third row; Kartu Stok drops *Pilih Barang terlebih dahulu*.
3. **`stock-reports.tsx`** — `StockLedgerBody` and `StockBalanceBody` rebuilt
   as collapsible blocks with the GL's `ExpandAll`, `ReportSummary` and
   chevron rows; the drill from Saldo Stok to Kartu Stok.
4. **Tests** — the card figures (awal + masuk − keluar = akhir per card, the
   item total = Σ its cards), both groupings returning the same cards, the
   as-of position equal to the balance table, an empty chosen warehouse.
5. Checked in the browser with the showcase stock, both groupings, both
   reports, and the drill.

**Load:** with no filter, Kartu Stok reads every movement of the period. The
summary rows come from aggregates; the movements are loaded with them, as the
General Ledger does. If that grows heavy it joins §17's *lists send every
row* — movements loaded only when a card is opened is the next step, not now.

## 5. Recommendation

Build §3 as one change, both reports together, so the switch means the same in
both. Q2 is the gap today; Q1 improves by showing warehouses as rows rather
than repeating them on every lot.

## 6. Open points for the user

| # | Question | Recommended |
| --- | --- | --- |
| K1 | Show a **value per warehouse** in Saldo Stok (qty × the item's average)? It is an estimate: the pool is per item company-wide (P120), and P114 says the average is never multiplied. | **No** — value stays in Nilai Persediaan, per item |
| K2 | Add a **Kategori Item** filter to both reports? | **Yes** — Q2 is usually asked per kind of goods |
| K3 | Kartu Stok **running balance per item × warehouse** (replacing today's across all warehouses)? | **Yes** |
| K4 | Saldo Stok's **lots folded** under their warehouse / item row by default? | **Yes** — open with the row's chevron or *Buka Semua* |
| K5 | Drop the **Nilai** column from Kartu Stok? | **Yes** — Kartu Nilai Persediaan carries it |
