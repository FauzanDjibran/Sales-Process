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
| foundations/document-lifecycle | 1.0 | core | — | §2, §9 |
| engineering/app-architecture | 1.0 | tenancy=one-company | — | §3, P9 |
| engineering/code-conventions | 2.0 | core | — | §4, §7 |
| engineering/data-conventions | 1.0 | doc-numbering=prefix-yyyy-mm-seq | — | §9, P15 |
| engineering/security-rbac | 1.0 | core | — | §11 |
| accounting/books-and-posting | 2.0 | core | — | P25 → P71; positions kept by accounting/open-items |
| accounting/chart-of-accounts | 1.1 | control-account=user-set | — | P14, P16 |
| accounting/fiscal-periods-and-statements | 1.0 | core | — | P23, P27, P35 |
| accounting/multi-currency | 1.1 | core | knowledge/multi_currency_concept.md | P13, P37 (moving average = core pool) |
| accounting/open-items | 1.0 | settlement=in-posting | knowledge/ar_ap_open_item_concept.md | P71–P74, P96; R4 waits for this project |
| accounting/tax-indonesia | 2.0 | core | tax_concept.md | **Living copy**: ERP edits it first, then harvests |
| sales/order-to-cash | 1.0 | core | — | Reference implementation: Sales-Process-Concept.md |
| ui/design-convention | 1.1 | form-layout=header-tabs | knowledge/design-convention.md | P3, P38 |
| ui/benchmark-study | 1.0 | reference | knowledge/Core_UI_Reference.md | |

## Local exceptions

Project rules that knowingly depart from an adopted concept for this project
only (PROTOCOL §4, answer D).

| Concept | Rule departed from | Project decision | Why |
| --- | --- | --- | --- |

## Harvest queue

Project decisions that look reusable and are waiting to be folded into the KB
(PROTOCOL §3).

| Project decision | Target concept | Proposed change | Status |
| --- | --- | --- | --- |
| P93, P94, P97, P99 | sales/order-to-cash §2, §5 | The release chain is agreement → release order → delivery order (warehouse instruction; one warehouse and address; posts nothing) → delivery note (posts HPP / Persediaan; stores delivered quantity on the order lines; orders close themselves when fully delivered; closing by hand releases what never left) → invoice made of **whole lines of several posted delivery notes of one agreement**, where the bill completing a line takes what is left of its amount. Tax date = latest delivery date. The sales invoice is named *Invoice Penjualan*, so *Faktur* alone means the tax document. | Awaiting user |
| P98 | sales/order-to-cash §4 | One customer receipt purpose settles advance bills and invoices. An invoice's open amount is its AR item balance. PPh is on the net DPP after advances. | Awaiting user |
| P94 | engineering/app-architecture | **Stand-in module**: a module not built yet (stock) is replaced by a stand-in behind the contract the real one will keep (`issueStock(...)`), with temporary tables only it names, so the real module replaces it without touching callers. | Awaiting user |
| P94 | engineering/app-architecture §2 | A downstream fact that an upstream module needs (delivered quantity) is **stored on the upstream lines and written through the upstream module's own function**, never read from the downstream tables. | Awaiting user |
| P100 | engineering/app-architecture §2 | An `afterPost` hook that the Server Action fills keeps a dependent module (tax) one-way from the module it hooks into. | Awaiting user |
| P100 | accounting/tax-indonesia | The party's tax identity is copied onto the tax record at posting. Every figure is copied and never edited. | Awaiting user |
| P102 | engineering/code-conventions | Remote database performance: run functions in the database's region; load nested includes in one statement (`relationJoins`); a saved document's page loads only its own source; pickers and lists read ids or numbers before whole documents. | Awaiting user |
| P95 | (new) inventory | Lot picking with FEFO and expiry flags, as a candidate for an inventory concept once real stock is built. | Later |
