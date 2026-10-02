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

**Local copy** is a path relative to this folder, or `—`. Put `pinned: <why>`
in **Note** to stay on an older version on purpose.

| Concept | Version | Choice | Local copy | Note |
| --- | --- | --- | --- | --- |
| foundations/working-method | 1.0 | guideline-file=named-import | — | Claude-ERP.md §1–§19 |
| foundations/document-lifecycle | 1.0 | core | — | §2, §9 |
| engineering/app-architecture | 1.0 | tenancy=one-company | — | §3, P9 |
| engineering/code-conventions | 1.0 | after-action=revalidate-only | — | §4, §7 |
| engineering/data-conventions | 1.0 | doc-numbering=prefix-yyyy-mm-seq | — | §9, P15 |
| engineering/security-rbac | 1.0 | core | — | §11 |
| accounting/books-and-posting | 1.0 | partner-positions=open-items-per-document | — | P25 → P71 |
| accounting/chart-of-accounts | 1.0 | control-account=user-set | — | P14, P16 |
| accounting/fiscal-periods-and-statements | 1.0 | core | — | P23, P27, P35 |
| accounting/multi-currency | 1.0 | core | Initialization/multi_currency_concept.md | P13, P37 (moving average = core pool) |
| accounting/open-items | 1.0 | settlement=in-posting | Initialization/ar_ap_open_item_concept.md | P71–P74 |
| accounting/tax-indonesia | 1.0 | core | tax_concept.md | **Living copy**: ERP edits it first, then harvests |
| sales/order-to-cash | 1.0 | core | — | Reference implementation: Sales-Process-Concept.md |
| ui/design-convention | 1.0 | form-layout=header-tabs | Initialization/design-convention.md | P3, P38 |
| ui/benchmark-study | 1.0 | reference | Initialization/Core_UI_Reference.md | |

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
| P37 | accounting/multi-currency §4 | A backdated movement is valued at the pool's carrying rate as it stands when posted; the book does not replay history | Awaiting user |
| P65 | ui/design-convention §10.8, §10.10 | Dropdown keyboard model (SIBA already adopted it); `PercentInput` | Awaiting user |
| P82 | ui/design-convention §8.8 | Document line readability rules | Awaiting user |
| P55 | ui/design-convention §10.10 | A flat-amount toggle reads *Nominal*, never `Rp` | Awaiting user |
| §8 | ui/design-convention §4.3 | Documents show only their own figures and link to related ones | Awaiting user |
