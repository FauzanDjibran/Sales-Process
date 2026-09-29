# Tax Concept

> **Status: draft for discussion (29/09/2026).** It records how tax works in
> the system, under Indonesian tax law. It is written like the open-item and
> multi-currency concepts: it names no menu, screen, table or product. It
> describes transactions, documents and records in general terms, so it
> applies to any module that sells, buys, bills or pays.
>
> Statements marked **[Q n]** depend on an open question in §11, and the
> current recommendation is written in their place. Statements marked
> **[verify]** need a tax consultant's confirmation (§12). Both are resolved
> in this document as they are settled. The document keeps evolving during
> development.

---

## 1. Principles

1. **Tax follows the transaction.** A tax obligation arises from a real
   economic event: goods delivered, a service rendered, money received or
   paid. A document that only *announces* an event (an order, a bill for an
   advance, a quotation) creates no tax. At most it carries an **estimate**.
2. **One computation, one place.** Every tax figure (DPP, DPP Nilai Lain,
   PPN, PPh) comes from a single calculation. The same calculation produces
   the preview shown while a document is being filled in and the figure that
   is stored. Nothing recomputes tax on its own.
3. **Tax documents are records, not postings.** A tax invoice or a withholding
   slip never writes a journal. The transaction that gives rise to it has
   already booked the tax. The tax document records that the obligation
   exists and tracks what has been done about it.
4. **The system is a register, not a gateway.** It does not connect to the tax
   authority's system (Coretax). It records:
   - which tax documents must exist;
   - their figures and deadlines;
   - what the user reports has happened: uploaded, numbered, received,
     replaced or cancelled.

   Filing happens outside the system, and the result is recorded back in it.
5. **Tax is measured in rupiah.** Every tax figure is in whole rupiah (§7),
   whatever the currency of the transaction (§8).
6. **A tax fact is frozen when it is recorded.** A document stores the rates,
   factors and figures it was computed with. A later change to a master (a
   withholding rate, the PPN rate) never changes a document already recorded.
7. **Corrections are new documents.** A recorded tax document is never edited
   after it is reported. A replacement, a cancellation or a return is its own
   document that points to the one it corrects.

---

## 2. The party's tax identity

Every counterparty in a taxable transaction has one tax identity. It is shared
whether the party is a customer or a supplier.

| Element | Meaning |
| --- | --- |
| Taxpayer type | Badan, Orang Pribadi, or Instansi Pemerintah |
| Identity type | NPWP, or NIK (an Orang Pribadi only) |
| Identity number | 16 digits, stored without separators |
| Name per identity | As registered with the tax authority; printed on tax documents |
| PKP status | Whether the party is a VAT-registered business. A PKP uses its NPWP |
| NITKU | The 22-digit place-of-business identity a tax invoice names. **[Q 17]** |

Role-specific tax behaviour sits beside the identity and applies only to the
role concerned:

| Behaviour | Effect |
| --- | --- |
| Withholds PPh 23 | The party deducts PPh 23 from what it pays for services |
| Collects PPh 22 | The party deducts PPh 22 from what it pays for goods |
| VAT collector (Pemungut PPN) | The party withholds the PPN itself and deposits it. The seller receives the price without PPN (§3.6) |

A transaction with a party whose tax identity is incomplete is refused.

---

## 3. PPN (VAT)

### 3.1 Whether a transaction carries PPN

- Whether PPN applies is **a decision on the transaction**, not a property
  of the item sold.
- Today it is made once for the whole document. **[Q 9]** asks whether one
  document may mix taxable and non-taxable lines.
- A non-taxable transaction has no PPN, whatever its price mode: its prices
  are its amounts.

### 3.2 Price mode

Prices on a transaction are typed either **exclusive** of PPN (the price is
the DPP) or **inclusive** of it (the price already holds the PPN). The mode is
chosen per document. A party may carry a default.

### 3.3 Rate and base

Under PMK 131/2024, in force since 1 January 2025:

| Goods / services | Rate | Base |
| --- | --- | --- |
| Not luxury (the normal case) | 12 % | **DPP Nilai Lain** = 11/12 × harga jual / penggantian, so the effective rate is 11 % |
| Luxury (subject to PPnBM) | 12 % | The full harga jual. **[Q 8]** |

- The rate and the 11/12 factor are **effective-dated values**, not
  constants. **[Q 7]**
- A document stores the rate and factor it used (§1.6).

### 3.4 The computation chain

For a taxable document or line (the rounding points are in §7):

```text
Exclusive:  DPP            = the price (after discount)
Inclusive:  DPP            = price × 100/111        [Q 4]
            DPP Nilai Lain = DPP × 11/12
            PPN            = DPP Nilai Lain × 12 %  [Q 3]
            Total          = DPP + PPN
```

### 3.5 When PPN is due (tax point)

PPN falls due at the **earlier** of:

- the delivery of the goods or the completion of the service; or
- the receipt of payment, when payment arrives before delivery (an
  advance).

| Event | Tax invoice | Dated |
| --- | --- | --- |
| Advance received before delivery | Advance tax invoice (faktur uang muka), for the DPP received | The receipt date |
| Delivery after one or more advances | Settlement tax invoice (faktur pelunasan) for the rest: full DPP less the advances' DPP | The delivery date |
| Delivery with no advance | Normal tax invoice | The delivery date |
| Service billed on completion | Normal or settlement tax invoice | The completion / billing date |

- The commercial invoice may be issued later than the delivery. The tax
  invoice is still dated at the delivery, and falls in the delivery's tax
  period.
- **PPN is acknowledged once.** The advance's PPN is due at receipt. The
  settlement invoice carries only the PPN on what remains. The advances'
  tax invoices are referenced, not repeated.
- A bill for an advance is not a tax point. Its PPN is an estimate until the
  money arrives.

### 3.6 VAT collectors (WAPU)

- When the buyer is a designated VAT collector, the buyer withholds the PPN
  and deposits it itself.
- The seller still issues the tax invoice, with the collector's transaction
  code (§5.1), and still owes the PPN on paper. It receives the price without
  the PPN.
- The PPN the buyer kept explains part of the cash shortfall, by rule
  (§4.5).
- It is carried on its own account rather than the ordinary output-VAT
  account, so the two reconcile separately.
- Today only government collectors are distinguished. **[Q 13]**

### 3.7 Corrections

| Situation | Correction | Effect |
| --- | --- | --- |
| A reported tax invoice overstates the transaction (e.g. part of an advance refunded) | **Replacement tax invoice** (faktur pengganti) | Keeps the original's date and so corrects the original period. The original becomes *replaced* once the replacement is reported |
| The transaction behind a reported tax invoice disappears entirely | **Cancellation** (pembatalan) | The original becomes *cancelled* |
| A tax invoice not yet reported is wrong | Corrected in place | Nothing was reported yet, so nothing needs a correction document |
| Goods already invoiced are returned | **Return note** (nota retur) | Reduces DPP and PPN in the **period of the return**, not the original period. A PKP buyer issues the return note, so the seller records the buyer's number. **[Q 15]** |

---

## 4. PPh withholding

### 4.1 Withholding types

Each withholding type is master data holding:

- a rate;
- a description of its tax object;
- the account that carries the withheld amount.

The common ones:

| Type | Typical rate | Object |
| --- | --- | --- |
| PPh 22 | 1,5 % | Goods bought by a designated collector (government treasurer, certain BUMN) |
| PPh 23 | 2 % | Services; 15 % on dividends, interest and royalties |
| PPh 4(2) | per object (e.g. rent 10 %) | Final withholding |

- PPh 22 and PPh 23 withheld from the company are **prepaid tax**: a
  credit against the company's annual income tax, once the withholding slip is
  in hand.
- PPh 4(2) is **final**: it cannot be credited. **[Q 22]**

### 4.2 Which lines are withheld

- The withholding type is set **per line of the transaction**.
- A line may start from a rule, then the user can change it:
  - goods sold to a PPh 22 collector → PPh 22;
  - a service sold to a PPh 23 withholder → PPh 23.
- The base is the line's **DPP** (never including PPN).
- One document may carry several withholding types. Each is computed on the
  DPP of its own lines.

### 4.3 PPh exists at payment

- **Withholding is recognised when payment is recorded, never earlier.** PPh
  23 is due when a payment is made or falls due, and PPh 22 at payment.
- Orders, bills and invoices show the withholding only as an **estimate**, so
  both sides know the cash to expect.
- When a payment is recorded:
  1. The withholding is **assumed to exist**, by rule: the payment explains
     its shortfall with the PPh the payer is expected to have kept.
  2. The withheld PPh is booked on the withholding type's account.
  3. A **pending withholding slip** is created for each withholding type the
     payment carries (§6).
- The rule's figure is the default. **[Q 18]** asks whether the user may
  change it.

### 4.4 Advances and withholding

- A payer that withholds does so on the advance too, on the advance's DPP.
  The PPh estimate on an advance comes from the underlying transaction's
  lines: the advance's DPP is shared over the lines by the withholding type
  each carries.
- When the final invoice deducts the advance, it withholds only on what
  remains. The advance's PPh was already withheld when the advance was paid.

### 4.5 The cash shortfall rule

What a payment settles is:

```text
cash received + bank charges + PPh withheld + PPN kept by a VAT collector
```

- A payment that settles the whole remainder takes all remaining withholding
  and collector PPN.
- A partial payment takes each component in proportion.
- Each split is cumulative: the payment that clears the bill takes what is
  left, so the parts always add up to the bill (§7.4).

---

## 5. The tax invoice as a record

### 5.1 What a tax invoice record holds

| Element | Notes |
| --- | --- |
| Kind | Advance, settlement, normal, replacement, cancellation, return |
| Source | The transaction that gave rise to it (a receipt, a delivery or invoice, a return), and the tax invoice it corrects or the advances it deducts |
| Date | The tax point (§3.5); a replacement keeps the original's date |
| Parties | The seller, and the buyer's tax identity and billing address at the time |
| Transaction code | 04 (DPP Nilai Lain) for the normal case; 02 for a government collector; others as they arise. **[Q 12]** |
| Figures | DPP, DPP Nilai Lain, PPN (and PPnBM if ever needed), per line and in total. The rate and factor used. Any advances deducted |
| Deadline | Upload by the **15th of the following month** |
| Tax invoice number (NSFP) | 17 digits, given by the tax authority when the invoice is approved, and recorded here by the user |

### 5.2 Lifecycle

```text
Awaiting upload ──upload recorded (number, date)──> Reported
      │                                                │
      └─ corrected or voided in place            replaced ──> Replaced
         (still unreported)                      cancelled ──> Cancelled
```

- It is **created automatically** by the transaction at the tax point, never
  by hand.
- **Awaiting upload** is the to-do state. Past its deadline it is flagged
  **late**. **[Q 11]**
- **Reported** means the user has recorded the tax invoice number and
  upload date from the tax authority's system.
- A correction creates a new record in *awaiting upload*. The original's
  state changes only when the correction is reported.

---

## 6. The withholding slip as a record

### 6.1 What a slip record holds

| Element | Notes |
| --- | --- |
| Source | The payment that recognised the withholding, and the transaction it settled |
| Party | The withholder, with its tax identity |
| Withholding type, rate, base, amount | As recognised at payment (§4.3) |
| Tax period | The payment's month |
| Expected by | The withholder deposits by the 15th and reports by the **20th of the following month**; the slip (BPPU) is normally available after that |
| Slip number, date, amount | Recorded when the slip is received |

### 6.2 Lifecycle

```text
Awaiting ──slip received (number, date, amount)──> Received
   │                                                  │
   │                         transaction reduced ─────┤
   ▼                                                  ▼
Needs correction <────────────────────────────────────┘
   │
   └─ corrected slip received ──> Received
```

- It is **created automatically** as *awaiting* when a payment carrying
  withholding is recorded. There is one slip per payment per withholding
  type. **[Q 19]**
- **Awaiting** past its expected date is flagged **late**.
- **Received** means the slip is in hand, so the prepaid tax can be credited.
- **Needs correction** is set when a refund, a return or a cancellation
  reduces the transaction after the PPh was withheld. The slip shows the
  corrected amount, and the payer must issue a corrected slip.
- A slip that never arrives is **[Q 20]**.

---

## 7. Rounding

### 7.1 The rule

**PER-11/PJ/2025, article 129**, for the Coretax era:

- DPP, PPN and PPnBM on a tax invoice (and documents treated as one), and
  the DPP and PPh on a withholding slip, are rounded **to whole rupiah**:
  - a fraction **below 0,50 rounds down**;
  - a fraction **of 0,50 or more rounds up**.

  Example: PPN of Rp1.900.000,50 is reported as Rp1.900.001.
- Amounts in US dollars round to two decimals. **[verify]**: sources differ
  on the exact 0,50 boundary and on the direction for foreign currency.
- **This differs from what the simulation does, and so from what is built
  today.** Both **floor** PPN and PPh (the e-Faktur-era practice). **[Q 1]**

### 7.2 Where rounding happens

- **Level. [Q 2]** A tax invoice in the tax authority's system carries DPP,
  DPP Nilai Lain and PPN **per line**, and its totals are the sum of the
  lines. Computing per document and then allocating to lines can produce a
  total one rupiah off the sum of rounded lines.
- **Each step of the chain is rounded:**

  ```text
  DPP → round → DPP Nilai Lain → round → PPN → round
  ```

  So PPN = round(12 % × round(DPP × 11/12)). This can differ by a rupiah
  from 11 % × DPP. **[Q 3]**
- **DPP Nilai Lain is a whole-rupiah figure**, not a two-decimal one.
  **[Q 5]**

### 7.3 Allocation

- When a total must be shared over lines (a document-level discount, PPN
  computed on a total, an advance's DPP shared by withholding type), each line
  takes its rounded share by weight.
- **The largest line absorbs the remainder**, so the lines sum exactly to the
  total.

### 7.4 Splits over time

When one tax figure is settled in parts (partial payments of an advance,
deductions from later invoices, refunds):

- each part takes its rounded share **cumulatively**: the running total
  rounded, less the parts already taken;
- the **part that closes the figure takes whatever is left**.

The parts therefore always add up to the figure that was reported, and no
rupiah is created or lost by rounding.

### 7.5 Commercial document and tax invoice

- The commercial bill shows the **same** DPP, PPN and total as its tax
  invoice, so the customer pays what is reported.
- A typed inclusive price whose DPP + PPN comes back one rupiah different is
  **[Q 4]**.

---

## 8. Foreign currency

- Tax is reported in rupiah. A transaction in a foreign currency converts
  its tax figures at the **Minister of Finance rate (kurs KMK)**. The rate is
  set weekly, valid Wednesday to Tuesday, and the one used is the rate in
  force on the tax point date.
- That rate is a **tax** rate. It is independent of the rate the books use
  for the transaction (see the multi-currency concept). The difference
  between the two is not a tax figure and is never posted as one.
- The tax record stores the rate used. **[Q 14]**

---

## 9. How tax touches the books

Only transactions post; tax documents never do (§1.3). The postings, in
general terms:

| Event | Tax lines |
| --- | --- |
| Advance received | Cr **advance liability** (at DPP), Cr **output VAT** (the advance's PPN), Dr **prepaid PPh** (withheld), Dr **VAT-collector clearing** (PPN kept by a collector) |
| Invoice after advances | Dr receivable (net), Dr advance liability (the advance's DPP deducted) / Cr revenue (full DPP), Cr output VAT (net of the advances' PPN) |
| Invoice paid | Dr cash, Dr prepaid PPh, Dr VAT-collector clearing / Cr receivable |
| Advance refunded | Reverses the refunded share of liability, output VAT, prepaid PPh and collector PPN, in proportion |
| Return | Dr sales returns, Dr output VAT / Cr receivable, or a customer credit for the paid part. The PPh on the returned value comes back off the slip (§6.2) |

Per-party positions (receivable, advance) sit on accounts that require a
party, so every such line names it.

---

## 10. The purchase side (outline)

The same concepts mirror onto buying, with the roles reversed. Detailed when
purchasing is built. **[Q 24]**

- **Input VAT** comes from the supplier's tax invoice. It is creditable only
  with a valid tax invoice in hand. The record tracks *awaiting the
  supplier's tax invoice* → *received / credited*.
- **Withholding by the company:** when the company pays a supplier for a
  service or a withholdable object, it withholds PPh. It **issues** the slip,
  deposits the tax by the 15th and reports it by the 20th of the following
  month. The record tracks *to be issued* → *issued* → *deposited /
  reported*.

---

## 11. Open questions

**Rounding and computation**

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Replace the current round-down (floor) with PER-11/PJ/2025's **half-up to whole rupiah** for DPP, DPP Nilai Lain, PPN and PPh? | Yes. The regulation is explicit, and a figure that differs from the reported one by a rupiah is a reconciliation problem. The built Sales Order and advance change with it |
| Q2 | Round **per line then sum** (as the tax invoice carries lines), or per document then allocate (today)? | Per line then sum, so the stored document equals the tax invoice line for line. A document-level discount is allocated to lines first |
| Q3 | PPN as **round(12 % × round(DPP × 11/12))**, the chain the tax invoice shows, or round(11 % × DPP) (today)? | The chain: it is what the tax invoice reports |
| Q4 | Inclusive prices: DPP = round(price × 100/111), then the chain. The total is then DPP + PPN, which may differ by Rp1 from what was typed. Keep the typed total and absorb the rupiah in DPP, or show the recomputed total? | Absorb it in DPP so the customer pays exactly the typed price, provided the chain still reproduces the PPN. To confirm with worked examples |
| Q5 | Store DPP Nilai Lain as whole rupiah? | Yes, as the tax invoice does |
| Q6 | PPh: round each withholding slip line half-up to whole rupiah as well? | Yes (PER-11 applies to withholding slips) |
| Q7 | Make the PPN rate and the 11/12 factor effective-dated values, stored on each document? | Yes. The next rate change then needs no code change |
| Q8 | Luxury goods (12 % on full price, PPnBM): in scope? | Out of scope now; the effective-dated rate leaves room |
| Q9 | May one document mix taxable and non-taxable lines, or is PPN one decision per document (today)? | One per document, until a real case needs mixing |

**Tax invoice**

| # | Question | Recommendation |
| --- | --- | --- |
| Q10 | Is every sale to be recorded with a tax invoice, including to a non-PKP buyer or an individual identified by NIK? | Yes, every taxable delivery by a PKP |
| Q11 | States: *awaiting upload → reported → replaced / cancelled*, with a *late* flag. Is a *rejected by the tax authority* state needed? | Not needed: a rejected upload stays *awaiting upload* with a note |
| Q12 | Transaction codes: 04 by default, 02 for government collectors. Stored on the record, set by rule, not typed. Which others now (01, 03, 07, 08)? | 04 and 02 now; 03 when non-government collectors come (Q13) |
| Q13 | Non-government VAT collectors (certain BUMN, code 03): support now? | Later, as a second collector type on the party |
| Q14 | Foreign-currency tax figures at the KMK rate: keep a weekly KMK rate table, and store the rate on the record? | Yes, when the first foreign-currency sale is built |
| Q15 | A return to a **non-PKP** buyer: who issues the return note, and what does the record wait for? | [verify] |
| Q16 | Is a draft tax invoice fully derived (no manual edits except recording the upload)? | Yes. A wrong figure is fixed at its source transaction while unreported |
| Q17 | NITKU: one per billing address, recorded on the tax invoice? (C23) | Yes, when the tax invoice record is built |

**Withholding slip**

| # | Question | Recommendation |
| --- | --- | --- |
| Q18 | At payment, the withholding is filled in by rule. May the user change it (the payer withheld more, less or none)? | Yes, per withholding type. A zero amount creates no slip. The difference from the rule's figure stays visible |
| Q19 | One slip per payment per withholding type, or one per settled invoice? | Per payment per type, as the payer issues it at payment |
| Q20 | A slip that **never arrives**: is there a terminal state (*written off*), with a separate financial document moving the prepaid tax to expense or a claim on the payer? | Yes. The slip itself still never posts |
| Q21 | A slip received with an amount different from the one recorded: record the slip's amount and flag the difference, corrected by a financial document? | Yes |
| Q22 | Final withholding (PPh 4(2)): booked straight to expense rather than to prepaid tax? And does it still produce a slip record? | Expense via its own account (already set per withholding type); slip record yes, for completeness |
| Q23 | The surcharge for a party without NPWP (+100 % on PPh 22 / 23): handle? | Not now: NIK now serves as NPWP, so the case is rare |

**Scope**

| # | Question | Recommendation |
| --- | --- | --- |
| Q24 | Should this concept already fix the purchase side (§10), or only outline it? | Outline only; detailed when purchasing is built |
| Q25 | A period summary (output VAT per month, awaiting and late items, slips outstanding) as a reconciliation aid for the monthly VAT return: part of the concept? | Yes as a read-only report; never a filing |

---

## 12. To verify with a tax consultant

- The 0,50 boundary and the foreign-currency rounding rule (§7.1).
- Whether the tax authority's system rounds per line or on the total, and
  whether PPN is computed from the rounded DPP Nilai Lain (Q2, Q3).
- Transaction code 04 for DPP Nilai Lain to every buyer type, and 02 for
  government collectors.
- The PPh 22 rate for goods sold to a government treasurer.
- Replacement versus cancellation when an advance is partly or fully
  refunded.
- The return note for a non-PKP buyer.
- The tax invoice number (NSFP) format in the Coretax era.

---

## 13. References

- UU PPN (as amended by UU HPP); PMK 131/2024 (PPN 12 %, DPP Nilai Lain
  11/12).
- PMK 81/2024 (tax provisions for the Coretax system: tax invoice timing,
  15th-of-next-month reporting, withholding slips).
- **PER-11/PJ/2025, article 129** (rounding to whole rupiah).
- UU PPh articles 4(2), 22 and 23; the Minister of Finance weekly exchange
  rate decisions (KMK).
- Internal: the open-item concept and the multi-currency concept.
