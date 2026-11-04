# AR/AP Open Item Concept

## 1. DNCN Concept

DNCN is an independent financial adjustment document that creates its own open item.

### Direction

DNCN can affect the partner balance in either direction:

| DNCN effect | Direction | Balance effect |
|---|---|---:|
| Deducting / crediting | `DECREASE` | Negative exposure |
| Increasing / debiting | `INCREASE` | Positive exposure |

The open item stores the **absolute current balance**. Direction determines its financial effect.

```text
DNCN
├── type: DNCN
├── direction: INCREASE / DECREASE
└── current_balance: positive absolute amount
```

DNCN is **not permanently tied to one Invoice**. It may be allocated later through the clearing process.

Its originating document/reference is retained for traceability, but allocation is determined separately.

---

## 2. Advance Concept

Cash Advance is also an independent open item.

```text
Advance
├── type: ADVANCE
├── direction: DECREASE
└── current_balance: positive absolute amount
```

Advance reduces the supplier's economic payable position, but it is classified separately from ordinary AP.

Therefore:

```text
Ordinary AP
= Invoice + Receipt + DNCN

Supplier net position
= Ordinary AP - Advance
```

Advance does not need to be permanently tied to one PO or Invoice. Its source reference may be retained for traceability; how it is settled against an invoice follows §4.

### An invoice that deducts an advance

The invoice's item is **born at its face**, always, even when advances cover it whole (it then ends at zero). Each advance it deducts is applied **inside the invoice's own posting**, as a pair of ledger entries each naming the other: the advance item falls by the amount used, and the invoice item falls by that amount plus any tax on it already acknowledged. The journal moves the same way, so the receivable moves line for line with the invoice item.

---

## 3. Open Item Concept

Each financial source creates an independent open item.

Initial open item types:

- `RECEIPT`
- `INVOICE`
- `DNCN`
- `ADVANCE`

The open item is the **settlement unit**, not the source document itself.

Source documents should not own their own outstanding balance. Outstanding balance is maintained through the open-item model.

### One item per source document

A source document gives rise to **at most one** open item, and the item is **identified by that document** (its document type and id, unique). Every later payment, application or adjustment of the document moves that one item; nothing creates a second item for it.

The item is the **only holder of the document's settlement state**. Beside its `current_balance` it keeps `paid_amount` — what payments have settled of the source document — raised inside each payment's posting. The source document keeps its **value and its lifecycle** (draft, issued, posted, cancelled) and stores no paid or outstanding figure.

A payment names the **source document**, finds its item by the document's id, and reads what was paid before from the item — never by summing other payments.

An item may be born by the first event that moves it (an advance item by its first payment, for instance); a document that has no item yet has been paid nothing.

Why: one place holds the settlement state, so the document and its item cannot disagree, and no payment depends on reading the payments before it. The document stays the authority on what was billed; the item is what settlements change.

### Required identity

Each open item must identify:

```text
partner_id
currency_id
open_item_type
direction
current_balance
paid_amount
source document reference (unique)
```

---

## 4. Allocation / Clearing Rule

**Choice point `settlement`.** The main path is **`in-posting`**: there is no allocation record. The document that settles (a receipt, an invoice using an advance) moves the items directly inside its own posting, and each ledger entry names its counter item, so the relationship stays traceable. The alternative, `allocation-step`, makes allocation a separate record linking a source item to a target item. The rules below hold for both.

The primary allocation eligibility rule is:

```text
source.partner_id = target.partner_id
AND
source.currency_id = target.currency_id
```

No PO or Invoice relationship is required for generic allocation.

Document-type rules determine which open items may be cleared against each other.

For the current AP concept:

```text
Advance → Invoice    allowed
DNCN    → Invoice    allowed
```

Either way, the settlement creates a traceable relationship between the source and target open items.

Partial allocation is allowed as long as the source open item's remaining balance is sufficient.

---

## 5. Open Item Ledger

The open-item ledger is the **immutable, append-only history of balance events**.

It records every event that changes an open item's balance, for example:

```text
CREATE
APPLY
REVERSE
```

The ledger is the audit trail and historical source for understanding how the balance changed.

### Principle

```text
Source Document
      ↓
Open Item
      ↓
Ledger Events (append-only)
      ↓
Current Balance
```

The ledger should retain sufficient context for auditability, including partner, currency, source/reference, event type, amount, posting date, and creator.

---

## 6. Open Item Balance

The balance table stores only the **current running balance** of each open item.

It does **not** need to store:

```text
applied_amount
tax figures
```

Tax belongs to the tax document. Beside the balance it keeps `paid_amount` (§3), because the source document does not hold it, and it may keep `original_amount`, what it was born at.

The balance is simply:

```text
current_balance
```

The amount remains a positive absolute value. Direction is stored separately.

Example:

```text
DNCN
current_balance = 150,000
direction       = DECREASE
```

Financial exposure is derived from the direction:

```text
INCREASE = +1
DECREASE = -1
```

Therefore:

```text
exposure = current_balance × direction
```

---

## 7. Design Separation

The model intentionally separates four concerns:

| Concern | Responsibility |
|---|---|
| Source document | Why the financial item exists |
| Open item | What remains available for settlement |
| Direction | Whether it increases or decreases exposure |
| Ledger | Immutable history of balance-changing events |
| Balance | Current running state |
| Allocation | Which eligible open items are settled against each other |

### Core principle

```text
Document = origin
Open Item = settlement unit
Ledger = history
Balance = current state
Allocation = settlement relationship
```

## Changelog
- **1.0** (03/10/2026): from ERP `Initialization/ar_ap_open_item_concept.md`.
- **2.2** (04/11/2026): `in-posting` made the main path and default for new projects, on the user's decision (REGISTRY R4). §2 and §4 no longer assume a separate allocation step. No rule removed: `allocation-step` stays an option.
- **2.1** (04/11/2026): harvested ERP P116, P117. §6, an item keeps balances only, with `original_amount` allowed and no tax figures; §2, an invoice's item is born at its face and the advance it deducts is applied inside its posting as a pair of entries.
- **2.0** (02/11/2026): §3 — one open item per source document, identified by it (unique), holding `paid_amount` beside its balance; the document keeps its value and lifecycle only, and a payment reads what was paid from the document's item. §6 notes the one figure kept beside the balance. Harvested from ERP P214 (the user's deviation-check answer B, 02/11/2026), which replaces ERP P132–P133's "the document keeps what it was paid". Changes a rule: adopters make the source reference unique and move any paid figure off their documents onto the item.
