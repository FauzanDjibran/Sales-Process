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
| engineering/app-architecture | 1.1 | tenancy=one-company | — | §3, P9; P94, P100 harvested |
| engineering/code-conventions | 2.1 | core | — | §4, §7; P102 harvested |
| engineering/data-conventions | 1.0 | doc-numbering=prefix-yyyy-mm-seq | — | §9, P15 |
| engineering/security-rbac | 1.0 | core | — | §11. pinned: 2.0 moves identity to one OIDC provider, which waits for the Portal |
| accounting/books-and-posting | 3.1 | core | — | P25 → P71; positions kept by accounting/open-items. §6 reconcile command built: `db:reconcile` / `db:neon-reconcile`. 3.0 §1.3 is P213; 3.1 §3.4 is P221 |
| accounting/chart-of-accounts | 1.1 | control-account=user-set | — | P14, P16 |
| accounting/fiscal-periods-and-statements | 1.0 | core | — | P23, P27, P35; §1.3 lock held inside every Post since P222 |
| accounting/multi-currency | 1.1 | core | knowledge/multi_currency_concept.md | P13, P37 (moving average = core pool) |
| accounting/open-items | 2.0 | settlement=in-posting | knowledge/ar_ap_open_item_concept.md | P71–P74, P96; R4 waits for this project |
| accounting/tax-indonesia | 2.2 | settlement-ppn=full-less-advance | tax_concept.md | **Living copy**: ERP edits it first, then harvests. P113: full PPN less the advances' PPN, assuming 12 % and 11/12 do not change (refused if they differ); P118: the advance's PPN recalculated by the chain |
| sales/order-to-cash | 2.0 | core | — | Reference implementation: Sales-Process-Concept.md; P93–P99 harvested |
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
| P106 | engineering/app-architecture | Documents serving several flows (delivery note, receipt note, payment) are standalone: purpose catalogue in code + weak source pair; lines carry their own item / unit / quantity; logistics documents hold quantity and cost, never price or tax | Queued 05/10/2026 |
| P107 | sales/order-to-cash | The sales module owns only orders; advance bill and invoice belong to finance | Queued 05/10/2026 |
| P109 | engineering/data-conventions | Separate number series for documents with and without PPN (`-NP` marker), inherited downstream | Queued 05/10/2026 |
| P110 | accounting/books-and-posting | A ledger number per posting per book, shared by its movements | Queued 05/10/2026 |
| P95 | (new) inventory | Lot picking with FEFO and expiry flags, as a candidate for an inventory concept once real stock is built | Later |
| P116, P117 | accounting/open-items | An open item keeps balances only (original amount + current balance, no tax columns); an invoice item is born at its face and the advance it deducts is applied in its posting as a pair of entries, each naming the other (advance −DPP, invoice −DPP−PPN), with the journal moving Piutang the same way | Queued 06/10/2026 |
| P137, P141, P143 | sales/order-to-cash | A second agreement kind beside the customer order: a project-like request billed at its realisation. Internal documents list the detail (estimate vs actual per line); external documents (advance bill, invoice, faktur) carry one description line and no item. The advance bill and invoice of that flow are their own header-only tables on the same arithmetic, and the one receipt purpose settles them as further document kinds; the open item's agreement scope is a weak doc-type + doc-id pair | Queued 08/10/2026 |
| P114 | (new) inventory | Moving-average valuation kept as quantity and value: release round(V × q / Q), the emptying issue takes V, no negative stock, the average derived and never multiplied, returns at the value they left at | Later, with P95 |
| P122 | accounting/tax-indonesia | §4.1: a withholding type belongs to one side — sales (withheld from the company, prepaid asset) or purchase (withheld by the company, payable) — with its own account; never one record for both | Queued from cloud 06/10/2026 |
| P121 | accounting/tax-indonesia | §4.3b: when the company is the withholder, PPh 23 is booked at the purchase invoice (advance: at its payment), 100 % higher without an NPWP — the receiving-side rule of §4.3 stays | Queued from cloud 06/10/2026 |
| P121 | (new) purchasing / procure-to-pay | PR → PO (consolidated lines with a PR link table) → Receipt Note (GR/IR, lots made at receipt, Jasa as service acceptance) → AP advance → Invoice at the PO price with supplier-total difference account → AP open items, mirroring order-to-cash | Queued from cloud 06/10/2026 |
| P120 | (new) inventory | Two stock books, each a ledger + balance written in the moving document's posting: quantity per warehouse / lot / status, value per item pool, one valuation twin per quantity row; only stock-kept items enter, always by lot (unique per item); pool locked before bucket; balances read from ledgers as of a date; a reconcile per book. With P95 and P114 this is the candidate inventory concept | Queued from cloud 06/10/2026 |
| P135 | (new) inventory | Stock reports answer *where is this item* and *what does this warehouse hold* as the same item × warehouse cards grouped either way (a Kelompok switch), in rolled-up subject blocks; the running balance per card; quantities never totalled across items; no value per warehouse where the pool is wider. Belongs with P95 / P114 / P120 in the candidate inventory concept | Later, with P120 |
| P222 | accounting/fiscal-periods-and-statements | A period is Open / Locked / Closed: Locked refuses postings and is reversible, a year closes only once all twelve are Locked, and postings hold the lock shared while a close or a lock holds it exclusive | Queued 04/11/2026 |
| P136 | (new) inventory | Locations switched on per warehouse (*Gunakan Lokasi*): off = null location, on = every stock row names one of the warehouse's own locations; the bucket warehouse · location · lot · status unique NULLS NOT DISTINCT; the switch changes only while the warehouse is empty; a used location is deactivated, never removed; a location shown as `<warehouse>-<location>`; pick = lot in a location; reports keep Gudang and Lokasi as separate columns | Later, with P120 |

Processed 04/10/2026: P93, P94, P97, P98, P99 → `sales/order-to-cash` 2.0;
P94, P100 → `engineering/app-architecture` 1.1 (stand-in module, `afterPost`
hook, delivered quantity on upstream lines); P102 → `engineering/code-conventions`
2.1. The P100 "tax identity copied" item was dropped: `tax_concept.md` §1.6
and §5.1 already say it.
