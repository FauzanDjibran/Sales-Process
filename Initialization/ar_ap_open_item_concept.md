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

Advance does not need to be permanently tied to one PO or Invoice. Its source reference may be retained for traceability; allocation happens separately.

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

### Required identity

Each open item must identify:

```text
partner_id
currency_id
open_item_type
direction
current_balance
source document reference
```

---

## 4. Allocation / Clearing Rule

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

The allocation itself creates a traceable relationship between the source and target open items.

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
original_amount
applied_amount
```

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
