# Production — Workstations, Production Ledger and Month-End Costing

> **Status: the full plan, 08/10/2026. Phase 0 is complete** — every question
> is answered (§20, M1–M51; §21 records the last two). **Nothing is built
> until the user approves this plan**; it then becomes decision P150 in
> `Claude-ERP.md` §12 (§23).
>
> **Sources.** The user's goals of 08/10/2026 (§1), `month_end_costing_v2.md`
> (§2) and, as added context checked against the plan,
> `D:\Claude Code\production_3.0_makloon_concept.md` (§3).

> **Revised 08/10/2026 by the cost-center review (§21e, M72–M81).** The
> separate cost ledger and its two reports are dropped; production cost is the
> GL's, tagged by **Pusat Biaya**; Elemen Biaya Produksi becomes **Jenis
> Biaya**; Pencatatan Biaya Produksi is dropped. Where an earlier section
> disagrees with §21e, §21e wins.

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
| **Cost element** | *Elemen Biaya Produksi*: a master with its own label and name that names the account its cost posts to, as a Jenis PPh or a Cash & Bank does (M53). Every line on that account is production cost (M40). |
| **Cost ledger** | The append-only book of production cost, one dated row per cost booked or moved (M3, M23). |
| **Spreading basis** | How the close shares cost between FG items — **decided at the end, with the close** (M57). |
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

### E7 Journal (built) — no validation reads the Control Account mark (M55); how an element's account is kept for cost documents only is Q50.

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
| `acc_production_cost_element` | `element_code`, `element_label` (unique), `element_name`, `account_id` (FK), `note`, `status` (M53) |
| `acc_item_category_account` (reshaped, M54) | one row per `category_id` × `account_kind` (`Inventory`, `Cogs`, `Expense`, `Wip`, extendable), `account_id`, `status`; unique (`category_id`, `account_kind`) |
| `sys_setting` keys | Account Mapping `production_scrap_account`; no WIP fallback (M62) |
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
| **Elemen Biaya Produksi** | Master › Referensi (Q51), registry entity | Label, Nama, Account (postable, active, a Biaya 5.x account), Status, Catatan — like Jenis PPh (M53). No Control Account check (M55). Guards against other postings: Q50 |
| **Account Kategori Item** | Accounting › Pengaturan, reshaped into a mapping list (M54) | Each row: Kategori Item, Jenis Account (*Persediaan*, *HPP*, *Beban*, *WIP*, more later), Account; one row per kategori and jenis; a Jasa kategori takes *Beban* only; an empty Persediaan or HPP falls back to Account Mapping; **WIP and Beban have no fallback** — the document refuses (M62) |
| **Account Mapping › Produksi** | existing screen, new card | *Account Beban Pemusnahan Produksi* only (M62) |
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
- **Output side:** rows of item (Barang, Kelola Stok), **status** (*Tersedia* or *Reject*, M56 — a reject defaults to Bobot Biaya 0), quantity with unit (the
  item's units, P82), lot number (generated `<LHP no>-<n>` at first save,
  editable), expiry (required when the item has one), **Bobot Biaya**
  (default: its base quantity — M57; 0
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

### 9.6 Pencatatan Biaya Produksi — *dropped* (M75)

> Every production cost, paid or not, is a Tagihan Biaya Produksi whose Jenis
> Biaya says whether it is paid (§21e). The text below is kept for history.


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
  (P103), refusals.
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
| 1 ✅ reworked 08/10/2026 | **Masters and settings** — Workstation; Elemen Biaya Produksi as a master (M53); Account Kategori Item as a mapping list with WIP (M54); Account Mapping *Produksi*; no Control Account checks (M55); no Satuan Pembebanan Biaya (M57); starter accounts | Screens work in a browser; seed idempotent |
| 2 ✅ 08/10/2026 | **Cost ledger, Tagihan Biaya Produksi, Pembayaran Biaya Produksi, Buku and Saldo Biaya Produksi** (§21d) | A posted bill shows in the journal and in Buku / Saldo Biaya Produksi with the same figures; a payment clears it without touching the cost ledger; build, tests and reconcile pass locally and on Neon |
| 2b | **Cost-center rework** (§21e, R1–R6) | The Tagihan posts to the GL with a Pusat Biaya; paid and unpaid Jenis Biaya; no cost ledger; build, tests and reconcile pass |
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
| M52 | Phase 1 review | **The Receipt Note never writes the cost ledger.** Material cost is the stock ledger's (received, then issued to production); a Barang without Kelola Stok or a Jasa bought is an ordinary expense, unrelated to production. Production cost enters only through Pencatatan Biaya Produksi (and, later, payroll or depreciation documents). Amends M49 and §15.3. |
| M53 | Phase 1 review | **Elemen Biaya Produksi is a master with its own identity** — Label and Nama, then the account it posts to — as Jenis PPh and Cash & Bank are. The fixed group list is dropped. Amends M9. |
| M54 | Phase 1 review | **Account Kategori Item becomes a mapping list**: the user picks a Kategori Item, a Jenis Account and the account. Jenis Account starts as Persediaan, HPP, Beban and **WIP** (Persediaan Barang Dalam Proses, missing before), and is expected to grow. Amends P122's fixed three columns. |
| M55 | Phase 1 review | **No validation in this ERP checks the Control Account mark**; guarding it is the user's. Supersedes M39's Control Account rule. |
| M56 | Phase 1 review | **Reject output keeps its stock.** 1.000 kg in → 850 kg good + 50 kg reject: susut is 100 kg; the reject is an output with its own lot, **status Reject** and value 0 by default (Bobot Biaya 0), so the 850 kg absorbs the cost; it is later taken out of production for return or disposal. How a reject sits in stock: Q49. |
| M57 | Phase 1 review | **The spreading basis is not settled now**: *Satuan Pembebanan Biaya* is removed from Phase 1 and decided with the close (Phase 8). Bobot Biaya defaults to the base quantity; Susut is shown only where all lines share one unit. Amends M14, M26, M43. |
| M58 | Phase 1 review 2 | **Stock status is the quality identity, the warehouse is the place.** A stock bucket (warehouse · location · lot · status) already splits one lot by status: Lot.0001 100 kg, 10 kg found bad → 90 kg *Tersedia* + 10 kg *Reject*, the same lot in two buckets, its value staying in the item's pool (a purchased reject keeps its cost). Only *Tersedia* is issued. A reject warehouse holds rejected goods awaiting return or disposal. The status catalogue and the document that moves quantity between statuses (and to the reject warehouse) are Q53. |
| M59 | Q49 | **(c): a production reject stays in the production ledger** until a return or disposal document takes it out; it never enters a stock pool at 0. |
| M60 | Q50 | **The cost ledger is the source of truth** for production cost, as the Cash Bank Book and the stock books are for theirs: the close reads it, never the GL. The only guard on an element's account is the user's Control Account mark; nothing refuses an element's account elsewhere. `db:reconcile` reports a difference with the GL, as it does for the other books. Supersedes the element guards of Phase 1. |
| M61 | Q51, Q52 | **Elemen Biaya Produksi sits in Master › Referensi** beside Jenis PPh with its own permissions `PRODUCTION_COST_ELEMENT_*`; **several elements may name one account.** |
| M62 | Phase 1 review 3 | **WIP has no fallback account.** An item whose Kategori Item names no WIP cannot enter production: the document shows it as a warning before posting and Posting is refused, rather than send it to a generic account. Account Mapping's WIP is removed. |
| M63 | Phase 1 review 3 | **The QC menu is called *QC Inspection*** (Q53) and is **on hold** until the user asks for it. |
| M64 | Phase 2 brief | **Everything new for production sits in the Produksi module for now** (menus, documents, reports), whatever its later home. |
| M65 | Phase 2 brief | **No Koreksi in the main cost flow** for now. |
| M66 | Phase 2 brief | **Two cost reports: Buku Biaya Produksi** (the rows) **and Saldo Biaya Produksi** (totals per element), each filtered by a **month = a fiscal period**. |
| M67 | Phase 2 brief | **A difference between the cost ledger and the GL is a warning only**; the cost ledger wins (M60). |
| M68 | Q54, Q55 | **Production cost is captured by a Tagihan Biaya Produksi and paid by a Pengeluaran purpose** (option c): the bill recognises the cost in the month it belongs to and writes the cost ledger; a bill whose lawan is *Hutang Biaya Produksi* stays open until the new purpose *Pembayaran Biaya Produksi* pays it, which writes no cost row. Both are in Phase 2 so Buku Biaya Produksi can be tested end to end. |
| M69 | Phase 2 review | **The Tagihan Biaya Produksi has no Account Lawan** (P151). The user: a lawan chosen by hand meant a wrong choice left a bill nothing could pay. Mainstream ERPs never take the credit side of a vendor bill from the document — SAP from the vendor's reconciliation account, Business Central from the vendor posting group, Odoo from the partner's payable account (company default), NetSuite and Accurate from a default AP account — and none from the expense category, which decides only the debit side. So **one global account, Account Mapping's *Hutang Biaya Produksi***, copied onto the bill at posting (`payable_account_id`); every bill names its Supplier and every posted bill is paid by *Pembayaran Biaya Produksi*, which references the bill and debits the account it was posted on. A per-supplier override can follow if ever needed. Costs not owed to a supplier (depreciation, payroll accruals) wait for Pencatatan Biaya Produksi (§9.6). Amends M68 and §21d item 2. |
| M70 | Phase 2 review | **The cost reports read the cost ledger alone** (P152). Buku and Saldo Biaya Produksi show elements and their rows only — no account column, no GL beside them — like the Cash Bank Book and stock reports; the close reads only the cost ledger. The GL comparison stays a `db:reconcile` warning. Amends M66, M67 and §21d item 5. |
| M71 | Phase 2 review | **The cost reports read Saldo Awal · Masuk · Keluar · Saldo Akhir** (P153): Saldo Awal = *CarriedIn*, Masuk = *In*, Keluar = *Absorbed* + *ExpensedToPL* + *CarriedOut*; Buku Biaya Produksi puts Masuk and Keluar side by side with a running Saldo per element. Amends M66. |
| M51 | §21 B | **The *Dapat Diproduksi* flag is dropped** (amends M8): outputs take any Barang with Kelola Stok, cost receivers are decided by Kategori *Barang Jadi* (M46). More item and production categorisation will come later. |

---

## 21. The last two answers

- **Execution layout** — the deviation check on `form-layout=header-tabs`
  (P38) was answered **A, follow the convention**: Input and Output are two
  tabs (M50).
- **The *Dapat Diproduksi* flag** — dropped (M51).

---

## 21b. Phase 1 review — open questions (08/10/2026)

- **Q49 — A reject in stock.** The stock books value **one pool per item** (P114,
  P120), whatever the status. A reject of the same item entering stock at 0
  would pull down the average of the good stock, and later carry some of that
  value away when it is disposed of. Options:
  - **(a) A separate item** for the reject (e.g. *FG-X Reject*): the pool of the
    good item is untouched. Mainstream (SAP, Odoo, ERPNext all value per item
    and treat rejects as a scrap / downgraded item).
  - **(b) A value pool per item and status** (Tersedia, Reject, …): the same
    item, kept apart by status. Changes the stock books (P114 / P120) and every
    later status transfer must move value.
  - **(c) A reject never enters stock**: it stays in production until a return
    or disposal document takes it straight out of production.
  *Rec:* **(c) for now** — it keeps both ledgers clean and needs no stock change;
  (a) is available any time by declaring the reject as another item on the
  output side.
- **Q50 — Keeping an element's account for production cost only**, now that
  the Control Account mark is not checked (M55). Every line on that account
  must be in the cost ledger, or the close misses it. *Rec:* by the **element
  rule itself** (not the mark): the manual journal, Account Mapping, Jenis PPh
  and every Kategori Item account (Beban included, M52) refuse an account an
  active element names. Or leave it entirely to the user, with `db:reconcile`
  reporting any line on an element account that the cost ledger does not have.
- **Q51 — Where Elemen Biaya Produksi sits.** *Rec:* Master › Referensi beside
  Jenis PPh, with its own permissions `PRODUCTION_COST_ELEMENT_*`.
- **Q52 — May two elements name the same account?** *Rec:* yes, as two Jenis
  PPh may (e.g. *Upah Harian* and *Lembur* both on Biaya Tenaga Kerja
  Langsung); the cost ledger keeps them apart, the GL check sums them.

---

- **Q53 — Stock status catalogue and moving between statuses** (from M58; menu named *QC Inspection*, on hold — M63). *Proposal:* statuses **Karantina** (received, awaiting QC — not issuable), **Tersedia** (released) and **Reject**; *Diblokir* stays for a hold. Moving quantity between statuses, or into the reject warehouse, is a stock transfer document (C34) — the QC result. Not part of the production phases; to be planned when you ask.

---

## 21c. Phase 2 — how production cost is captured (Q54, open)

**The user's question:** a dedicated *Pencatatan Biaya Produksi*, a new
*Pengeluaran* purpose, or a request document settled by *Pengeluaran*?

**What mainstream ERPs do.** None has a special "production cost" document.
The cost is captured by the **ordinary source documents** — a vendor bill
without a PO, a payroll run, a depreciation run, a cash expense — and the
line carries a **cost dimension** (SAP: the GL account is a *cost element*
and the line names a *cost center*; Dynamics 365 Business Central: a *cost
type* mapped to G/L accounts plus dimensions; Odoo and NetSuite: an analytic
account / department on the bill line). The cost ledger is fed from those
postings. Payment is a separate, later document that only settles the
liability (SAP FB60 then F-53; Odoo vendor bill then payment; Accurate
*Pembelian/Biaya* then *Pembayaran*).

**Why it matters here: the cost must land in the month it is incurred**
(PSAK accrual basis), because the close spreads one fiscal period's cost.
- Electricity for October is billed and paid in November.
- Depreciation and accrued wages never pass through cash at all.
- A cost recorded only when paid (a *Pengeluaran* purpose alone) puts it in
  the wrong month, and has no place for depreciation.

**Options.**
- **(a) A new Pengeluaran purpose, *Biaya Produksi*** — Dr element / Cr Kas
  at payment. Simplest; **cash basis**: wrong month whenever payment lags,
  and nothing for depreciation or accruals.
- **(b) A request document (no posting) settled by Pengeluaran** — the
  approval step is useful, but the cost is still booked at payment, so it is
  still cash basis.
- **(c) An expense bill that recognises the cost when incurred, settled
  later by Pengeluaran** — the mainstream two-step. The document (*Tagihan
  Biaya Produksi*) is dated when the cost belongs (the bill / usage month),
  posts **Dr element / Cr its lawan** and writes the cost ledger:
  - lawan **Hutang Biaya Produksi** (Account Mapping) → the bill stays open
    with a paid amount (P132) until a new **Pengeluaran purpose *Pembayaran
    Biaya Produksi*** pays it (Dr Hutang Biaya Produksi / Cr Kas & Bank — no
    cost ledger row, the cost was already recorded);
  - any other lawan (**Akumulasi Penyusutan**, **Hutang Gaji & Upah**, …) →
    nothing to pay through this flow; depreciation and payroll accruals fit.
  An optional Partner (PLN, a contractor) on the bill.
- **(d) (c) plus a request/approval step in front** — later, with the
  approval work deferred in C30.

**Recommendation: (c).** It is what mainstream ERPs do, it puts cost in the
right month, covers non-cash costs, and answers the user's "request settled
on Pengeluaran" idea with a document that records the cost instead of only
asking for money. The Pengeluaran purpose is the one piece outside the
Produksi menu (it is the payment menu); per M64 it could instead start as a
*Pembayaran* button on the bill inside Produksi — Q55.

- **Q55 — Where the payment lives.** *Rec:* a new purpose in the existing
  Pengeluaran menu, because a bank statement line may pay a supplier invoice
  and a production bill together, and one payment menu keeps the Cash Bank
  Book in one place (P66, P83).

---

## 21d. Phase 2 scope (agreed 08/10/2026)

1. **Cost ledger** `prd_cost_ledger` (`production-cost.ts`, a book): append-only,
   one row per cost — posting date, element, account, amount, kind (`In`
   now; the close's kinds later), the document that made it, ledger number
   `BBP/…` (P110). No period column (M23); written only inside a posting.
2. **Tagihan Biaya Produksi** `prd_cost_bill(_line)`, `TBP/YYYY/MM/NNNN`,
   Produksi › Biaya. Header: Tanggal (the month the cost belongs to),
   Supplier (required), *Account Hutang* shown from Account Mapping and never
   chosen (M69), No. Tagihan Supplier (optional), Jatuh Tempo (optional),
   Uraian, Catatan. Lines: Elemen Biaya Produksi, Jumlah, Keterangan. Draft →
   *Posting* → Posted (final); *Batalkan* Draft only. Posting: journal Dr each
   element's account / Cr *Hutang Biaya Produksi* (copied to the bill), one
   cost-ledger row per line, the journal shown by dry run first (P103). Every
   posted bill keeps `paid_amount` (P132): Belum Dibayar / Sebagian / Lunas.
3. **Pembayaran Biaya Produksi** — a new Pengeluaran purpose (Out, `BKK/…`,
   Supplier): pays open payable bills, in parts if wanted; Dr Hutang Biaya
   Produksi / Cr Kas & Bank (+ bank charge); the Cash Bank Book Out; no PPh;
   no cost row.
4. **Account Mapping › Produksi** gains *Account Hutang Biaya Produksi*.
5. **Buku Biaya Produksi** and **Saldo Biaya Produksi** (M66): month = fiscal
   period, element filter; the rows with their document, and totals per
   element — the cost ledger alone, nothing from the GL (M70).
6. **Produksi menu** (M64): *Biaya* and *Laporan* groups; permissions
   `MENU_PRODUCTION_ACCESS`, `PRODUCTION_COST_BILL_VIEW / _CREATE / _EDIT /
   _POST / _CANCEL`, `REPORT_PRODUCTION_COST_LEDGER_VIEW`,
   `REPORT_PRODUCTION_COST_BALANCE_VIEW`.
7. **Reconcile:** a posted bill's lines = its cost rows; paid amount = its
   posted payment lines; the cost ledger beside the GL per element account.

---

## 21e. Cost-center review (08/10/2026) — decisions and rework plan

**Source:** the user's `cost-center-and-tagihan-biaya.md`, compared with
Phases 1–2 and this plan against mainstream ERPs (SAP S/4HANA's cost center on
the universal journal, Odoo's analytic lines, NetSuite's department / class,
Business Central's dimensions). Its core: a journal line says **what** (the
account), **where** (the cost center) and **who** (the partner); recognising a
cost and paying it are separate; the credit side comes from a master.

### Decisions

| # | Decision |
| --- | --- |
| M72 | **Pusat Biaya (cost center) is adopted with its calculation**: a master (code, label, name, type, status), a tag on each cost line beside the account and the partner, and a month-end pool **per cost center**. The first implementation has **one cost center, *PRODUKSI*** (type *Production*), so the pool is global as G8 intended. More centers, and Service / Office types, are added later without touching posted data. |
| M73 | **The cost center lives on the journal line** (`acc_journal_line.cost_center_id`) — the mainstream way. **The separate cost ledger (`prd_cost_ledger`), Buku Biaya Produksi and Saldo Biaya Produksi are dropped.** The month-end pool is the GL: the balance of each account per cost center. Any source that posts a journal — a Tagihan today, a manual journal, payroll or depreciation later — can carry a cost center. Supersedes M3, M23, M60, M66, M67, M70, M71 (P152, P153). |
| M74 | **An account says whether it requires a cost center** (`acc_account.require_cost_center`, *Wajib Pusat Biaya* on the account form, like *Require Partner*). `postJournal` enforces it for every source: a line on such an account names an active cost center, and a line on any other account names none. The year-end closing journal is exempt. Until the manual journal can pick a cost center, it refuses such an account. |
| M75 | **Jenis Biaya replaces Elemen Biaya Produksi** (M53): it gives a cost a name and points to the account it is booked to, so a Tagihan line picks a Jenis Biaya and **never an account**. **A Jenis Biaya says whether it is paid**: a *paid* one (Listrik PLN, Upah Borongan) credits Account Mapping's *Hutang Biaya Produksi* (P151); one *not paid* (Penyusutan Mesin) credits its own **Account Lawan** and is never paid. **Pencatatan Biaya Produksi (§9.6) is dropped**: every production cost is a Tagihan. |
| M76 | **A Tagihan holds lines of one kind**: all paid or all not paid. A paid Tagihan names its Supplier and is paid by *Pembayaran Biaya Produksi*; one not paid has an optional Partner and is never offered for payment. **Neither creates an AP open item**: the Tagihan keeps what it was paid (P132) and the payment references it. |
| M77 | **Each Tagihan line carries its Pusat Biaya** (today always *PRODUKSI*, pre-filled); one line, one cost center — a shared cost is split into lines before entry. |
| M78 | **The close (Phase 8) reads the GL per cost center**: the pool of a period = the balance, from the fiscal year's start to the period's end, of every account on lines tagged with a *Production* cost center, closing journals aside. Because the close credits those accounts, **what earlier closes absorbed is already gone and what a period carried simply stays** — no *Carried* rows are needed. With one cost center the rate is the pool ÷ the received finished-goods quantity, i.e. the global spread of §10. **WIP stays material only and month-end cost goes only to finished goods received and what was sold** (G5, M46 unchanged). The close's journal credits each account per cost center. Amends §10.2–§10.3. |
| M79 | **Correction is a new document, never a reversal; no approval step now** (`Claude-ERP.md` §2 rule 7, C30). **Accrual of an unbilled cost is deferred.** |
| M80 | **Two issues to production, later:** *Pengeluaran ke Produksi* for **material** (raw and packaging — tracked, enters the production ledger, §9.3) and a separate **issue of consumables** (oil, cleaning agents) that is **expensed at once**: Dr the Jenis Biaya's account with its Pusat Biaya / Cr Persediaan, untracked per use. Added to the later phases. |
| M81 | **What stays:** actual costing, no standard cost (G1); recognition separate from payment (M68); the credit side from a master (P151); Workstations as they are — a Workstation will link to a cost center when there is more than one. |

### Rework plan (step 2b, before Phase 3)

| # | Step | What changes |
| --- | --- | --- |
| R1 | **Schema and migration** | New `acc_cost_center` (+ enum `CostCenterType { Production }`); `acc_account.require_cost_center`; `acc_journal_line.cost_center_id` (FK, nullable, indexed with the account); `acc_production_cost_element` renamed in place to **`acc_cost_type`** (`cost_type_code / _label / _name`, `expense_account_id`, new `is_payable`, `contra_account_id`); `prd_cost_bill_line.element_id` → `cost_type_id` + new `cost_center_id`; **`prd_cost_ledger` and its enum dropped**. Data: *PRODUKSI* created; the accounts the cost types use get `require_cost_center`; posted bills' debit journal lines and every bill line get *PRODUKSI*; existing cost types are paid. Permissions `PRODUCTION_COST_ELEMENT_*` renamed `COST_TYPE_*` (grants kept); `COST_CENTER_*` added; the two report permissions and their grants deleted. DBML in step. |
| R2 | **Journal engine** | `JournalLineInput.costCenterId`; `postJournal` enforces M74 in one query per journal; the dry-run preview and the journal view / General Ledger show the cost center (as Partner, P147); the manual journal refuses an account that requires one. |
| R3 | **Masters** | *Pusat Biaya* registry entity (Master › Referensi, `COST_CENTER_*`); *Jenis Biaya* entity replacing the element (Nama, Account Biaya, *Dibayar lewat Pengeluaran*, Account Lawan shown only when not paid); *Wajib Pusat Biaya* on the account form; the seed creates *PRODUKSI* as a starter row (P62 style); the starter chart marks its production cost accounts and names *Akumulasi Penyusutan Mesin* as the lawan of a not-paid *PENYUSUTAN-MESIN*. |
| R4 | **Tagihan Biaya Produksi** | Lines: Jenis Biaya, Pusat Biaya, Jumlah, Keterangan; one kind per Tagihan (M76); Supplier required only when paid; posting Dr each Jenis Biaya's account **with its cost center** / Cr Hutang Biaya Produksi (paid, copied as today) or each line's Account Lawan (not paid); the Pembayaran offers only paid bills. |
| R5 | **Remove the cost ledger** | `production-cost.ts` reduced to the Jenis Biaya reads; the two reports, their nav, route, permissions and components removed; reconcile: cost-ledger checks replaced by *every line on a cost-center account names one, and no other line does* and *a posted Tagihan's debit lines = its lines, account and cost center*. |
| R6 | **Tests, docs, showcase** | `tests/production-cost.test.ts` reworked (paid and not-paid bills, the cost-center rule, manual-journal refusal); `Claude-ERP.md` P154; the existing showcase kept working (one not-paid depreciation bill added), nothing more. |

**Open for the user** (answered before R1):

- Q56 — A paid Jenis Biaya always credits the one global *Hutang Biaya
  Produksi* (P151), while a not-paid one names its own lawan. *Rec:* yes.
- Q57 — With Buku / Saldo Biaya Produksi gone, production cost is read in the
  General Ledger. *Rec:* show the Pusat Biaya on each GL line (as Partner) now;
  a cost-center report (account × cost center) comes with the close, which
  shows the pool anyway.
- Q58 — The document keeps its name *Tagihan Biaya Produksi* while only
  production cost centers exist. *Rec:* yes; renamed *Tagihan Biaya* when an
  Office cost center arrives.

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
- Payroll and depreciation are entered by hand as Tagihan with a not-paid
  Jenis Biaya (M75).

---

## 23. After approval

1. Record **P150** in `Claude-ERP.md` §12 (the plan, M1–M51), update §1.4, §1.5, §3.2, §10, §14.
2. Add the harvest candidate to `KNOWLEDGE.md`: a new **manufacturing /
   actual-costing** concept (production ledger by lot and bucket, batch over
   lot, cost ledger as a control-account subledger, periodic weighted-average
   close without WIP) — `Later`, after it is built.
3. Build §18 step by step.
