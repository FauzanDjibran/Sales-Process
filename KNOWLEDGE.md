# Knowledge Base Adoption — ERP

What this project takes from the central knowledge base
(`D:\Claude Code\Knowledge-Base`), at which version, and with which choices.
The protocol is `PROTOCOL.md` there. Check this file with:

```bash
node "D:/Claude Code/Knowledge-Base/tools/kb-check.mjs" ERP-Project
```

## Adopted concepts

**Choice** is one of:
- `core`;
- `variant`, for a `~variant` row;
- `reference`;
- the options picked, as `name=value; name=value`.

**Local copy** is a path relative to this folder, or `—`. Adopted copies
live in `knowledge/`; `Initialization/` keeps the frozen originals. Put `pinned: <why>`
in **Note** to stay on an older version on purpose.

| Concept | Version | Choice | Local copy | Note |
| --- | --- | --- | --- | --- |
| foundations/working-method | 1.0 | guideline-file=named-import | — | Claude-ERP.md §1–§19 |
| foundations/document-lifecycle | 1.0 | core | — | §2, §9. pinned: 2.0 renames the dates to `accounting_date` / `posted_at` on every posted row; ±100 models here, to be done outside the production build |
| engineering/app-architecture | 1.2 | tenancy=one-company | — | §3, P9; P94, P100, P106 harvested |
| engineering/code-conventions | 2.1 | core | — | §4, §7; P102 harvested |
| engineering/data-conventions | 1.1 | doc-numbering=prefix-yyyy-mm-seq | — | §9, P15; P109 harvested |
| engineering/security-rbac | 1.0 | core | — | §11. pinned: 2.0 moves identity to one OIDC provider, which waits for the Portal |
| accounting/books-and-posting | 3.2 | core | — | P25 → P71; positions kept by accounting/open-items. §6 reconcile command built: `db:reconcile` / `db:neon-reconcile`. 3.0 §1.3 is P213; 3.1 §3.4 is P221 |
| accounting/chart-of-accounts | 1.1 | control-account=user-set | — | P14, P16 |
| accounting/fiscal-periods-and-statements | 2.0 | core | — | P23, P27, P35; P222 harvested |
| accounting/multi-currency | 1.1 | core | knowledge/multi_currency_concept.md | P13, P37 (moving average = core pool) |
| accounting/open-items | 2.1 | settlement=in-posting | knowledge/ar_ap_open_item_concept.md | P71–P74, P96; R4 waits for this project |
| accounting/tax-indonesia | 2.3 | settlement-ppn=full-less-advance | tax_concept.md | **Living copy**: ERP edits it first, then harvests. P113: full PPN less the advances' PPN, assuming 12 % and 11/12 do not change (refused if they differ); P118: the advance's PPN recalculated by the chain |
| sales/order-to-cash | 3.0 | core | — | Reference implementation: Sales-Process-Concept.md; P93–P99, P107, P112, P117, P137–P143 harvested |
| inventory/stock-books | 1.0 | core | — | P95, P114, P120, P135, P136 |
| purchasing/procure-to-pay | 1.0 | core | — | Reference implementation: Purchasing-Concept.md; P121–P129 |
| ui/design-convention | 1.1 | form-layout=header-tabs | knowledge/design-convention.md | P3, P38 |
| ui/benchmark-study | 1.0 | reference | knowledge/Core_UI_Reference.md | |

## Local exceptions

Project rules that knowingly depart from an adopted concept for this project
only (PROTOCOL §4, answer D).

| Concept | Rule departed from | Project decision | Why |
| --- | --- | --- | --- |
| engineering/data-conventions | `doc-numbering=prefix-yyyy-mm-seq`: a series per prefix per month, for every document and journal | P216: production documents tied to a unit are numbered daily per unit, e.g. `BSTB_UGH_190526_00001`, `NG_UGH_180526_00001`; every other document and journal stays on the choice | The user's answer D, 04/11/2026: follows the numbering in Walet's production simulation |

## Harvest queue

Project decisions that look reusable and are waiting to be folded into the KB
(PROTOCOL §3).

| Project decision | Target concept | Proposed change | Status |
| --- | --- | --- | --- |

Processed 04/11/2026: P106 → `engineering/app-architecture` 1.2; P109 →
`engineering/data-conventions` 1.1; P110, P223 → `accounting/books-and-posting`
3.2; P116, P117 → `accounting/open-items` 2.1; P107, P112, P117, P137, P141,
P143 → `sales/order-to-cash` 3.0; P121, P122 → `accounting/tax-indonesia` 2.3;
P222 → `accounting/fiscal-periods-and-statements` 2.0; P95, P114, P120, P135,
P136 → `inventory/stock-books` 1.0; P121–P129 → `purchasing/procure-to-pay` 1.0.

Processed 04/10/2026: P93, P94, P97, P98, P99 → `sales/order-to-cash` 2.0;
P94, P100 → `engineering/app-architecture` 1.1 (stand-in module, `afterPost`
hook, delivered quantity on upstream lines); P102 → `engineering/code-conventions`
2.1. The P100 "tax identity copied" item was dropped: `tax_concept.md` §1.6
and §5.1 already say it.
