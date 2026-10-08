# Month-End Costing

> **Definition:** MAC for operational valuation + material-only current-cost FG during the month + month-end actual conversion cost with allocation, normal-capacity absorption and WIP split + periodic weighted-average settlement + a separate revaluation document + immutable history.

---

## 1. Objective

The manufacturing process uses **actual costing without standard cost**.

- During production only **material cost** is known. Labor, overhead, maintenance, utilities and depreciation are known only at month-end.
- The system values transactions at the **cost known at posting time**. This is a legitimate cost, not a fake one.
- At month-end the missing cost is added through a **new revaluation document**. Posted production, delivery and sales documents are never edited.

---

## 2. Scope and Assumptions

| # | Assumption | Consequence |
|---|---|---|
| A1 | No standard cost | Valuation uses only actual cost and MAC. |
| A2 | No backdated transactions; posting date must be in the open period | Closed periods are locked and never re-costed. |
| A3 | No negative stock | MAC is always defined. |
| A4 | Allocation of actual expenses to workstations/products exists and is a prerequisite of the close | The allocation basis is out of scope; allocated amounts are inputs (section 5.2). |
| A5 | Production runs through orders that can carry WIP across months | WIP is part of the close (section 5.4). |
| A6 | Costing does not post to the GL | The revaluation document is the output interface. GL integration belongs to its consumer. |

---

## 3. Valuation Model

### 3.1 Cost known at each stage

| Stage | Known | Valuation |
|---|---|---|
| During the month | Material only | FG, COGS and WIP at material cost (MAC) |
| Month-end | Material + labor + overhead + maintenance + other | Missing conversion cost added by revaluation |

### 3.2 Two layers

| Layer | When | Method | Purpose |
|---|---|---|---|
| Operational | During the month | Moving Average Cost (MAC) | Value every receipt and issue at the cost known then |
| Settlement | Month-end | Periodic weighted average | Settle final COGS and ending inventory at actual cost |

```text
Final unit cost  = (Opening value + Final cost of the month's receipts)
                   ÷ (Opening qty + Receipt qty)
COGS             = Qty sold × Final unit cost
Ending inventory = Ending qty × Final unit cost
Revaluation      = Settled value − Value already posted at MAC
```

MAC treats units as fungible, so no origin-layer tracking is needed. Illustration with opening stock: opening 100 kg at Rp2.0M plus 700 kg receipts at a final Rp18.9M gives (2.0 + 18.9) ÷ 800 = Rp26,125/kg.

The finalized ending values become next month's opening values.

---

## 4. Ledger Structures

All tables are **append-only**. Each row carries a **period key** (e.g. 2026-11) and a status (open/closed). The close writes a period balance snapshot.

| Table | Content |
|---|---|
| **Cost Pool Ledger** | One row per expense fed into the pool: pool, period, source reference, cost type, fixed/variable, amount |
| **Cost Pool Period Balance** | Opening + expenses fed − allocated out − expensed (unabsorbed/abnormal) = **closing, which must be zero** |
| **Allocation Ledger** | One row per pool → workstation/order transfer, tagged with the close run ID. Mode 2 stores one plant-level row |
| **WIP and Inventory Balances** | WIP per workstation and FG quantity/value per period |

| Balance | At close | Next month |
|---|---|---|
| Cost pool | Zero | Starts at 0 |
| WIP | Closing stored | Opening WIP |
| FG inventory | Closing stored at settled cost | Opening inventory |

Re-runs reverse the Allocation Ledger rows of the run ID and post new ones; expense rows are never touched.

---

## 5. Month-End Close

### 5.1 Steps

```text
1. Lock the period
2. Collect actual expenses into the cost pool
3. Allocate to workstations/products          (prerequisite, 5.2)
4. Apply the normal-capacity rule             (5.3)
5. Split absorbed cost: completed vs WIP      (5.4)
6. Settle with periodic weighted average      (3.2)
7. Post the Cost Revaluation document
8. Run controls                               (5.5)
```

Multi-level BOMs close bottom-up: lower levels are finalized first and cascade upward.

### 5.2 Allocation modes

| | Mode 1: per workstation | Mode 2: global only |
|---|---|---|
| Cost data | Actual cost per workstation | Plant total per cost type |
| Capacity rule | Per workstation | Plant level, one factor |
| Rate | One per workstation, costed in routing order | One per **workstation-kg** of work |
| Normal loss | Lands on good kg at the workstation where it occurs | Work on lost kg is spread over all good work |
| WIP by workstation | Calculated | **Estimated** from work share |
| Total absorbed, unabsorbed, reconciliation | Identical | Identical |

**Mode 1, per workstation in routing order**

```text
Cost in                = transferred-in cost + material added + absorbed conversion
Good kg                = kg out + closing WIP kg
Transferred-in per kg  = transferred-in cost ÷ good kg         (normal loss lands here)
Equivalent kg          = kg out + WIP kg × % complete
Conversion per eq. kg  = absorbed conversion ÷ equivalent kg
Cost out               = kg out × (transferred-in per kg + conversion per eq. kg)
Closing WIP            = WIP kg × transferred-in per kg + WIP eq. kg × conversion rate
```

The cost out of one workstation is the transferred-in cost of the next, so workstations are costed sequentially. Opening WIP cost and its equivalent units are added to the workstation totals before dividing.

**Mode 2**

```text
Work unit        = 1 kg processed by 1 workstation (half-finished = 0.5)
Good work        = FG kg × workstations passed + WIP work units
Rate             = Absorbed conversion ÷ Good work
FG / WIP conversion = Work units × Rate
```

Mode 2 assumes every workstation costs the same per kg of work. It is least accurate when workstation costs differ widely or WIP is concentrated in one workstation. Tagging more cost to workstations upgrades it to Mode 1 with no change to the close logic. Material is tracked physically per workstation in both modes.

### 5.3 Normal-capacity rule (IAS 2 / PSAK 14)

```text
Absorbed fixed cost   = Actual fixed cost × MIN(1, Actual output ÷ Normal capacity)
Unabsorbed fixed cost = Actual fixed cost − Absorbed   → expensed in the period
```

- Variable cost is fully absorbed. Abnormal loss, waste and idle cost are expensed, never absorbed.
- Output above normal capacity caps absorption at actual cost.
- **Normal capacity** is master data per workstation, set from the sustainable average over several periods. It is neither the theoretical maximum nor this month's actual.
- Illustration: fixed cost Rp12M, normal capacity 1,250 kg, actual 1,000 kg → absorbed Rp9.6M, unabsorbed Rp2.4M expensed.

### 5.4 WIP split and normal loss

- Absorbed conversion cost is divided between completed output and closing WIP by **equivalent units**: a half-finished kg carries half of that workstation's conversion cost.
- **Normal loss** keeps its cost in the good kg; **abnormal loss** is expensed.
- Closing WIP (material + absorbed conversion) becomes next month's opening WIP.

### 5.5 Controls

1. Preview, then post.
2. Re-runnable: reverse and re-post, or post delta documents only.
3. Cost pool closing balance is zero: applied + closing WIP movement + expensed = actual expenses.
4. On-hand quantity ≥ 0 for every item.
5. Settlement quantity equals the subledger quantity.

---

## 6. Sales Returns

Return goods at the **original cost of the sale**, not current MAC (Business Central "apply from item entry", D365). Current MAC would reverse COGS at a different amount than charged.

| Case | Treatment |
|---|---|
| Sale from a prior, closed period | Re-enters FG at the original finalized cost as a fixed-cost receipt, excluded from revaluation; COGS credited at the same cost |
| Sale from the current, open period | Netted against sales at the original provisional cost; settles at the period's final unit cost |
| No traceable original sale | Current MAC; flagged as an exception |
| Damaged, not resaleable | Written down to net realizable value; the difference is expensed |

---

## 7. Mid-Month Reporting

Until the close, posted COGS and FG exclude conversion cost, so margin looks too high. Mainstream practice handles this in the **reporting layer, never by posting estimates**.

1. Show posted figures labeled **"Preliminary: before conversion cost"**, with a memo line for the unallocated cost pool balance.
2. Add a **pro-forma overlay** beside them. It is calculated, never posted, and discarded after the close.

```text
Estimated rate per unit = Previous closed month's absorbed conversion cost per FG unit
Uplift per unit         = Estimated rate × (Current-month receipts ÷ Units available)
Pro-forma COGS          = Units sold × (Posted MAC + Uplift per unit)
```

The overlay excludes WIP conversion cost and unabsorbed cost, so a gap to the final figure is expected. Posting an accrual instead would add a second valuation basis and a monthly reversal cycle. SAP avoids the gap through standard price, which this model does not use.

---

## 8. Simulation: 1,100 kg through 4 Workstations

Both allocation modes use the same facts and the same posted figures.

### 8.1 Facts and assumptions

Physical flow (kg), read from the production whiteboard:

| | WS1 | WS2 | WS3 | WS4 | Total |
|---|---|---|---|---|---|
| Received | 1,100 | 1,000 | 850 | 700 | |
| Transferred out | 1,000 | 850 | 700 | 700 → FG | 700 |
| Closing WIP | 100 | 0 | 0 | 0 | 100 |
| Normal loss (*susut*) | 0 | 150 | 150 | 0 | 300 |

FG 700 kg: sold 200 kg, on hand 500 kg. Check: 700 + 100 + 300 = 1,100 kg.

| Item | Value | Source |
|---|---|---|
| Material | Rp10,000/kg, 1,100 kg = **Rp11.0M**, all issued at WS1 | Board |
| Loss | All normal; its cost stays in the good kg | Assumption |
| WIP completion | 50% at WS1 | Assumption |
| Absorbed conversion (Rp M) | WS1 2.1, WS2 3.4, WS3 2.1, WS4 1.4 = **9.0** | Assumption |
| Capacity | Normal capacity met, so absorbed = actual and unabsorbed = 0 | Assumption |
| Opening stock | None (first month) | Assumption |
| Selling price | Rp40,000/kg, revenue Rp8.0M for 200 kg | Assumption (for margin only) |

The board shows Rp9M from WS2 onward but Rp10M leaving WS1. The Rp1M gap is the cost of the 100 kg lost between WS1 and WS2, kept in the good kg as normal loss, so Rp10.0M is carried through the chain. Mode 2 knows only the Rp9.0M total.

### 8.2 During the month (material only, Rp M)

| Posting | kg | Value | Per kg |
|---|---|---|---|
| WS1 → WS2 | 1,000 | 10.0 | 10,000 |
| WS2 → WS3 | 850 | 10.0 | 11,765 |
| WS3 → WS4 → FG | 700 | 10.0 | 14,286 |
| WIP at WS1 | 100 | 1.0 | 10,000 |
| Sale: COGS | 200 | **2.857** | 14,286 |
| FG on hand | 500 | **7.143** | 14,286 |

Check: 2.857 + 7.143 + 1.0 = 11.0, which is material only.

### 8.3 Close, Mode 1 (cost per workstation)

| (Rp M) | WS1 | WS2 | WS3 | WS4 |
|---|---|---|---|---|
| Transferred-in / material cost | 11.0 | 12.0 | 15.4 | 17.5 |
| Good kg (out + WIP) | 1,100 | 850 | 700 | 700 |
| Transferred-in per good kg | 10,000 | 14,118 | 22,000 | 25,000 |
| Absorbed conversion | 2.1 | 3.4 | 2.1 | 1.4 |
| Equivalent kg | 1,050 | 850 | 700 | 700 |
| Conversion per equivalent kg | 2,000 | 4,000 | 3,000 | 2,000 |
| **Cost out** | 1,000 × 12,000 = **12.0** | 850 × 18,118 = **15.4** | 700 × 25,000 = **17.5** | 700 × 27,000 = **18.9** |
| **Closing WIP** | 100 × 10,000 + 50 × 2,000 = **1.1** | 0 | 0 | 0 |
| Check: in + absorbed = out + WIP | 13.1 ✓ | 15.4 ✓ | 17.5 ✓ | 18.9 ✓ |

WS1 equivalent kg = 1,000 + 100 × 50% = 1,050. The 150 kg lost at WS2 and at WS3 raises the cost per good kg from Rp10,000 to Rp25,000 by WS4.

**Final FG cost: Rp18.9M for 700 kg = Rp27,000/kg.** With no opening stock the weighted average equals this figure.

### 8.4 Close, Mode 2 (global cost only)

| Item | Calculation | Work units |
|---|---|---|
| FG | 700 kg × 4 workstations | 2,800 |
| WIP at WS1 | 100 kg × 50% | 50 |
| **Good work** | | **2,850** |

```text
Rate           = Rp9.0M ÷ 2,850 = Rp3,158 per workstation-kg
FG conversion  = 2,800 × 3,158 = Rp8.842M
WIP conversion =    50 × 3,158 = Rp0.158M
Final FG cost  = 10.0M + 8.842M = Rp18.842M → Rp26,917/kg
```

Work spent on the 300 kg of loss is outside the divisor, so its cost falls on the good work.

### 8.5 Revaluation document and comparison (Rp M)

| Account | Posted | Mode 1 settled | Mode 1 revaluation | Mode 2 settled | Mode 2 revaluation |
|---|---|---|---|---|---|
| COGS (200 kg) | 2.857 | 5.400 | **+2.543** | 5.383 | **+2.526** |
| FG on hand (500 kg) | 7.143 | 13.500 | **+6.357** | 13.459 | **+6.316** |
| WIP WS1 (100 kg) | 1.000 | 1.100 | **+0.100** | 1.158 (estimate) | **+0.158** |
| **Total** | 11.000 | 20.000 | **+9.000** | 20.000 | **+9.000** |

- **Reconciliation:** the revaluation total equals the absorbed conversion cost of Rp9.0M in both modes. Cost pool: 9.0 fed − 9.0 allocated − 0 expensed = 0 ✓.
- **Totals identical, split different:** FG cost is Rp27,000/kg in Mode 1 and Rp26,917/kg in Mode 2 (0.3% apart), because Mode 1 workstation rates range from Rp2,000 to Rp4,000 while Mode 2 uses one equal rate.
- **Carried to next month:** FG 500 kg at Rp13.5M (Mode 1) or Rp13.459M (Mode 2); WIP Rp1.1M or Rp1.158M.

### 8.6 Mid-month report (position after all production and sales are posted)

**Header:** *PRELIMINARY: conversion cost not yet included. Cost pool balance: Rp9.0M, unallocated.*

Assumed prior-month conversion rate: Rp12,000/FG kg. Uplift = 12,000 × (700 ÷ 700) = 12,000; pro-forma unit cost = 14,286 + 12,000 = 26,286.

| (Rp M) | Posted | Pro-forma | Final, Mode 1 | Final, Mode 2 |
|---|---|---|---|---|
| FG unit cost (Rp/kg) | 14,286 | 26,286 | 27,000 | 26,917 |
| COGS, 200 kg | 2.857 | 5.257 | 5.400 | 5.383 |
| FG on hand, 500 kg | 7.143 | 13.143 | 13.500 | 13.459 |
| WIP, 100 kg | 1.000 | 1.000 | 1.100 | 1.158 |
| Revenue | 8.000 | 8.000 | 8.000 | 8.000 |
| **Gross margin** | **5.143 (64.3%)** | **2.743 (34.3%)** | **2.600 (32.5%)** | **2.617 (32.7%)** |

The posted margin is overstated by about 30 points. The pro-forma COGS is within 2.6% of the final figure.

---

## 9. Costing Rules

1. No standard cost.
2. The cost known at posting time is valid; material-only is the correct cost at production completion.
3. Month-end adds only the missing cost; material is never re-added.
4. Posted documents are immutable; revaluation is a new document; ledgers are append-only (sections 4, 5.1).
5. MAC operates during the month; periodic weighted average settles COGS and inventory at close (3.2).
6. Fixed cost is absorbed only up to normal capacity; unabsorbed and abnormal costs are expensed; normal loss stays in good units (5.3, 5.4).
7. WIP is costed at close by equivalent units and carries into the next month (5.4).
8. Allocation is a prerequisite. If only global cost is known, WIP by workstation is an estimate and totals remain identical (5.2).
9. The cost pool closes at zero (5.5).
10. Returns use the original cost of the sale (6).
11. Mid-month estimates are reporting-only and never posted (7).
12. No backdating, no negative stock, no GL posting (section 2).

---

## 10. References

| System | Relevant for |
|---|---|
| Dynamics 365 Business Central | Immutable item ledger entries, value entries added by "Adjust Cost", exact cost reversal for returns |
| Dynamics 365 Supply Chain | Weighted average with period-end inventory close |
| Oracle Process Manufacturing | Actual production costing, expense allocation, period-based revaluation |
| Sage X3 | Actual work-order costing, cost adjustments without rewriting movements |
| Infor LN | Completed production before all costs are known, later corrections |
| SAP Actual Costing / Material Ledger | Period-end actual costing, multi-level settlement, cost pools as cost centers. Uses standard price as preliminary value, so it is not the closest match to this model |
| IAS 2 / PSAK 14 | Weighted-average cost formula, normal-capacity absorption, expensing of abnormal costs, lower of cost and NRV |
