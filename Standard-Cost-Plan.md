# Standard Conversion Cost — Evaluation and Plan

> **Status: agreed 13/10/2026 (round 5). Recorded as M91–M99 in
> `production_project.md` §21f and P155 in `Claude-ERP.md`; built in the
> steps of §21f.** Source:
> `D:\Claude Code\erp_costing_reference.md` (the *reference*), read against
> `production_project.md` (the *plan*, M1–M90) and what is built (Phases 1,
> 2, 2b — P150–P154). On approval the answers become M91+ in
> `production_project.md` and a P-decision in `Claude-ERP.md` §12.

---

## 1. The brief

| # | The user's rule |
| --- | --- |
| S0 | **Every month's production cost is absorbed in that month. Nothing is carried over.** |
| S1 | **Standard cost applies to conversion only.** **Material stays actual** in every mode. |
| S2 | **Standard is optional.** A rate of 0 / no rate gives the same final figures; only the interim ones differ. |
| S3 | **Month end always settles to actual.** |
| S4 | **Mainstream WIP** (reference C6, round 4): conversion goes **into WIP, FG and HPP** — the standard is booked at each execution, the month-end leftover is spread to wherever that work now sits. Replaces round 3's "WIP stays pure". |
| S5 | **Cost center per workstation is the user's choice**: all one, each its own, or any mix, with shared cost on an Overhead (FOH) cost center spread to them. The close runs the same way in every set-up. |
| S6 | **Standard rates are master data.** |
| S7 | **The basis is called *Driver*** and behaves like hours; what it measures is decided later. |
| S8 | **The close credits *Biaya Produksi Dibebankan* per cost center** (mainstream): expense accounts keep their figures, the cost center ends at 0. |
| S9 | **The close behaves like the fiscal-year closing.** |

---

## 2. What changes in the agreed plan

| Dropped or replaced | By |
| --- | --- |
| G1 *never standard cost*; §19 *standard cost out of scope* | S1–S3 |
| G5, M4, X1 *WIP carries no conversion*; §22's two WIP limits | S4 — WIP carries its conversion (PSAK 14) |
| M46, X6 *only Barang Jadi take month-end cost; bulk in stock stays material* | S4 — any lot takes the conversion of the work in it, bulk in stock included |
| G8, M72 *one global pool* | S5 — a pool per cost center, one or many |
| M24, M78 *the close credits each cost account* | S8 |
| M6, M78 *carry a period with no receiver* | S0 |
| M26, M57 *basis = quantity in a common unit* | S7 — Driver |
| §9.2 *the execution posts no journal* | §3.3 — it posts the standard |
| §10 the close | §4 |
| M34 *Drafts warned* | Q74 (open) |

Kept: material actual (G2, F1), cost in = cost out (G3, now material +
conversion), lots, batch, Bobot Biaya, pull, the production ledger
(M2, M11, M13, M22), M27, M29, M31–M33, M35, P154.

No Knowledge-Base concept is contradicted (production costing is not yet one).

---

## 3. The model

### 3.1 Cost centers

- Types **Production** · **Overhead** · **Administrative** (never absorbed).
- **A Workstation picks its Production cost center**; several may share one.
- **A Production cost center has one Driver unit**; workstations sharing it
  count in that unit.
- **An Overhead cost center names its spread** on its master: *Rata*, or a
  *Persentase* per production cost center.

### 3.2 Tarif Standar (master)

Production cost center · **Berlaku Mulai** (a fiscal period) · Tarif (Rp per
Driver unit). The rate of a period is the latest row starting on or before
it; **none or 0 = no standard**. A row cannot start in, or be changed for, a
period that already has an execution posted at that cost center.

### 3.3 The execution books its standard

- Each **Eksekusi Produksi** records its **Driver**.
- Posting: **standard = round(Driver × the rate for its date)**; **value out =
  Σ input value + standard**, shared over the outputs by Bobot Biaya.
- Journal: **Dr WIP** (outputs' categories) / **Cr WIP** (inputs' categories)
  / **Cr Biaya Produksi Dibebankan** with the workstation's cost center. With
  no standard and one WIP account, no journal.
- From there conversion is just value: it moves with the lots through later
  executions, Penerimaan Hasil Produksi, the stock pools (moving average),
  Delivery Notes and Pemusnahan. Nothing new is needed to carry it.

### 3.4 The cost center's balance is the leftover

Cost debits a cost center; the standard booked credits *Biaya Produksi
Dibebankan* on the same one. At a period end **its balance is the leftover**
— the whole month's cost with no standard, the variance with one. The close
takes it to 0 every month (S0).

---

## 4. The month-end close (replaces `production_project.md` §10)

### 4.1 Like the fiscal-year closing

One page, Produksi › Penutupan, shaped like Accounting › Tutup Buku: the
**oldest period not yet costed**, after its last day; a **checklist**
(every execution in it has a Driver; the accounts mapped; Drafts — Q74); a
**preview** of every figure and the journal (dry run, P103); one button;
**irreversible**; the journal dated the period's last day; the period locked
(M32).

### 4.2 What it computes

| Step | Does |
| --- | --- |
| 1 | **Overhead** → production cost centers by its spread |
| 2 | **Per production cost center**: its balance shared over **the period's posted executions** at its workstations by Driver; largest remainder |
| 3 | **A cost center with a balance but no Driver in the period** → shared over the period's executions in proportion to what they took in step 2; with no execution at all, to HPP (M97) |
| 4 | **Follow each execution's share forward** to where its output value is (§4.3): a production bucket (WIP), a stock pool (FG, bulk, returned material), scrap |
| 5 | **Stock part per item**: sold vs ending by goods available (M27); the ending part to the pool (Q71), the rest to HPP |
| 6 | **Post** one journal: Dr/Cr WIP (value-only production rows) · Dr/Cr Persediaan (value-only stock rows) · Dr/Cr HPP · Dr/Cr Beban Pemusnahan / Cr/Dr Biaya Produksi Dibebankan per cost center → **every Production and Overhead cost center at 0** |

### 4.3 Following the leftover forward

A pure function over the genealogy the plan keeps (`prd_lot_link`, issue and
receipt lines): an execution's share goes to its outputs by Bobot Biaya;
each lot passes it on in proportion to quantity — to the bucket still
holding it, to later executions that took it (onward to their outputs), to a
stock receipt, to scrap. Only this period's executions receive a share, so
work of earlier months is never billed twice (reference §8.9).

### 4.4 Why standard or not ends the same

For one cost center: an execution booked Driver × rate; the leftover = pool −
Σ Driver × rate is shared by the same Driver and follows the same value
forward; so each execution ends with pool × its Driver ÷ total Driver — the
rate cancels. **Exact for WIP, scrap and the totals.** Inside a stock pool
the split between ending stock and HPP is the M27 approximation, because the
standard entered the moving average during the month (reference C12).

### 4.5 Acceptance test

The reference's §12 example, run both ways: M 300 pcs Rp5.670.000, S 100
pcs Rp1.612.500, WIP of batch 2 Rp2.900.000; close journal 8.700.000 without
standard, 540.000 with. Plus round 3's two set-ups: one pool FG-A Rp7,0 jt /
FG-B Rp3,0 jt; two pools + FOH Rp6,917 jt / Rp3,083 jt.

---

## 5. Data model

| Table | Change |
| --- | --- |
| `acc_cost_center` | type + `Overhead`, `Administrative`; `driver_uom_id?`; `spread_method` (`Even` / `Percent`) for Overhead |
| `acc_cost_center_spread` (new) | Overhead cost center · production cost center · percent |
| `acc_cost_center_rate` (new) | cost center · `effective_period_id` · `rate` |
| `ref_workstation` | `cost_center_id` |
| `prd_execution` | `driver_qty`, `cost_center_id`, `std_rate`, `std_amount`, `journal_id?` |
| `prd_ledger` | a value-only row (qty 0) for the close |
| `prd_cost_close` (+ `_center`, `_execution`, `_destination`) | pools, spread, Driver, standard booked, leftover, where it went |
| Account Mapping › Produksi | *Biaya Produksi Dibebankan* (requires a cost center); Account Mapping's HPP for a month with no execution |

The production ledger carries no memo and no Driver per lot (round 3's
`prd_ledger_driver` is not needed).

**As built in Phase 5a (P159, 14/10/2026):** the rate is per workstation, in
`ref_workstation_rate` (workstation · `effective_period_id` · `rate`), not
`acc_cost_center_rate`; the Driver has no unit, so there is no
`driver_uom_id` (`production_project.md` M103–M104).

---

## 6. Closed (round 5)

| # | Answer |
| --- | --- |
| Q71 | As recommended: the leftover follows the value to where it is when the close runs (M98) |
| Q73 | **No cost is left unabsorbed** (the user): a cost center with cost but no execution in the month is shared over the month's executions in proportion to what they took from the other cost centers — e.g. Rp30 jt in all, Rp1 jt of it on an idle station: all Rp30 jt still goes to WIP, FG and HPP. Only a month with no execution at all sends it to HPP (M97) |
| Q74 | As recommended: Drafts dated in the period block the close (M99) |

Cleared by round 4: A / A′, C, Q62, Q69, Q72, round 3's Q73.
