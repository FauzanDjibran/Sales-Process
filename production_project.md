# Production — Workstations, Production Ledger and Month-End Costing

> **Status: the full plan, 08/10/2026. Phase 0 is complete** — every question
> is answered (§20, M1–M51; §21 records the last two). **Nothing is built
> until the user approves this plan**; it then becomes decision P150 in
> `Claude-ERP.md` §12 (§23).
>
> **Sources.** The user's goals of 08/10/2026 (§1), `month_end_costing_v2.md`
> (§2) and, as added context checked against the plan,
> `D:\Claude Code\production_3.0_makloon_concept.md` (§3).

**Contents.** 1 Goals · 2 The costing doc · 3 The makloon concept · 4
Vocabulary · 5 The flow, with a worked example · 6 Engines · 7 Data model · 8
Masters and settings · 9 Documents · 10 The month-end close · 11 Reports · 12
Controls · 13 Menu and permissions · 14 Numbering · 15 Changes to what exists ·
16 Edge cases · 17 Tests · 18 Build steps · 19 Out of scope · 20 Decisions ·
21 The last two answers · 22 Known limits · 23 After approval

---

## 1. The user's goals

| # | Goal |
| --- | --- |
| G1 | **Actual costing, never standard cost.** |
| G2 | **During production only material cost is carried.** Labour and overhead are known only at month end. |
| G3 | **Cost in = cost out.** 100 kg worth Rp10 jt in, 90 kg out → the 90 kg is worth Rp10 jt. Loss has no value of its own; it stays in the good output. |
| G4 | FG come out of production still at the material value, and are sold at it during the month. |
| G5 | **Month end:** labour and overhead collected in their own cost ledger **raise FG value and COGS of that month**, **never WIP**: what is inside production stays material only. |
| G6 | The cost ledger is **emptied** at month end. A list says which expenses are production cost and which accounts they use. |
| G7 | The month's production and expense are separated by the **fiscal period**. |
| G8 | **Cost is global**, not per workstation. |
| G9 | **Workstations are master data**, never hard-coded. |
| G10 | **No BoM** in v1: input and output are declared by hand. |
| G11 | **Each workstation has its own production orders**; no global order. Orders meet only through input and output. |
| G12 | A **Stock Issue** moves an item from the stock ledger into the **production ledger**, which stands on its own and does not follow the stock moving average. |
| G13 | A **Batch** traces where an item went (M22). |
| G14 | The **execution** has an **input side and an output side**; cost in = cost out. |
| G15 | Items can be **taken out of production** — waste, low-tier output, and **FG back to the stock ledger**. |

---

## 2. The costing doc (`month_end_costing_v2.md`)

**Kept:** material at the cost known at posting is a valid cost; month end
adds only what was missing; the adjustment is a new document; periodic
weighted average settles COGS and ending stock; the cost pool closes at zero;
normal loss stays in the good output; mid-month estimates are never posted.

**Left out by the goals:** cost per workstation (G8); WIP's share of
conversion cost (G5, M4); normal-capacity rule (M5); BOM cascade (G10); sales
returns at original cost (later, with Nota Retur); pro-forma margin (later).

**Adapted to this ERP:** the close **posts a journal** (Nilai Persediaan must
equal the GL, P120); backdating stays until a period is costed, then locked
(M32); no re-run — dry-run preview, then one permanent posting (M33); stock
keeps its moving average (P114), production has its own book (G12).

---

## 3. The makloon concept — checked and agreed

Material → Staging → Issue → **Pengolahan** (raw material → bulk) →
**Pengemasan** (bulk + packaging → FG); **Batch = production identity, Lot =
inventory identity**; genealogy both ways.

| Concept | In this plan |
| --- | --- |
| Batch ≠ Lot | M22: lot = stock identity (also inside production), batch carried on top |
| Issue ≠ Consume, no backflush | The Stock Issue only places material in production; an execution's input side consumes it |
| Many material lots → one processing run | An execution takes many input lots |
| One processing batch → many packaging runs | A bulk lot is taken in parts; each output carries the batch (M11, M41) |
| Packaging material joins the bulk | Un-batched inputs join without changing the batch (M41) |
| Bulk waits between stages | In production, or in stock with its batch kept (M45) — stock bulk takes no month-end cost (M46) |
| Staging | No separate step in v1; the Stock Issue is the hand-over (M44) |
| Pengolahan ≠ Pengemasan | Workstations the user names; no typed stage (M47) |
| Makloon business facts | Brand-owner material and a batch made for a Customer Order: out of v1 except an optional Customer Order reference on the batch (M48) |

---

## 4. Vocabulary

| Term | Meaning |
| --- | --- |
| **Workstation** | A place where a transformation happens, created by the user (G9). |
| **Production ledger** | The book of what is inside production: quantity and value per lot per workstation. Its value is the **WIP** account. |
| **Lot** | The stock identity of a quantity of one item (P120). A stock lot keeps its number when issued into production; each execution output is a **new lot**; an FG received to stock keeps its lot number (M11, M22). |
| **Bucket** | One lot at one workstation in the production ledger — the unit that holds Q and V. A lot issued to two workstations is two buckets. Buckets are never pooled with one another (G12). |
| **Position** | The workstation of a bucket: where it was issued to or produced. Any execution may take from any bucket (M2). |
| **Batch** | The production identity of one production run, carried on top of lots from the run that starts it to the FG (M22, M41). |
| **Genealogy** | Edges input bucket → output lot (qty, value) per execution, plus stock lot → production lot and production lot → stock lot. |
| **Cost element** | A Control Account whose every line is production cost, with its group (M9, M39, M40). |
| **Cost ledger** | The append-only book of production cost, one dated row per cost booked or moved (M3, M23). |
| **Common cost unit** | *Satuan Pembebanan Biaya* (e.g. KG), the unit cost is shared in (M26). |
| **Costed period** | A fiscal period whose Penutupan Biaya Produksi is posted; locked for stock, production and cost postings (M32). |

---

## 5. The flow

```
 STOCK (inventory.ts, MAC per item)            PRODUCTION (production-ledger.ts, Q/V per bucket)
 RM lot RM-01 ── Pengeluaran ke Produksi ─────▶ bucket RM-01 @ WS-OLAH        Dr WIP / Cr Persediaan
 (issueStock at MAC)                                │
                                Eksekusi @ WS-OLAH: in RM-01 (+RM-02 …) → out lot BLK-1 [batch BT-1 starts]
                                                    │
 PK lots (botol, tutup) ─ Pengeluaran ke Produksi ─▶ buckets @ WS-KEMAS
                                Eksekusi @ WS-KEMAS: in BLK-1 (part) + PK → out lot FG-1 [BT-1 carried]
                                Eksekusi @ WS-KEMAS: in BLK-1 (rest) + PK → out lot FG-2 [BT-1 carried]
                                                    │
 FG lot FG-1 [BT-1] ◀── Penerimaan Hasil Produksi ──┘                      Dr Persediaan / Cr WIP
 (receiveStock at the bucket's value)
      │ Delivery Note → HPP at MAC
      ▼
 Penutupan Biaya Produksi (fiscal period): cost-ledger rows of the period
   → Barang Jadi received from production in the period, by KG
   → per item: outflow share Dr HPP, ending share Dr Persediaan (value-only row) / Cr cost elements
```

### 5.1 Worked example (the costing doc's figures)

1.100 kg RM Rp11,0 jt issued to WS1; WS1 → WS2 → WS3 → WS4; 100 kg left at
WS1; 300 kg normal loss; 700 kg FG received, 200 kg sold; cost ledger Rp9,0 jt;
no opening stock.

| (Rp jt) | During the month | Close | Settled |
| --- | --- | --- | --- |
| COGS 200 kg | 2,857 | 9,0 × 200/700 = **2,571** | 5,429 |
| FG on hand 500 kg | 7,143 | 9,0 × 500/700 = **6,429** | 13,571 (Rp27.143/kg) |
| WIP WS1 100 kg | 1,000 | **0** (G5) | 1,000 |
| **Total** | 11,000 | **9,000** | 20,000 |

Journal of the close: Dr HPP 2.571.429 · Dr Persediaan Barang Jadi 6.428.571 /
Cr cost elements 9.000.000 (rounded half up, largest remainder).

---

## 6. Engines

An engine is a book or pure kernel that documents call; a book imports only
the shared kernel (`Claude-ERP.md` §3.1).

### E1 Stock books — `inventory.ts` (built; extended)

| Contract | Change |
| --- | --- |
| `receiveStock(tx, r)` | Takes optional `batch: { id, no }`, stored on a lot when it is first created; a lot already known with another batch is refused. Refuses a date in a **costed period** (`holdCostingPeriod`, E8). |
| `issueStock(tx, i)` | Returns the lot's batch beside its cost. Refuses a costed period. |
| **`revalueStock(tx, { itemId, value, date, source, actorId })`** — new | Adds a whole-rupiah value to an item's pool with **qty 0**: one `log_stock_valuation_ledger` row (qty_change 0, unit_cost null, value_balance and average after); refuses when the pool's Q = 0 or the result would be negative; locks the pool. No quantity-ledger row. |
| **`poolMovements(tx, itemIds, from, to)`** — new read | Per item: Q at `from`'s opening, Σ inflow qty and Σ outflow qty in the range, and Q now — from the valuation ledger. |

**Amends P120's invariant:** Σ value over the quantity ledger = Σ value over
the valuation ledger **less the revaluation rows**; the reconcile is changed to
match (§12).

### E2 Production ledger — `production-ledger.ts` (new book)

| Contract | Does |
| --- | --- |
| `enterProduction(tx, { itemId, lotNo, batch?, expiry, workstationId, qty, value, date, source, actorId })` | Finds or creates the production lot (item + lot no), finds or creates its bucket at the workstation, adds Q and V. Used by the Stock Issue. |
| `takeFromBucket(tx, { bucketId, qty, date, source, actorId })` → `{ value }` | Releases `round(V × q ÷ Q)`, or V when it empties the bucket (M11); refuses short quantity; locks the bucket. Used by an execution's inputs, Penerimaan Hasil Produksi and Pemusnahan. |
| `produce(tx, { executionId, inputs, outputs, batch, … })` | Inside an execution's posting: takes every input, shares Σ value over the outputs (E6), creates each output lot and its bucket at the execution's workstation, writes genealogy and batch. Refuses an output lot number already known for the item (M42). |
| Reads | `bucketsAvailable(filters)`, `bucketCard(id, range)`, `wipAsOf(date)`, `trace(lot or batch, direction)` |

Rows locked `FOR UPDATE` in bucket-id order; stock pools are always locked
before buckets (§16 X23). Ledger number `MP/YYYY/MM/NNNN` per posting (P110).

### E3 Batch and genealogy — part of E2

`startBatch(tx, { no?, date, executionId, parents[], customerOrder? })` and
the carry rule of M41, evaluated in `produce`.

### E4 Cost ledger — `production-cost.ts` (new book)

| Contract | Does |
| --- | --- |
| `recordCost(tx, { accountId, amount, date, source, note, actorId })` | One *Masuk* row (amount may be negative for a correction); refuses an account that is not an active element, and a costed period. |
| `costOfPeriod(tx, from, to)` | Rows dated in the range, per element, incl. a *Dibawa Masuk* row. |
| `absorbPeriod(tx, …)` / `carryPeriod(tx, …)` / `expensePeriod(tx, …)` | The close's rows: *Dibebankan*, *Dibawa Keluar* + *Dibawa Masuk* (dated the next period's first day), *Dibebankan ke Laba Rugi*. |
| `isCostElement(accountIds)` | For the guards of §15. |

Ledger number `BBP/YYYY/MM/NNNN` per posting.

### E5 Costing arithmetic — `production-costing.ts` (pure, client-safe)

`computeCostClose({ cost, items: [{ itemId, receivedKg, available, out, poolQtyNow }] })`
→ per item `share`, `outflowShare`, `endingShare`, `endingToCogs` (M29); all
whole rupiah, largest remainder (M30). Used by the preview and the posting.

### E6 Execution arithmetic — `production-execution.ts` (pure, client-safe)

`shareExecutionValue(totalValue, outputs[{ weight }])` → values, largest
remainder; `susutInCostUnit(inputs, outputs, conversions)`; the batch rule's
outcome for the form (`batchOutcome(inputBatches, newBatchTicked)`).

### E7 Journal (built) — unchanged. The manual journal already refuses a Control Account, which M39 relies on.

### E8 Fiscal periods (built; extended)

`acc_fiscal_period.costed_at / costed_by / cost_close_id`;
`holdCostingPeriod(tx, date)` refuses a date in a costed period (called by
E1, E2, E4 — so every stock, production and cost movement is covered at one
place each); the year-close checklist gains *Biaya produksi periode terakhir
sudah ditutup* (M35, §10.4).

### E9 Numbering, audit, record history (built) — new prefixes (§14).

### E10 Reconcile (built, 54 checks) — new checks (§12).

---

## 7. Data model

Conventions as `Claude-ERP.md` §9: `Int` keys, `created_by / updated_by /
created_at / updated_at`, money `Decimal(18,2)` whole rupiah, quantities
`Decimal(18,6)` in base units, dates `@db.Date`. Weak references
`(doc_type_id, doc_id, no)` across modules.

### 7.1 Masters and settings

| Table | Columns |
| --- | --- |
| `ref_workstation` | `workstation_code` (`ws.NNNN`), `workstation_label` (unique), `workstation_name`, `note`, `status` |
| `acc_production_cost_element` | `account_id` (unique, FK), `element_group` (enum `DirectLabor`, `IndirectLabor`, `Utility`, `Depreciation`, `Maintenance`, `OtherOverhead`), `note`, `status` |
| `sys_setting` keys | `production.cost_uom_id` (Satuan Pembebanan Biaya); Account Mapping keys `production.wip_account_id`, `production.scrap_expense_account_id` |
| `acc_fiscal_period` + | `costed_at`, `costed_by`, `cost_close_id` |
| `log_stock_tracking` + | `batch_id Int?`, `batch_no String?` (weak; production's batch) |

### 7.2 Production ledger (E2, E3)

| Table | Columns |
| --- | --- |
| `prd_batch` | `batch_no` (unique), `batch_date`, `start_execution_id`, `customer_order_id?` / `customer_order_no?` (weak, information, M48), `note` |
| `prd_batch_parent` | `batch_id`, `parent_batch_id` — set when *Batch Baru* merges batches (M41) |
| `prd_lot` | `item_id`, `lot_no`, unique (`item_id`, `lot_no`); `batch_id?`; `expiry_date?`; `origin` (`Issued` / `Produced`); `source_doc_type_id / _id / _no` (first creator) |
| `prd_balance` (bucket) | `lot_id`, `workstation_id`, unique together; `item_id`, `qty`, `value`; CHECK qty ≥ 0, value ≥ 0, qty = 0 ⇒ value = 0 |
| `prd_ledger` | `ledger_no`, `line_no`, `posting_date`, source triple, `bucket_id`, `lot_id`, `workstation_id`, `item_id`, `qty_change`, `qty_balance`, `value_change`, `value_balance`, `unit_cost` (description only) |
| `prd_lot_link` | `execution_id`, `from_bucket_id`, `from_lot_id`, `to_lot_id`, `qty`, `value` (genealogy inside production) |

Stock ↔ production links are read from the documents' own lines (issue line:
stock lot → production lot; receipt line: production lot → stock lot), so the
books stay unaware of each other.

### 7.3 Cost ledger (E4)

| Table | Columns |
| --- | --- |
| `prd_cost_ledger` | `ledger_no`, `line_no`, `posting_date`, source triple, `account_id`, `element_group` (copied), `kind` (`In`, `Absorbed`, `CarriedOut`, `CarriedIn`, `ExpensedToPL`), `amount` (signed: + in, − out), `note` — append-only, **no period column** (M23) |

### 7.4 Documents

| Table | Key columns |
| --- | --- |
| `prd_order` | `order_no`, `order_date`, `workstation_id`, `status` (`Draft`, `Open`, `Closed`, `Cancelled`), `status_reason`, `note` |
| `prd_order_plan` | `order_id`, `item_id`, `base_qty`, `note` (information) |
| `prd_execution` | `execution_no`, `execution_date`, `order_id`, `workstation_id` (copied), `batch_id?` (set at posting), `new_batch` (bool), `batch_no_requested?`, `customer_order_id? / _no?` (only when a batch starts), `status` (`Draft`, `Posted`, `Cancelled`), `status_reason`, `note`, `total_value` (posted) |
| `prd_execution_input` | `execution_id`, `bucket_id`, `lot_id`, `item_id`, `base_qty`, `value` (posted) |
| `prd_execution_output` | `execution_id`, `item_id`, `base_qty`, `lot_no`, `expiry_date?`, `cost_weight` (Bobot Biaya), `value` (posted), `lot_id` (posted) |
| `log_production_issue` | `issue_no`, `issue_date`, `warehouse_id`, `workstation_id`, `status` (`Draft`, `Posted`, `Cancelled`), `status_reason`, `note`, `journal_id` |
| `log_production_issue_line` / `_lot` | line: `item_id`, `uom_id`, `uom_factor`, `qty`, `base_qty`, `value`; lot: `line_id`, `stock_lot_id`, `lot_no`, `location_id?`, `base_qty`, `value`, `prd_lot_id`, `bucket_id` (posted) |
| `log_production_receipt` | `receipt_no`, `receipt_date`, `warehouse_id`, status set as above, `note`, `journal_id` |
| `log_production_receipt_line` | `bucket_id`, `prd_lot_id`, `item_id`, `lot_no`, `batch_no?`, `expiry_date?`, `location_id?`, `base_qty`, `value` (posted), `stock_lot_id` (posted) |
| `log_production_scrap` / `_line` | header as above + `reason`; line: `bucket_id`, `prd_lot_id`, `item_id`, `base_qty`, `value` (posted) |
| `prd_cost_entry` / `_line` | header: `entry_no`, `entry_date`, `contra_account_id`, `partner_id?` (when the contra requires one), `description`, status set, `journal_id`; line: `account_id` (element), `direction` (`Cost` / `Correction`), `amount`, `note` |
| `prd_cost_close` | `close_no`, `fiscal_period_id` (unique), `close_date` (period end), `cost_total`, `carried_in`, `outcome` (`Absorbed`, `Carried`, `ExpensedToPL`, `Empty`), `journal_id?`, `note` |
| `prd_cost_close_element` | `close_id`, `account_id`, `amount` |
| `prd_cost_close_item` | `close_id`, `item_id`, `received_cost_qty`, `share`, `available_qty`, `out_qty`, `end_qty`, `outflow_share`, `ending_share`, `ending_to_cogs` (bool), `cogs_account_id`, `inventory_account_id` |

Each document also gets its `sys_doc_type` row and `DBML/erp.dbml.md` is
updated with every migration.

---

## 8. Masters and settings

| Thing | Where | Rules |
| --- | --- | --- |
| **Workstation** | Master › Entitas, registry entity (as Gudang) | Label unique; deactivated, never removed; one in use by an Open order or holding a bucket cannot be deactivated |
| **Elemen Biaya Produksi** | Accounting › Pengaturan, list with a panel dialog | Account must be **postable, active, of an expense type, a Control Account** (M39), not used by Account Mapping or a Jenis PPh (§15.4); an account with posted lines not in the cost ledger cannot become one (it would break §12 check 5) |
| **Account Mapping › Produksi** | existing screen, new card | *Account Persediaan Barang Dalam Proses (WIP)* (postable, asset), *Account Beban Pemusnahan Produksi* (postable, expense, not an element) |
| **System Default › Produksi** | existing screen, new card | *Satuan Pembebanan Biaya* — a Satuan (seed suggests KG, not set) |
| **Item** | existing | **No new flag** (M51): an output takes any Barang with Kelola Stok; month-end cost goes by Kategori *Barang Jadi* (M46). Further item / production categorisation comes later |
| **Starter accounts** (`db:seed-accounts`, P130) | additive, matched on name | Persediaan Barang Dalam Proses; Beban Pemusnahan Produksi; cost elements as Control Accounts — Biaya Tenaga Kerja Langsung, Biaya Tenaga Kerja Tidak Langsung, Biaya Listrik & Utilitas Pabrik, Biaya Penyusutan Mesin & Pabrik, Biaya Pemeliharaan Mesin, Biaya Overhead Pabrik Lain — registered as elements; contra accounts Hutang Gaji & Upah, Akumulasi Penyusutan Mesin, when missing |

---

## 9. Documents

Every document: Draft → *Posting* → Posted (final) unless stated; *Batalkan*
Draft only, with a reason; Posting is one transaction under the period hold
and the costing hold; the confirmation shows the journal by dry run (P103);
`RecordHistoryCard` last; audit events per step.

### 9.1 Perintah Produksi — `prd_order`, `SPK/…` (Produksi › Operasi)

- **Header card:** Workstation (picked once, locked), Tanggal, Catatan.
- **Tab *Rencana Output*** (optional): item + quantity, information only.
- **Lifecycle:** Draft → *Buka* → Open → *Tutup* (reason) → Ditutup;
  *Batalkan* (Draft). *Tutup* refused while a Draft execution sits under it.
- **Page:** its executions (number, date, batch, input / output value), linked.
- **Permissions:** `PRODUCTION_ORDER_VIEW / _CREATE / _EDIT / _OPEN / _CLOSE / _CANCEL`.

### 9.2 Eksekusi Produksi — `prd_execution`, `LHP/…` (Produksi › Operasi)

- **Header card:** Perintah Produksi (Open; picked once, locked; its
  workstation shown), Tanggal (not before the order's), Catatan; **Batch**
  shown as the rule decides it (M41): *akan dimulai* (new number, editable),
  *BT/… dilanjutkan*, or *refused — campuran batch BT/… dan BT/…*; a
  **Batch Baru** switch; Customer Order (reference) when a batch starts.
- **Input side:** *Pilih Input* opens every bucket with quantity in production
  — lot, item, batch, workstation (position), qty, value, expiry — filterable
  by workstation, item, batch; each picked bucket takes a quantity ≤ its
  balance. Value is shown as an estimate and fixed at posting.
- **Output side:** rows of item (Barang, Kelola Stok), quantity with unit (the
  item's units, P82), lot number (generated `<LHP no>-<n>` at first save,
  editable), expiry (required when the item has one), **Bobot Biaya**
  (default: quantity in the common cost unit, else base quantity — M43; 0
  allowed).
- **Balance strip:** Total input value · Total output value (equal by
  construction) · input and output in the common unit · **Susut** (M14).
- **Validation:** at least one input and one output (M15); Σ Bobot Biaya > 0;
  each output lot number unique for its item and not used anywhere (M42); the
  batch rule satisfied; a Draft reserves nothing.
- **Posting:** `produce` (E2) — no journal (WIP → WIP).
- **Layout (M50, P38):** header card with the balance strip, then two tabs —
  **Input** and **Output**, each with its row count and an error marker — then
  the record history. The strip shows both totals whichever tab is open.
- **Permissions:** `PRODUCTION_EXECUTION_VIEW / _CREATE / _EDIT / _POST / _CANCEL`.

### 9.3 Pengeluaran ke Produksi — `log_production_issue`, `SI/…` (Persediaan › Operasi Gudang)

- **Header card:** Gudang (source), Workstation (where it is placed), Tanggal,
  Catatan.
- **Lines:** item (Barang, Kelola Stok, active), quantity with unit; **Lot**
  column with *Pilih Lot* exactly as the Delivery Note (stock in that
  warehouse, lot × location, FEFO, *Isi FEFO*, expiry flags); picked in full
  to post.
- **Posting:** per lot row `issueStock` → value; `enterProduction` with the
  same lot number, the stock lot's batch and expiry, at the workstation;
  journal **Dr WIP / Cr Persediaan** (the item category's, else Account
  Mapping's, as the Delivery Note); refuses short stock with both figures.
- **Permissions:** `PRODUCTION_ISSUE_VIEW / _CREATE / _EDIT / _POST / _CANCEL`.

### 9.4 Penerimaan Hasil Produksi — `log_production_receipt`, `PRD/…` (Persediaan › Operasi Gudang)

- **Header card:** Gudang (destination), Tanggal, Catatan.
- **Lines:** *Pilih dari Produksi* lists buckets (as 9.2's picker); each line a
  bucket + quantity ≤ balance; **Lokasi** when the warehouse uses locations
  (P136); lot number, batch and expiry follow the production lot (read-only).
- **Posting:** `takeFromBucket` → value; `receiveStock` with the same lot
  number, expiry and batch, at that value; journal **Dr Persediaan (item
  category) / Cr WIP**.
- **Serves** FG, low-tier output, bulk sent to wait in stock (M45) and unused
  material going back.
- **Permissions:** `PRODUCTION_RECEIPT_VIEW / _CREATE / _EDIT / _POST / _CANCEL`.

### 9.5 Pemusnahan Produksi — `log_production_scrap`, `WST/…` (Persediaan › Operasi Gudang)

- **Header card:** Tanggal, Alasan (required), Catatan.
- **Lines:** bucket + quantity ≤ balance.
- **Posting:** `takeFromBucket`; journal **Dr Beban Pemusnahan Produksi / Cr
  WIP** (none when the value is 0). Outside the month-end cost (M21).
- **Permissions:** `PRODUCTION_SCRAP_VIEW / _CREATE / _EDIT / _POST / _CANCEL`.

### 9.6 Pencatatan Biaya Produksi — `prd_cost_entry`, `BPR/…` (Produksi › Biaya)

- **Header card:** Tanggal, **Account Lawan** (postable, active, not a Control
  Account, not an element), Partner (when that account requires one),
  Uraian.
- **Lines:** cost element, *Biaya* or *Koreksi* (lowers cost), amount, note.
- **Posting:** journal per line **Dr element / Cr lawan** (*Koreksi* the other
  way), and `recordCost` per line (+ / −).
- Payroll, depreciation and utility bills are booked here until their own
  modules exist (M49).
- **Permissions:** `PRODUCTION_COST_VIEW / _CREATE / _EDIT / _POST / _CANCEL`.

### 9.7 Penutupan Biaya Produksi — `prd_cost_close`, `CPC/…` (Produksi › Penutupan)

See §10. **Permissions:** `PRODUCTION_CLOSE_VIEW / _POST`.

---

## 10. The month-end close

### 10.1 When

The user picks a **fiscal period**: the earliest one not yet costed, whose
last day has passed (M31). The page shows every period of the year with its
status (*Belum Ditutup*, *Ditutup* with its `CPC/…`).

### 10.2 What it computes (preview = dry run of the posting)

1. **Cost:** every cost-ledger row dated in the period, plus its *Dibawa
   Masuk*, per element (M23). A negative total is refused.
2. **Receivers:** items of **Kategori Item *Barang Jadi*** received by
   Penerimaan Hasil Produksi in the period (M25 as amended by M46), with the
   received quantity **in the common cost unit** (M26). An item that does not
   convert to it is a refusal naming the item.
3. **Share per item:** cost × its quantity ÷ Σ quantity, largest remainder.
4. **Per item, from the stock valuation ledger (`poolMovements`):**
   Available = Q at period start + inflows in the period; Out = outflows in
   the period; End = Available − Out. Outflow share = round(share × Out ÷
   Available); ending share = share − outflow share (M27).
5. **Ending share's home:** the item's pool via `revalueStock`, or HPP when the
   pool's Q is 0 now (M29).
6. **Warnings:** Drafts dated in the period of any stock, production or cost
   document, listed with links (M34).

### 10.3 What it posts (one transaction)

| Outcome | When | Writes |
| --- | --- | --- |
| **Absorbed** | Cost > 0 and at least one receiver | Journal dated the period's last day: **Dr HPP** (each item category's, Σ outflow shares + ending shares sent to HPP) · **Dr Persediaan** (each category's, Σ ending shares) / **Cr each element account** (its amount, M24); `revalueStock` per item; cost-ledger *Absorbed* rows per element |
| **Carried** | Cost > 0, no receiver, not the year's last period | No journal; *CarriedOut* rows dated the period's last day and *CarriedIn* rows dated the next period's first day (M6) |
| **Expensed to P&L** | Cost > 0, no receiver, the year's last period | No journal (the cost stays an expense and the year close zeroes it); *ExpensedToPL* rows (M6) |
| **Empty** | Cost = 0 | Nothing but the record |

Every outcome stores `prd_cost_close` with its element and item lines, and
marks the period **costed** (M32). Permanent (M33).

### 10.4 Year end

The fiscal-year close is refused while its last period is not costed — only
when the year has any cost-ledger or production-ledger row (a company that does
not produce is not forced to run empty closes) (M35).

---

## 11. Reports (Produksi › Laporan)

| Report | Parameters | Shows | Permission |
| --- | --- | --- | --- |
| **Saldo Produksi** | As of date; workstation, item, batch (chips) | WIP per workstation → buckets: lot, item, batch, qty, value; totals per workstation; against the WIP account | `REPORT_PRODUCTION_BALANCE_VIEW` |
| **Kartu Lot Produksi** | Lot (and item); period | The lot's buckets and every movement with running qty and value per bucket | `REPORT_PRODUCTION_LOT_CARD_VIEW` |
| **Telusur Produksi** | A batch, a production lot or a stock lot; *Mundur* / *Maju* | Backward: FG → executions → inputs → issued stock lots → their Receipt Notes and suppliers. Forward: material → executions → FG lots → Penerimaan Hasil Produksi → Delivery Notes and customers. Quantity and value at each edge | `REPORT_PRODUCTION_TRACE_VIEW` |
| **Rekap Produksi** | Period; workstation | Per workstation: executions, input and output in the common unit, susut, value in / out; per item produced | `REPORT_PRODUCTION_SUMMARY_VIEW` |
| **Buku Biaya Produksi** | Date range (a fiscal period by default); element | Every cost-ledger row with its document, running total per element; the period's close and outcome; against the GL per element | `REPORT_PRODUCTION_COST_VIEW` |

Each report reads its book as of its date, so a past date reports as it stood.
The close document itself is the period's costing report (cost, receivers,
splits, journal).

---

## 12. Controls (`db:reconcile`, 54 → ±66 checks)

1. Each bucket = Σ its production-ledger rows; never negative; qty 0 ⇒ value 0.
2. **WIP account = Σ bucket values.**
3. Each posted execution: Σ output value = Σ input value; each output lot's
   first row = Σ its genealogy in-edges.
4. Each production lot has one batch at most, and its stock lot carries the
   same batch.
5. **Cost ledger = GL** per element account and date: Σ *In* rows = debit −
   credit of non-close journal lines; Σ *Absorbed* = the closes' credits.
6. Each costed period's cost ledger nets to 0 (absorbed, carried or expensed).
7. Each close: Σ outflow + Σ ending shares = cost absorbed; item shares sum to
   the cost.
8. Every element account is a Control Account and is used by no Account
   Mapping key or Jenis PPh.
9. No stock, production or cost-ledger row dated in a costed period after the
   close's own rows.
10. Stock: Σ quantity-ledger value + Σ revaluation rows = Σ valuation-ledger
    value (amends the P120 check).
11. Nilai Persediaan = Persediaan accounts (unchanged, now with revaluations).
12. A posted issue's lot rows = the production lots it entered; a posted
    receipt's lines = the stock lots it created, value for value.

---

## 13. Menu and permissions

```
Produksi                         (MENU_PRODUCTION_ACCESS; between Pembelian and Persediaan)
  Operasi     Perintah Produksi · Eksekusi Produksi
  Biaya       Pencatatan Biaya Produksi
  Penutupan   Penutupan Biaya Produksi
  Laporan     Saldo Produksi · Kartu Lot Produksi · Telusur Produksi · Rekap Produksi · Buku Biaya Produksi
Persediaan › Operasi Gudang
  Receipt Note · Pengeluaran ke Produksi · Penerimaan Hasil Produksi · Pemusnahan Produksi · Delivery Note
Master › Entitas      Workstation
Accounting › Pengaturan   Elemen Biaya Produksi · Account Mapping (card Produksi)
Pengaturan › Sistem   System Default (card Produksi)
```

New permission groups in the role matrix: *Produksi* (orders, executions,
cost entries, closes, reports) and additions to *Persediaan* (issue, receipt,
scrap) and *Master* (Workstation); no role gets them by default except the
administrator (§11 of `Claude-ERP.md`).

---

## 14. Numbering

| Document | Prefix | Ledger |
| --- | --- | --- |
| Perintah Produksi | `SPK/YYYY/MM/NNNN` | — |
| Eksekusi Produksi | `LHP/…` | production ledger `MP/…` |
| Batch | `BT/…` generated, editable before posting, unique (M42) | — |
| Output lot | `<LHP no>-<n>`, editable, unique per item (M42) | — |
| Pengeluaran ke Produksi | `SI/…` | `MS/`, `MN/` (stock), `MP/` |
| Penerimaan Hasil Produksi | `PRD/…` | `MP/`, `MS/`, `MN/` |
| Pemusnahan Produksi | `WST/…` | `MP/` |
| Pencatatan Biaya Produksi | `BPR/…` | cost ledger `BBP/…` |
| Penutupan Biaya Produksi | `CPC/…` | `MN/`, `BBP/` |
| Workstation | system code `ws.NNNN` | — |

No `-NP` series (no tax). Journals keep `JV/…`.

---

## 15. Changes to what exists

1. **`inventory.ts`** — `revalueStock`, `poolMovements`, batch on receive /
   issue, costing hold on every movement; Kartu Nilai Persediaan shows a
   revaluation row as *Penyesuaian Biaya Produksi* (qty 0).
2. **`fiscal.ts` / `closing.ts`** — costed columns, `holdCostingPeriod`, the
   year-close check.
3. **`receipt-note.ts`** — an expense line whose category Beban is an element
   writes `recordCost` in the same posting (Barang Habis Pakai, Jasa
   Pemeliharaan …).
4. **Guards** — Account Mapping and Jenis PPh refuse an element account;
   Elemen Biaya Produksi refuses an account they use; Kategori Item's Beban may
   be an element.
5. **Delivery Note** — no change; its HPP is the pool's MAC as today, and the
   close adds the uplift.
6. **Nav, role matrix, permissions catalogue, document types, seed and
   starter accounts, `DBML/erp.dbml.md`, `tests/module-boundaries.test.ts`**
   (the two new books import only the kernel; documents call them).
7. **`Claude-ERP.md`** — §1.4 scope, §1.5 status, §3.2 modules table, §10
   production rules, §12 P150, §14 do-not-do (no stock / production / cost
   posting outside the books; no conversion cost into production), §17 known
   limits (§22).

---

## 16. Edge cases

| # | Case | Handling |
| --- | --- | --- |
| X1 | WIP without conversion cost (PSAK 14) | Accepted (M4) |
| X2 | Cost but no FG in a period | Carried; year's last period stays expense (M6) |
| X3 | A cost arriving after its period is costed | Refused there; dated in the open period it is that period's cost |
| X4 | Next period's sales posted before the close | Keep the lower cost; uplift raises the pool or goes to HPP (M29) |
| X5 | FG issued back into production (rework) | Its outflow share goes to HPP (M28); it re-enters production at its MAC |
| X6 | Bulk waiting in stock | Keeps its batch (M45); takes no month-end cost (M46) |
| X7 | Several outputs | Bobot Biaya (M13) |
| X8 | Mixed units | Susut and the cost basis in the common unit (M14, M26) |
| X9 | Yield gain | Allowed |
| X10 | Failed run | Refused without output; Pemusnahan (M15) |
| X11 | Unused material returned | Penerimaan Hasil Produksi at its bucket's value |
| X12 | Material added mid-process | Another Stock Issue |
| X13 | Execution crossing period end | Posts on its date |
| X14 | Two Drafts on one bucket | Second posting refused when short |
| X15 | Expired material | Flagged, not refused |
| X16 | One stock lot issued twice at different MAC | Same production lot; its bucket adds both values |
| X17 | One lot issued to two workstations | Two buckets, each its own Q and V |
| X18 | Year close before the last period is costed | Refused when the year had production (§10.4) |
| X19 | Year-close journal zeroes element accounts | The last close wrote *ExpensedToPL*, so cost ledger and GL agree |
| X20 | FG also bought | Purchases are part of Available (M27) |
| X21 | Two batches meeting | Refused unless *Batch Baru* (M41) |
| X22 | Output lot number already used | Refused (M42) |
| X23 | Locks | Stock pool → stock bucket → production buckets (by id) → cost rows; one order everywhere |
| X24 | A receiver item not convertible to the common unit | Close refused naming it |
| X25 | A received FG whose pool emptied and refilled before the close | Ending share goes into the pool as it stands (no replay, P114) |
| X26 | A period whose Penerimaan Hasil Produksi received FG that never sold, pool still holding it | All its share to the pool (Out 0) |
| X27 | Negative cost total (corrections larger than costs) | Close refused; a correction is posted first |

---

## 17. Tests

- **Pure:** `production-costing.test.ts` (shares, rounding, M29, the §5.1
  example to the rupiah), `production-execution.test.ts` (value sharing, zero
  weights, batch outcomes, susut).
- **Books:** production ledger (enter, take, empty-takes-all, refusals, locks),
  cost ledger (record, guards, costed hold), `revalueStock` (pool, Q = 0
  refusal, reconcile identity).
- **Documents:** each document's lifecycle, posting journal = dry-run preview
  (P103), refusals; Receipt Note expense to an element writes the cost ledger.
- **End to end** (`tests/production-flow.test.ts`): §5.1's scenario — issue,
  four executions, receipt, Delivery Note, cost entry, close — checking every
  figure, the trace both ways, and `db:reconcile` clean; a second month with
  opening stock (FG opening 100 kg Rp2,0 jt, 700 kg received, 300 kg sold, cost Rp9,0 jt: HPP + 3.375.000, pool + 5.625.000); a carried
  month; a makloon run (Pengolahan → bulk to stock → re-issue → Pengemasan
  with packaging) keeping one batch.
- **Boundaries:** `module-boundaries.test.ts` covers the new books.

---

## 18. Build steps (each committed to `main` and verified on its own)

| # | Step | Done when |
| --- | --- | --- |
| 1 | **Masters and settings** — Workstation, Elemen Biaya Produksi, Account Mapping *Produksi*, *Satuan Pembebanan Biaya*, guards (§15.4), starter accounts | Screens work in a browser; guards refuse; seed idempotent |
| 2 | **Cost ledger + Pencatatan Biaya Produksi** (E4, §9.6), Receipt Note writing it, *Buku Biaya Produksi* | A cost entry posts journal + cost rows; reconcile check 5 passes |
| 3 | **Production ledger** (E2, E3) with tests | Book tests green |
| 4 | **Pengeluaran ke Produksi** (§9.3) | Stock out, bucket in, Dr WIP / Cr Persediaan; reconcile 2 |
| 5 | **Perintah Produksi + Eksekusi Produksi** (§9.1, §9.2, E6) | Execution balanced; batch rule; genealogy |
| 6 | **Penerimaan Hasil Produksi + Pemusnahan Produksi** (§9.4, §9.5), batch on stock lots | FG and returns in stock with lot and batch |
| 7 | **Saldo Produksi, Kartu Lot, Telusur, Rekap** | Trace both ways on the makloon run |
| 8 | **Penutupan Biaya Produksi** (E5, `revalueStock`, `poolMovements`, costing hold, year-close check) | §5.1 to the rupiah; period locked |
| 9 | **Reconcile checks, end-to-end tests, `Claude-ERP.md` and KB harvest** | `npm run build`, `lint`, `test` green; `db:reconcile` clean |

---

## 19. Out of scope (v1)

BoM and routing; standard cost; cost per workstation; WIP conversion cost;
normal-capacity rule; labour hours / machine time; payroll and depreciation
modules (Pencatatan Biaya Produksi meanwhile); separate staging step; quality
statuses other than Tersedia; brand-owner (customer-supplied) material;
subcontracting out; sales returns of FG; transfers between warehouses; reversal
of a close; mid-month pro-forma margin; multi-currency.

---

## 20. Decisions

| # | From | Decision |
| --- | --- | --- |
| M1 | Goals | G1–G15 are the brief. |
| M2 | Q8 | **Pull**: output waits where it was made; any execution, Penerimaan Hasil Produksi or Pemusnahan takes it; nothing names a destination; position only shows WIP per workstation. |
| M3 | Q21 | **A separate cost ledger**, written with the journal line, read by the close, never derived from the GL; reconciled with it. |
| M4 | Q1 | WIP carries no conversion cost (timing difference, knowingly short of PSAK 14). |
| M5 | Q2 | No normal-capacity rule; all cost absorbed. |
| M6 | Q3 | No receiver: carried to the next period; in the year's last period it stays an expense (*ExpensedToPL*). |
| M7 | Q4 | Workstation: Label, Nama, Catatan, Active. |
| M8 | Q5 | Output lines take a Barang with Kelola Stok. *The Dapat Diproduksi flag is dropped by M51.* |
| M9 | Q6 | Elemen Biaya Produksi: account + group; one element per account; no fixed / variable. |
| M10 | Q7 | No "job": identity is the lot, with the batch on top (M22). |
| M11 | Q9 | A lot survives partial use; new lots only as outputs; proportional take, emptying take releases all; no split document. |
| M12 | Q10 | One execution = one balanced posting; the order holds no value. |
| M13 | Q11 | Bobot Biaya per output line shares the value; 0 carries nothing. |
| M14 | Q12 | No mass-balance rule; susut in the common unit; yield gain allowed. |
| M15 | Q13 | At least one output; a failed run is written off. |
| M16 | Q14 | Perintah Produksi: header + optional plan; Draft → Open → Ditutup; no approval. |
| M17 | Q15 | FG leave production only through Penerimaan Hasil Produksi. |
| M18 | Q16 | Three own documents under Persediaan. |
| M19 | Q17 | The Stock Issue names a warehouse and a workstation; no material request. |
| M20 | Q18 | FG back to stock at the bucket's value, keeping the lot number; also unused material. |
| M21 | Q19 | Low-tier sellable → stock; disposed → Beban Pemusnahan, outside the close. |
| M22 | Q20 | Lot = stock identity (kept in production); Batch = production identity carried on top, tracing FG ↔ material. |
| M23 | Q22 | The fiscal period is the range; the cost ledger stores only a date; the close absorbs every row dated in the chosen period. |
| M24 | Q23 | The close credits each element account. |
| M25 | Q24 | Receivers: items received from production in the period — **amended by M46** to Kategori *Barang Jadi*. |
| M26 | Q25 | One common unit (*Satuan Pembebanan Biaya*) through the Item's conversions; no weight field. |
| M27 | Q26 | Periodic weighted average per item; opening and purchases in Available. |
| M28 | Q27 | Outflow share to the item category's HPP. |
| M29 | Q28 | Empty pool at the close: ending share to HPP. |
| M30 | Q29 | Whole rupiah, largest remainder. |
| M31 | Q30 | Periods costed in order, after their last day. |
| M32 | Q31 | A costed period is locked for stock, production and cost postings. |
| M33 | Q32 | A close is permanent. |
| M34 | Q33 | Drafts in the period are a warning. |
| M35 | Q34 | The year close requires its last period costed (when the year produced). |
| M36 | Q35 | Five reports; pro-forma later. |
| M37 | Q36 | Names and prefixes as §14. |
| M38 | Q37 | Out of scope as §19. |
| M39 | Q38 | Element accounts are Control Accounts; only documents post to them, each writing the cost ledger. |
| M40 | Q39 | An element account carries only production cost. |
| M41 | Q40 | **Batch rule:** no batched input → a new batch; one batch among the inputs → carried; un-batched inputs (more material, packaging) join without changing it; two batches → refused unless *Batch Baru*, whose parents are both; *Batch Baru* always possible. |
| M42 | Q41 | Batch `BT/YYYY/MM/NNNN` generated, editable before posting, unique; output lot `<LHP no>-<n>`, editable, unique per item and never reused. |
| M43 | Q43 | Bobot Biaya defaults to the output's quantity in the common unit, else its base quantity. |
| M44 | Q44 | No separate staging step in v1; the Stock Issue is the hand-over; a staging area comes with stock transfers (C34). |
| M45 | Q45 | Bulk may wait in production or in stock; a stock lot keeps its batch, and a re-issue carries it back. |
| M46 | Q46 | Month-end cost goes only to Kategori **Barang Jadi** received from production; bulk / Setengah Jadi in stock stays material only. Amends M25. |
| M47 | Q47 | No typed stage on a workstation. |
| M48 | Q48 | Brand-owner material out of v1; a batch may name a Customer Order for information. |
| M49 | Q42 | **Pencatatan Biaya Produksi** books cost to element accounts (Dr element / Cr a contra), writing the cost ledger; the Receipt Note does so for expense lines on an element. |
| M50 | §21 A | **Deviation check answer A — follow the convention** (`form-layout=header-tabs`, P38): the execution's Input and Output are two tabs after the header card; the screen alternating between them is accepted; the balance strip in the header card shows both totals. No exception recorded. |
| M51 | §21 B | **The *Dapat Diproduksi* flag is dropped** (amends M8): outputs take any Barang with Kelola Stok, cost receivers are decided by Kategori *Barang Jadi* (M46). More item and production categorisation will come later. |

---

## 21. The last two answers

- **Execution layout** — the deviation check on `form-layout=header-tabs`
  (P38) was answered **A, follow the convention**: Input and Output are two
  tabs (M50).
- **The *Dapat Diproduksi* flag** — dropped (M51).

---

## 22. Known limits (go to `Claude-ERP.md` §17 when built)

- FG and COGS carry only material cost between closes; margin looks high until
  the period is costed (M4, doc §7).
- WIP at a period end is material only — short of PSAK 14 by the conversion
  cost of the work in it (M4).
- Sales of the next period posted before the close keep the lower cost; the
  uplift reaches later issues (M29, P114 no replay).
- The Kartu Stok shows no value; the revaluation row appears only on Kartu
  Nilai Persediaan.
- A close is permanent; a wrong cost entry is corrected in the next period.
- Payroll and depreciation are entered by hand (Pencatatan Biaya Produksi).

---

## 23. After approval

1. Record **P150** in `Claude-ERP.md` §12 (the plan, M1–M51), update §1.4, §1.5, §3.2, §10, §14.
2. Add the harvest candidate to `KNOWLEDGE.md`: a new **manufacturing /
   actual-costing** concept (production ledger by lot and bucket, batch over
   lot, cost ledger as a control-account subledger, periodic weighted-average
   close without WIP) — `Later`, after it is built.
3. Build §18 step by step.
