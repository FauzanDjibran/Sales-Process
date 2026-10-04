# Tax Concept

> **Status: settled 29/09/2026.** This document records
> how tax works in the system, under Indonesian tax law. Like the open-item
> and multi-currency concepts, it names no menu, screen, table or product. It
> describes transactions, documents and records in general terms, so it
> applies to any module that sells, buys, bills or pays.
>
> Every point is written as a rule; §11 lists the decisions behind them.
> Points marked **[verify]** need a tax consultant's confirmation (§12). The
> document keeps evolving during development, and a later decision is added
> to §11.

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
   already booked the tax. The tax document records that the obligation exists
   and tracks what has been done about it.
4. **The system is a register, not a gateway.** It does not connect to the
   tax authority's system (Coretax). It records:
   - which tax documents must exist;
   - their figures and deadlines;
   - what the user reports has happened: uploaded, numbered, received,
     replaced or cancelled.

   Filing happens outside the system, and the result is recorded back in it.
5. **Tax is measured in whole rupiah** (§7), whatever the currency of the
   transaction (§8).
6. **A tax fact is frozen when it is recorded.** A document stores the rates,
   factors and figures it was computed with. A later change to a setting or a
   master (the PPN rate, a withholding rate) never changes a document already
   recorded.
7. **Corrections are new documents.** A reported tax document is never
   edited. A replacement, a cancellation or a return is its own document that
   points to the one it corrects.

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
| NITKU | The 22-digit place-of-business identity. **One per billing address**, named on the tax invoice. Built with the tax invoice record |

Role-specific tax behaviour sits beside the identity and applies only to the
role concerned:

| Behaviour | Effect |
| --- | --- |
| Withholds PPh 23 | The party deducts PPh 23 from what it pays for services |
| Collects PPh 22 | The party deducts PPh 22 from what it pays for goods |
| VAT collector (Pemungut PPN) | The party withholds the PPN itself and deposits it (§3.6) |

A transaction with a party whose tax identity is incomplete is refused.

---

## 3. PPN (VAT)

### 3.1 Whether a transaction carries PPN

- Whether PPN applies is **a decision on the transaction**, not a property of
  the item sold.
- It is made **once per document**. One document does not mix taxable and
  non-taxable lines.
- A non-taxable transaction has no PPN, whatever its price mode: its prices
  are its amounts.
- Everything downstream of a non-taxable transaction (advance, delivery,
  invoice, payment) is non-taxable too, and **no tax invoice is ever made
  for it**.

### 3.2 Price mode

Prices on a transaction are typed either **exclusive** of PPN (the price is
the DPP) or **inclusive** of it (the price already holds the PPN). The mode is
chosen per document. A party may carry a default.

### 3.3 Rate and base

Under PMK 131/2024, in force since 1 January 2025, goods and services that
are not luxury are taxed at **12 % on a DPP Nilai Lain of 11/12** of the price,
so the effective rate is 11 %.

- The **PPN rate** (12 %) and the **DPP Nilai Lain factor** (11/12) are
  **one system-wide setting each**, not constants. An authorised user changes
  them when the law changes.
- **Every transaction snapshots them.** When a transaction is recorded, it
  copies the rate and the factor in force at that moment and carries them from
  then on (§1.6). Each transaction takes its own snapshot; it does not inherit
  one from the document it came from.
- A change to the setting therefore affects only transactions recorded after
  the change. The setting is changed on the day the new law takes effect.
- Luxury goods (12 % on the full price, PPnBM) are out of scope for now.

### 3.4 The computation chain

For a taxable amount, each step is rounded to whole rupiah (§7.1) before the
next one uses it:

```text
DPP             = the amount after discount            (exclusive price)
DPP Nilai Lain  = round(DPP × 11/12)
PPN             = round(DPP Nilai Lain × 12 %)
Total           = DPP + PPN
```

This is the chain a tax invoice reports: its DPP Nilai Lain is a whole-rupiah
figure, and its PPN is the rate applied to that figure.

**Inclusive prices.** The PPN in a typed inclusive price is taken out so that
DPP + PPN equals the typed price, with the difference **absorbed in the DPP**:
the DPP is the largest whole-rupiah figure whose DPP + PPN does not exceed the
typed price.

- About one typed price in ten has no exact split under the chain. For
  example, a typed 1.004 gives DPP 904 → total 1.003, or DPP 905 → total
  1.005, and nothing in between.
- In that case the total is **one rupiah below** the typed price. The customer
  is never billed above the quoted price, and the PPN still matches the tax
  invoice.

### 3.5 When PPN is due (tax point)

PPN falls due at the **earlier** of:

- the delivery of the goods or the completion of the service; or
- the receipt of payment, when payment arrives before delivery (an advance).

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
  settlement invoice carries only the PPN on what remains, and references the
  advances' tax invoices.
- A bill for an advance is not a tax point. Its PPN is an estimate until the
  money arrives.

### 3.6 VAT collectors (WAPU)

**Later.** The company trades mainly with the private sector, so the basic
case comes first. For the record:

- when the buyer is a designated VAT collector (government, certain BUMN), it
  withholds the PPN and deposits it itself;
- the seller still issues the tax invoice and receives the price without the
  PPN;
- the PPN kept explains part of the cash shortfall (§4.5), and sits on its
  own account so it reconciles separately.

### 3.7 Corrections

| Situation | Correction | Effect |
| --- | --- | --- |
| A reported tax invoice overstates the transaction (e.g. part of an advance refunded) | **Replacement tax invoice** (faktur pengganti) | Keeps the original's date, so corrects the original period. The original becomes *replaced* once the replacement is reported |
| The transaction behind a reported tax invoice disappears entirely | **Cancellation** (pembatalan) | The original becomes *cancelled* |
| A tax invoice not yet reported is wrong | Corrected at its source | Nothing was reported yet, so nothing needs a correction document |
| Goods already invoiced are returned | **Return note** (nota retur) | Reduces DPP and PPN in the **period of the return**. A PKP buyer issues the return note, so the seller records the buyer's number. A return from a non-PKP buyer is settled later |

---

## 4. PPh withholding

### 4.1 Withholding types

Each withholding type is master data holding:

- a rate;
- a description of its tax object;
- the account that carries the withheld amount.

| Type | Typical rate | Object |
| --- | --- | --- |
| PPh 22 | 1,5 % | Goods bought by a designated collector |
| PPh 23 | 2 % | Services; 15 % on dividends, interest and royalties |

- PPh 22 and PPh 23 withheld from the company are **prepaid tax**: a credit
  against the company's annual income tax, once the withholding slip is in
  hand.
- Final withholding (such as PPh 4(2)) is out of scope until it is needed.

### 4.2 Which lines are withheld

- The withholding type is set **per line of the transaction**.
- The user picks the withholding type on each line. Nothing is pre-filled
  for now. A rule may be added later (goods to a PPh 22 collector → PPh 22; a
  service to a PPh 23 withholder → PPh 23).
- The base is the line's **DPP**, never including PPN.
- One document may carry several withholding types. Each is computed on the
  DPP of its own lines.
- The PPh is `round(base × rate)`, to whole rupiah (§7.1).

### 4.3 PPh exists at payment

- **Withholding is recognised when payment is recorded, never earlier.** PPh
  23 is due when a payment is made or falls due, and PPh 22 at payment.
- Orders, bills and invoices show the withholding only as an **estimate**, so
  both sides know the cash to expect.
- When a payment is recorded:
  1. The withholding is **assumed to exist**, by rule: the payment explains
     its shortfall with the PPh the payer is expected to have kept.
  2. The withheld PPh is booked on the withholding type's account.
  3. A **pending withholding slip** is created per settled document, per
     payment, per withholding type (§6).
- **The user never types a PPh amount.** A payment for a bill that carries
  withholding has one switch, *PPh withheld* (on by default):
  - **on**: the withholding is computed by rule;
  - **off**: the payer paid without withholding, so there is no PPh and no
    slip, and the cash settles the bill in full.
- A payer who withheld a different amount than the rule's figure is not
  modelled. The rule's figure is recorded.

### 4.4 Advances and withholding

- A payer that withholds does so on the advance too, on the advance's DPP.
  The PPh estimate on an advance comes from the underlying transaction: the
  advance's DPP is shared over its lines by the withholding type each carries.
- When the final invoice deducts the advance, it withholds only on what
  remains. The advance's PPh was already withheld when the advance was paid.

### 4.5 The cash shortfall rule

What a payment settles is:

```text
cash received + bank charges + PPh withheld (+ PPN kept by a VAT collector, later)
```

- A payment that settles the whole remainder takes all the remaining
  withholding.
- A partial payment takes each component in proportion.
- Each split is cumulative: the payment that clears the bill takes what is
  left, so the parts always add up to the bill (§7.4).
- The cash is what the user enters; the rest follows from it. Cash that
  reaches the remainder less its remaining withholding clears the bill, the
  gap being the PPh. Less cash settles the smallest part whose cash, after its
  own share of each withholding, is exactly what was received; the rest of the
  bill stays open.

---

## 5. The tax invoice as a record

### 5.1 What a tax invoice record holds

| Element | Notes |
| --- | --- |
| Kind | Advance, settlement, normal, replacement, cancellation, return |
| Source | The transaction that gave rise to it (a receipt, a delivery or invoice, a return), and the tax invoice it corrects or the advances it deducts |
| Date | The tax point (§3.5); a replacement keeps the original's date |
| Parties | The seller, and the buyer's tax identity, billing address and NITKU at the time |
| Figures | DPP, DPP Nilai Lain and PPN, per line and in total, with the rate and factor used, and any advances deducted |
| Deadline | Upload by the **15th of the following month** |
| Tax invoice number (NSFP) | Given by the tax authority when the invoice is approved; recorded here by the user |

- **Transaction codes are not modelled for now.** Every tax invoice is the
  basic private-sector case. Codes return when WAPU or special cases do.
- A tax invoice record is **fully derived** from its source transaction. The
  user never edits its figures. A wrong figure is fixed at the source while the
  invoice is still unreported, or by a correction afterwards.

### 5.2 Lifecycle

The tax invoice record is an **internal record**, one per event: the PPN
Keluaran a transaction gave rise to, with its figures, buyer and source. It is
complete the moment the transaction posts. Coretax is where it is reported,
not what the record is for (decided 04/10/2026, P101 of the ERP).

```text
Recorded ──NSFP filled in / corrected / cleared──> Recorded
```

- It is **created automatically** by the transaction at the tax point, never
  by hand, and only for a taxable transaction.
- It has **no upload lifecycle**. The **NSFP** the tax authority gives, and the
  upload date, are an optional reference the user fills in; a mistyped one is
  corrected, and every change is in the record's history. The figures never
  change.
- A record still without an NSFP past its deadline is flagged as a
  **reminder**, not a state.
- A correction (replacement, cancellation) is a new record; how it relates to
  the original is decided when corrections are built.

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
| Slip number, date | Recorded when the slip is received |

### 6.2 Lifecycle

```text
Awaiting ──slip received (number, date)──> Received
   │                                          │
   │                  transaction reduced ────┤
   ▼                                          ▼
Needs correction <────────────────────────────┘
   │
   └─ corrected slip received ──> Received
```

- It is **created automatically** as *awaiting*, **one per settled document,
  per payment, per withholding type**, when a payment carrying withholding is
  recorded. A payer's slip refers to one base document, so a payment settling
  two withheld bills yields two slips, and a bill paid in two instalments
  yields one per instalment.
- **Awaiting** past its expected date is flagged **late**. A slip that never
  arrives simply stays *awaiting* and late. How it is eventually closed is
  decided later.
- **Received** means the slip is in hand, so the prepaid tax can be credited.
  For now the slip is assumed to show the amount recorded. A slip that
  differs is handled later. A mistyped slip number or date is corrected on
  the record, which stays received; the change is in its history.
- **Needs correction** is set when a refund, a return or a cancellation
  reduces the transaction after the PPh was withheld. The payer must then
  issue a corrected slip.

---

## 7. Rounding

### 7.1 The rule

**PER-11/PJ/2025, article 129.** DPP, DPP Nilai Lain, PPN and PPnBM on a tax
invoice, and the DPP and PPh on a withholding slip, are rounded to **whole
rupiah, half up**:

- a fraction below 0,50 rounds down;
- a fraction of 0,50 or more rounds up.

Example: PPN of Rp1.900.000,50 becomes Rp1.900.001.

- **Every tax figure is rounded this way.** This replaces the round-down
  (floor) of the e-Faktur era.
- Money is stored with two decimals, but a tax figure always holds a whole
  rupiah value.
- **[verify]** Sources word the exact 0,50 boundary differently.

### 7.2 Rounding inside the chain

- Each step of §3.4 is rounded before the next uses it:

  ```text
  PPN = round(12 % × round(DPP × 11/12))
  ```

- This is **not drift**. It is the figure the tax invoice reports, because
  the invoice shows DPP Nilai Lain as a whole rupiah and PPN as 12 % of it.
- Compared with the older one-step `round(11 % × DPP)`, the chain gives the
  same PPN in about 97 of 100 amounts and never differs by more than Rp1.
  Rounding DPP Nilai Lain moves it by at most Rp0,50, which moves PPN by at
  most Rp0,06 before PPN's own rounding.
- The difference **cannot accumulate**. Each amount is computed from its own
  DPP, never from a previously rounded PPN.

### 7.3 The level at which PPN is computed

**PPN is computed per line, and the document's figures are the sum of its
lines.**

- On a tax invoice, each line carries its own DPP, DPP Nilai Lain and PPN, and
  the invoice total is the sum of the lines.
- Computing PPN once on the document's total DPP would differ from that sum in
  a large share of multi-line documents, usually by Rp1. For example, two lines
  of DPP 1.000.003 give 110.000 + 110.000 = **220.000** per line, but
  **220.001** once on the total of 2.000.006.
- The books would then carry output VAT that the tax invoice does not show.
  Per line, the stored document equals the tax invoice line for line.
- Each line's DPP, DPP Nilai Lain and PPN are **stored**. They are figures
  for the tax invoice and the books, and do not need to be shown on the
  line itself.
- **[verify]** Confirm with one test invoice of two lines of DPP 1.000.003 in
  the tax authority's system; it should show 220.000.

### 7.4 Allocation

- When a total must be shared over lines (an advance's DPP shared by
  withholding type, a document-level amount spread over lines), each line
  takes its rounded share by weight.
- **The largest line absorbs the remainder**, so the lines sum exactly to the
  total.

### 7.5 Splits over time

When one tax figure is settled in parts (partial payments of an advance,
deductions from later invoices, refunds):

- each part takes its share **cumulatively**: the running total rounded, less
  the parts already taken;
- the **part that closes the figure takes whatever is left**.

The parts always add up to the figure that was reported. No rupiah is created
or lost.

### 7.6 Commercial document and tax invoice

The commercial bill shows the **same** DPP, PPN and total as its tax invoice,
so the customer pays what is reported.

---

## 8. Foreign currency

**When multi-currency transactions are introduced.** For the record:

- Tax is reported in rupiah. A transaction in a foreign currency converts its
  tax figures at the **Minister of Finance rate (kurs KMK)**. The rate is set
  weekly, valid Wednesday to Tuesday, and the one used is the rate in force on
  the tax point date.
- That rate is a **tax** rate, independent of the rate the books use for the
  transaction (see the multi-currency concept).
- The rate used is stored on the tax record. The system keeps a table of the
  weekly rates.

---

## 9. How tax touches the books

Only transactions post; tax documents never do (§1.3).

| Event | Tax lines |
| --- | --- |
| Advance received | Dr cash / Cr **advance liability** (at DPP), Cr **output VAT** (the advance's PPN); Dr **prepaid PPh** (withheld) |
| Invoice after advances | Dr receivable (net), Dr advance liability (the advance's DPP deducted) / Cr revenue (full DPP), Cr output VAT (net of the advances' PPN) |
| Invoice paid | Dr cash, Dr prepaid PPh / Cr receivable |
| Advance refunded | Reverses the refunded share of liability, output VAT and prepaid PPh, in proportion |
| Return | Dr sales returns, Dr output VAT / Cr receivable, or a customer credit for the paid part. The PPh on the returned value comes back off the slip (§6.2) |

Per-party positions (receivable, advance) sit on accounts that require a
party, so every such line names it.

---

## 10. Periodic tax report and the purchase side

### 10.1 Periodic tax report

A read-only report per tax period (month) that helps prepare the monthly
returns. It never files anything:

- output VAT: the tax invoices of the period, and their totals;
- tax invoices still without an NSFP, and those past their deadline;
- withholding slips *awaiting*, *late* and *needs correction*, with the
  prepaid PPh they hold.

### 10.2 The purchase side (outline)

The same concepts mirror onto buying, with the roles reversed. Detailed when
purchasing is built.

- **Input VAT** comes from the supplier's tax invoice. It is creditable only
  with a valid tax invoice in hand. The record tracks *awaiting the
  supplier's tax invoice* → *received / credited*.
- **Withholding by the company:** when the company pays for a service or a
  withholdable object, it withholds PPh. It **issues** the slip, deposits the
  tax by the 15th and reports it by the 20th of the following month. The
  record tracks *to be issued* → *issued* → *deposited / reported*.

---

## 11. Decisions (29/09/2026)

| # | Decision |
| --- | --- |
| Q1 | Tax figures round **half up to whole rupiah** (PER-11/PJ/2025), replacing floor |
| Q2 | PPN is computed **per line**; the document's figures are the sum of its lines |
| Q3 | PPN follows the **chain**: `round(12 % × round(DPP × 11/12))` |
| Q4 | An inclusive price's difference is **absorbed in the DPP**. Where no exact split exists, the total is one rupiah below the typed price |
| Q5 | Rounding DPP Nilai Lain is accepted: at most Rp1 from `round(11 % × DPP)`, and never accumulating (§7.2) |
| Q6 | PPh rounds half up to whole rupiah |
| Q7 | The PPN rate and the DPP Nilai Lain factor are **one system-wide setting each**. Every transaction snapshots them when it is recorded and carries them |
| Q8 | Luxury goods / PPnBM: not now |
| Q9 | PPN is one decision per document; no mixed documents |
| Q10 | A tax invoice exists only when the transaction carries PPN. A non-taxable transaction and everything downstream of it never produce one |
| Q11 | No *rejected* state for a tax invoice |
| Q12 | Transaction codes are not modelled; basic private-sector tax invoices first |
| Q13 | VAT collectors (WAPU): later |
| Q14 | Kurs KMK for foreign-currency tax figures: when multi-currency transactions come |
| Q15 | Return note for a non-PKP buyer: later |
| Q16 | A tax invoice record is fully derived; no manual edits of its figures |
| Q17 | NITKU: one per billing address, on the tax invoice; built later |
| Q18 | No manual PPh amount. A payment has a *PPh withheld* switch: on computes by rule, off means no PPh and no slip. A different withheld amount is not modelled |
| Q19 | One withholding slip per settled document, per payment, per withholding type (amended 30/09/2026: a payment may settle several documents, and a payer's slip refers to one) |
| Q20 | A slip that never arrives stays *awaiting* (late); its closing is decided later |
| Q21 | A received slip is assumed to match the recorded amount |
| Q22 | Final withholding (PPh 4(2)) is out of scope until needed; no *final* mark |
| Q23 | The no-NPWP surcharge: not now |
| Q24 | Purchase side: outline only |
| Q25 | A periodic tax report, read-only |

---

## 12. To verify with a tax consultant

- The exact 0,50 boundary (§7.1).
- That the tax authority's system computes PPN per line from the rounded DPP
  Nilai Lain, and sums the lines (§7.2, §7.3).
- The PPh 22 rate for goods sold to a government treasurer (when WAPU comes).
- Replacement versus cancellation when an advance is partly or fully
  refunded.
- The tax invoice number (NSFP) format in the Coretax era.

---

## 13. References

- UU PPN (as amended by UU HPP); PMK 131/2024 (PPN 12 %, DPP Nilai Lain
  11/12).
- PMK 81/2024 (tax provisions for the Coretax system: tax invoice timing,
  15th-of-next-month reporting, withholding slips).
- **PER-11/PJ/2025, article 129** (rounding to whole rupiah).
- UU PPh articles 22 and 23; the Minister of Finance weekly exchange
  rate decisions (KMK).
- Internal: the open-item concept and the multi-currency concept.
