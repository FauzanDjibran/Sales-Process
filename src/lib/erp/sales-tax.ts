/**
 * The sales tax arithmetic — the one place DPP, DPP Nilai Lain, PPN and the
 * PPh estimate are computed (Claude-ERP.md §7, §14; `tax_concept.md` §3, §7).
 *
 * Client-safe and pure: a form previews exactly what its Server Action stores,
 * because both call this. The rules (P59, P60):
 *
 *   every tax figure  whole rupiah, rounded half up (PER-11/PJ/2025 art. 129)
 *   per line          DPP Nilai Lain = round(DPP × pembilang / penyebut)
 *                     PPN            = round(DPP Nilai Lain × tarif)
 *   the document      the sum of its lines, as the faktur pajak carries them
 *   inclusive price   DPP is the largest whole rupiah whose DPP + PPN does not
 *                     exceed the price, so the difference sits in the DPP and
 *                     the total is at most one rupiah under the typed price
 *   PPh               round(DPP of the lines it covers × tarif), per Jenis PPh
 *
 * The rate and the factor are never constants here: each document passes the
 * ones it snapshotted from the System Default (P60).
 *
 * Every division that rounds is done on integers (BigInt), so a figure that
 * sits exactly on half a rupiah rounds up the way the regulation says, however
 * large, and never lands on the wrong side by a floating-point hair.
 *
 * A document is Kena PPN or not as a whole (P52). A non-taxable document has no
 * PPN whatever its price mode: its prices are its amounts.
 */

export type PriceMode = "Exclude" | "Include";
export type DiscountType = "Percent" | "Amount";

/** The PPN rate and the DPP Nilai Lain factor a document computes with. */
export type PpnRates = {
  /** Percent, e.g. 12. */
  rate: number;
  /** DPP Nilai Lain = DPP × otherNum / otherDen, e.g. 11 / 12. */
  otherNum: number;
  otherDen: number;
};

// ------------------------------------------------------------- rounding

/** Scale a percent to an integer: up to four decimals, as `Decimal(9,4)` holds. */
const PCT_SCALE = 10_000;

/** round(a × num / den), half up (half away from zero), on integers. */
function mulDivRound(a: number, num: number, den: number): number {
  const n = BigInt(Math.round(a)) * BigInt(Math.round(num));
  const d = BigInt(Math.round(den));
  const neg = n < BigInt(0) !== d < BigInt(0);
  const an = n < BigInt(0) ? -n : n;
  const ad = d < BigInt(0) ? -d : d;
  let q = an / ad;
  if ((an % ad) * BigInt(2) >= ad) q += BigInt(1);
  const r = Number(q);
  return neg ? -r : r;
}

/** round(amount × percent / 100), half up — the PPh, and the PPN on DPP Nilai Lain. */
export function percentOf(amount: number, percent: number): number {
  return mulDivRound(amount, Math.round(percent * PCT_SCALE), 100 * PCT_SCALE);
}

/** DPP Nilai Lain and PPN on a whole-rupiah DPP (the chain, P59). */
export function ppnChain(dpp: number, r: PpnRates): { dppOther: number; ppn: number } {
  const dppOther = mulDivRound(dpp, r.otherNum, r.otherDen);
  return { dppOther, ppn: percentOf(dppOther, r.rate) };
}

/**
 * An inclusive price split into DPP and PPN: the largest DPP whose DPP + PPN
 * does not exceed the price (P60). DPP + PPN rises by one or two rupiah per
 * rupiah of DPP, so about one price in ten has no exact split and comes out
 * one rupiah under.
 */
export function inclusiveSplit(price: number, r: PpnRates): { dpp: number; dppOther: number; ppn: number } {
  const p = Math.round(price);
  if (p <= 0) return { dpp: p, dppOther: 0, ppn: 0 };
  const total = (d: number) => d + ppnChain(d, r).ppn;
  let d = Math.floor(p / (1 + ((r.rate / 100) * r.otherNum) / r.otherDen));
  while (d > 0 && total(d) > p) d--;
  while (total(d + 1) <= p) d++;
  return { dpp: d, ...ppnChain(d, r) };
}

/** Shares `total` by `weights`; the largest weight absorbs what flooring leaves. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const out = weights.map((w) => Math.floor((total * w) / sum));
  const left = total - out.reduce((a, b) => a + b, 0);
  out[weights.indexOf(Math.max(...weights))] += left;
  return out;
}

/** DPP, DPP Nilai Lain and PPN of one taxable (or not) amount in a price mode. */
function taxOf(amount: number, mode: PriceMode, taxable: boolean, rates: PpnRates | null) {
  if (!taxable || !rates) return { dpp: amount, dppOther: 0, ppn: 0 };
  if (mode === "Include") return inclusiveSplit(amount, rates);
  return { dpp: amount, ...ppnChain(amount, rates) };
}

// ------------------------------------------------------------------ lines

export type SalesLineInput = {
  qty: number;
  /** Per unit, in the order's price mode. */
  price: number;
  discountType: DiscountType | null;
  /** A percent for `Percent`, an amount for `Amount`. */
  discountValue: number | null;
  /** Percent, e.g. 1.5 — null when the line is not withheld. */
  withholdingRate: number | null;
  /** Groups the PPh estimate; null when not withheld. */
  withholdingKey: string | null;
};

export type SalesLineResult = {
  gross: number;
  discount: number;
  /** qty × price − discount, in the price mode. */
  amount: number;
  dpp: number;
  dppOther: number;
  ppn: number;
};

export type WithholdingEstimate = { key: string; rate: number; base: number; amount: number };

export type SalesTotals = {
  lines: SalesLineResult[];
  gross: number;
  discount: number;
  dpp: number;
  dppOther: number;
  ppn: number;
  total: number;
  withholdings: WithholdingEstimate[];
  withholdingTotal: number;
  /** PPN the buyer collects and remits itself (WAPU); it does not pay it. */
  collectedPpn: number;
  /** What the customer is expected to transfer. */
  expectedReceipt: number;
};

/** A line before tax: what it grosses, what its discount takes, what is left. */
export function lineAmount(l: Pick<SalesLineInput, "qty" | "price" | "discountType" | "discountValue">) {
  const raw = (Number(l.qty) || 0) * (Number(l.price) || 0);
  const gross = Math.round(raw);
  const v = Number(l.discountValue) || 0;
  const off = l.discountType === "Percent" ? (raw * v) / 100 : l.discountType === "Amount" ? v : 0;
  const amount = Math.round(raw - off);
  return { gross, discount: gross - amount, amount };
}

/**
 * Why a line cannot be priced, or null. The dialog and the server both ask.
 */
export function lineProblem(l: Pick<SalesLineInput, "qty" | "price" | "discountType" | "discountValue">): string | null {
  if (!(Number(l.qty) > 0)) return "Qty harus lebih dari nol.";
  if (!(Number(l.price) > 0)) return "Harga satuan harus lebih dari nol.";
  const v = l.discountValue == null ? 0 : Number(l.discountValue);
  if (l.discountType && (!Number.isFinite(v) || v < 0)) return "Diskon tidak boleh negatif.";
  if (l.discountType === "Percent" && v >= 100) return "Diskon persen harus di bawah 100%.";
  if (lineAmount(l).amount <= 0) return "Diskon tidak boleh menghabiskan nilai baris.";
  return null;
}

/** PPh per Jenis PPh on the DPP of the lines each covers, half up. */
export function withholdingsOf(bases: { key: string | null; rate: number | null; dpp: number }[]): WithholdingEstimate[] {
  const groups = new Map<string, WithholdingEstimate>();
  for (const b of bases) {
    if (!b.key || !b.rate) continue;
    const g = groups.get(b.key) ?? { key: b.key, rate: b.rate, base: 0, amount: 0 };
    g.base += b.dpp;
    groups.set(b.key, g);
  }
  return [...groups.values()].map((g) => ({ ...g, amount: percentOf(g.base, g.rate) }));
}

export function computeSalesTotals(input: {
  lines: SalesLineInput[];
  mode: PriceMode;
  taxable: boolean;
  /** The customer collects the PPN itself (Pemungut PPN). */
  vatCollector: boolean;
  /** Needed when `taxable`; the document's snapshot of the System Default. */
  rates: PpnRates | null;
}): SalesTotals {
  const lines: SalesLineResult[] = input.lines.map((l) => {
    const b = lineAmount(l);
    return { ...b, ...taxOf(b.amount, input.mode, input.taxable, input.rates) };
  });
  const sum = (f: (l: SalesLineResult) => number) => lines.reduce((a, l) => a + f(l), 0);
  const dpp = sum((l) => l.dpp);
  const ppn = sum((l) => l.ppn);
  const total = dpp + ppn;

  const withholdings = withholdingsOf(
    input.lines.map((l, i) => ({ key: l.withholdingKey, rate: l.withholdingRate, dpp: lines[i].dpp }))
  );
  const withholdingTotal = withholdings.reduce((a, w) => a + w.amount, 0);
  const collectedPpn = input.vatCollector ? ppn : 0;

  return {
    lines,
    gross: sum((l) => l.gross),
    discount: sum((l) => l.discount),
    dpp,
    dppOther: sum((l) => l.dppOther),
    ppn,
    total,
    withholdings,
    withholdingTotal,
    collectedPpn,
    expectedReceipt: total - withholdingTotal - collectedPpn,
  };
}

// ================================================================ advance

/**
 * The advance bill's arithmetic (P55): one value drawn from a Customer Order,
 * typed in the order's price mode — as a percent of the order's value or as a
 * flat value — and the DPP, DPP Nilai Lain and PPN that follow from it by the
 * same chain as a line. The AP advance will draw on the same function (P58).
 *
 * The advance is one global amount: it is not split over the order's lines.
 * The PPh estimate is the exception — the order's Jenis PPh sit on its lines,
 * Barang included (PPh 22), so the advance's DPP is shared over them by the
 * DPP each covers, the largest share absorbing the rounding, and each share is
 * withheld at its own rate. It is an estimate: what the customer withholds is
 * recorded by the payment.
 */

export type AdvanceAmountType = "Percent" | "Amount";

export type AdvanceBasis = {
  mode: PriceMode;
  taxable: boolean;
  vatCollector: boolean;
  /** The order's DPP. */
  dpp: number;
  /** The order's total, PPN included. */
  total: number;
  /** Per Jenis PPh on the order: its rate and the DPP of the lines it covers. */
  withholdings: { key: string; rate: number; base: number }[];
};

export type AdvanceFigures = {
  /** The value drawn, in the order's price mode. */
  amount: number;
  /** `amount` as a percent of the order's value, to two decimals. */
  percent: number;
  dpp: number;
  dppOther: number;
  ppn: number;
  total: number;
  withholdings: WithholdingEstimate[];
  withholdingTotal: number;
  collectedPpn: number;
  expectedReceipt: number;
};

/**
 * What an advance is drawn from: the order's value in its price mode — its
 * total when prices include PPN, its DPP when they exclude it (the same number
 * when the order is not Kena PPN).
 */
export function orderAdvanceValue(b: Pick<AdvanceBasis, "mode" | "taxable" | "dpp" | "total">): number {
  return b.taxable && b.mode === "Include" ? b.total : b.dpp;
}

/** The drawn value a typed percent or flat value comes to, whole rupiah. */
export function advanceAmountOf(type: AdvanceAmountType, typed: number, value: number): number {
  const v = Number(typed) || 0;
  return type === "Percent" ? Math.round((value * v) / 100) : Math.round(v);
}

/** Why a typed advance cannot stand, or null. `left` is the order's room. */
export function advanceAmountProblem(type: AdvanceAmountType, typed: number, value: number, left: number): string | null {
  const v = Number(typed);
  if (!Number.isFinite(v) || !(v > 0)) return "Isi nilai uang muka.";
  if (type === "Percent" && v > 100) return "Persentase tidak boleh lebih dari 100%.";
  const amount = advanceAmountOf(type, v, value);
  if (!(amount > 0)) return "Nilai uang muka terlalu kecil.";
  if (amount > left) return "Melebihi sisa nilai Customer Order yang dapat ditagih.";
  return null;
}

export function computeAdvance(input: {
  basis: AdvanceBasis;
  type: AdvanceAmountType;
  typed: number;
  /** Needed when the order is taxable; the bill's own snapshot (P60). */
  rates: PpnRates | null;
}): AdvanceFigures {
  const b = input.basis;
  const value = orderAdvanceValue(b);
  const amount = advanceAmountOf(input.type, input.typed, value);
  const { dpp, dppOther, ppn } = taxOf(amount, b.mode, b.taxable, input.rates);
  const total = dpp + ppn;

  const groups = b.withholdings.filter((w) => w.base > 0 && w.rate > 0);
  const withheldBase = groups.reduce((a, w) => a + w.base, 0);
  const shares = allocate(dpp, [...groups.map((w) => w.base), Math.max(0, b.dpp - withheldBase)]);
  const withholdings = groups.map((w, i) => ({
    key: w.key,
    rate: w.rate,
    base: shares[i],
    amount: percentOf(shares[i], w.rate),
  }));
  const withholdingTotal = withholdings.reduce((a, w) => a + w.amount, 0);
  const collectedPpn = b.vatCollector ? ppn : 0;

  return {
    amount,
    percent: value ? Math.round((amount / value) * 10000) / 100 : 0,
    dpp,
    dppOther,
    ppn,
    total,
    withholdings,
    withholdingTotal,
    collectedPpn,
    expectedReceipt: total - withholdingTotal - collectedPpn,
  };
}

// ============================================================= settlement

/**
 * One bill settled by one line of a Penerimaan (P66–P69).
 *
 * A bill is settled in parts — one payment or several — and each part carries
 * its share of the bill's PPN and of every PPh the customer withholds. The
 * shares are **positional** (`tax_concept.md` §7.5): a figure's share of the
 * part that takes the bill from `before` to `after` is
 *
 *   round(figure × after / total) − round(figure × before / total)
 *
 * so the parts always add up to the figure, the part that clears the bill
 * takes exactly what is left, and a part settled without withholding (the
 * Potong PPh switch off, P60) leaves no PPh behind for a later part to pick up.
 *
 * What the line clears is what the user types — **Dilunasi**. The PPh follows
 * from it, and the cash the bill brings in is Dilunasi less its PPh.
 */

export type SettlementBill = {
  /** What the bill asks for, PPN included. */
  total: number;
  ppn: number;
  /** Per Jenis PPh: its rate, the DPP it is withheld on and the PPh. */
  withholdings: { key: string; rate: number; base: number; amount: number }[];
};

export type SettlementLine = {
  /** What this line clears of the bill. */
  settled: number;
  dppPart: number;
  ppnPart: number;
  withholdings: { key: string; rate: number; base: number; amount: number }[];
  pph: number;
  /** What the bill brings into the bank: Dilunasi less its PPh. */
  cash: number;
};

/** A figure's share of the bill as settled up to `upTo`. */
const shareUpTo = (figure: number, upTo: number, total: number) =>
  total > 0 ? mulDivRound(figure, Math.min(upTo, total), total) : 0;

export function settleBill(input: {
  bill: SettlementBill;
  /** What posted payments settled before this one. */
  before: number;
  settled: number;
  withhold: boolean;
}): SettlementLine {
  const { bill } = input;
  const settled = Math.max(0, Math.round(input.settled));
  const before = Math.max(0, Math.round(input.before));
  const after = before + settled;
  const part = (figure: number) => shareUpTo(figure, after, bill.total) - shareUpTo(figure, before, bill.total);

  const ppnPart = part(bill.ppn);
  const withholdings = input.withhold
    ? bill.withholdings
        .map((w) => ({ key: w.key, rate: w.rate, base: part(w.base), amount: part(w.amount) }))
        .filter((w) => w.amount > 0)
    : [];
  const pph = withholdings.reduce((a, w) => a + w.amount, 0);
  return { settled, dppPart: settled - ppnPart, ppnPart, withholdings, pph, cash: settled - pph };
}

/**
 * What still has to arrive in the bank to clear a bill: what is left of it less
 * the PPh still to be withheld on it (none when the Potong PPh switch is off).
 */
export function cashToClear(bill: SettlementBill, before: number, withhold: boolean): number {
  const b = Math.max(0, Math.round(before));
  const open = Math.max(0, bill.total - b);
  return open - settleBill({ bill, before: b, settled: open, withhold }).pph;
}

/**
 * One bill settled from **what the customer actually paid** for it (P76).
 *
 * The user types the money received; the bill is cleared by that money plus
 * the PPh that goes with it. Money that reaches `cashToClear` clears the bill
 * — the gap is the PPh the customer withheld. Less money settles part of the
 * bill: the smallest part whose cash, after its own positional PPh share, is
 * exactly what was received, so the rest of the bill stays open. With the
 * switch off there is no PPh and the part is the money itself.
 */
export function settleBillFromCash(input: {
  bill: SettlementBill;
  before: number;
  /** What was received for this bill. */
  cash: number;
  withhold: boolean;
}): SettlementLine {
  const { bill, withhold } = input;
  const before = Math.max(0, Math.round(input.before));
  const cash = Math.max(0, Math.round(input.cash));
  const open = Math.max(0, bill.total - before);
  const at = (settled: number) => settleBill({ bill, before, settled, withhold });
  if (cash >= cashToClear(bill, before, withhold)) return at(open);
  if (!withhold || cash === 0) return at(cash);

  // cash(s) = s − pph(s) moves by at most one rupiah per rupiah of s, so the
  // exact part sits a few rupiah from the proportional estimate.
  const clear = at(open);
  const estimate = clear.cash > 0 ? mulDivRound(cash, open, clear.cash) : cash;
  let best: SettlementLine | null = null;
  for (let s = Math.max(0, estimate - 4); s <= Math.min(open, estimate + 4); s++) {
    const line = at(s);
    if (line.cash === cash) return line;
    if (line.cash < cash && (!best || line.cash > best.cash)) best = line;
  }
  return best ?? at(cash);
}

/** Why a line's Diterima cannot stand, or null. `max` is what clears the bill. */
export function receivedProblem(cash: number, max: number): string | null {
  if (!(cash > 0)) return "Isi nilai yang diterima.";
  if (cash !== Math.round(cash)) return "Nilai diterima harus dalam rupiah penuh.";
  if (cash > max) return "Melebihi sisa tagihan.";
  return null;
}

// ================================================================ invoice

/**
 * The Invoice Penjualan's arithmetic (`Sales-Process-Concept.md` §9).
 *
 * An Invoice line bills one Delivery Note line: a quantity of one Customer Order
 * line at that line's unrounded unit price and its discount. **Gross and
 * discount are split cumulatively** (P112, `tax_concept.md` §7.5): a line takes
 * the order line's figure for everything billed up to and including it, rounded
 * once, less what was billed before it. So the Invoices on an order line never
 * drift by more than Rp1 at any point, add up to the order line exactly when
 * it is complete, and an order closed short is billed exactly what it sent.
 *
 * **Settlement PPN is `full-less-advance`** (P113, `tax_concept.md` §3.5
 * choice point `settlement-ppn`; replaces U7's net-DPP rule for this ERP).
 * Each line's PPN is the chain on its **full** DPP. The Uang Muka used — a DPP
 * the user types per item (U8) — and the PPN of the part of each item used
 * (`advancePpnUsed`) are deducted once, from the document. The advance's DPP is
 * still shared over the lines by DPP (§7.4), but only for the PPh, which is on
 * the DPP after the advances per Jenis PPh (§4.4). Piutang = net DPP + (full
 * PPN − the advances' PPN). It assumes the PPN rate and the DPP Nilai Lain
 * factor did not change since the advance; the Invoice refuses one that did.
 */

export type InvoiceLineInput = {
  /** What this Invoice bills, in the order line's unit. */
  qty: number;
  /** The Customer Order line: its quantity, gross and discount as stored. */
  orderQty: number;
  orderGross: number;
  orderDiscount: number;
  /** Unrounded unit price (P111). */
  price: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  /** What was billed of the same order line before this one: posted Invoices, then earlier lines of this one. */
  billedQtyBefore: number;
  withholdingRate: number | null;
  withholdingKey: string | null;
};

/**
 * The PPN of the part of an Uang Muka a document uses (P113): that part's share
 * of the PPN its faktur pajak uang muka carries, taken **cumulatively**
 * (`tax_concept.md` §7.5) — the PPN up to everything used so far, rounded once,
 * less the PPN up to what was used before. So the parts of one advance add up
 * to exactly its PPN, the use that empties it taking whatever is left.
 */
export function advancePpnUsed(a: { taxDpp: number | null; taxPpn: number | null; usedBefore: number; used: number }): number {
  const dpp = Math.round(Number(a.taxDpp) || 0);
  const ppn = Math.round(Number(a.taxPpn) || 0);
  if (dpp <= 0 || ppn <= 0) return 0;
  const before = Math.max(0, Math.round(a.usedBefore));
  const after = Math.min(dpp, before + Math.max(0, Math.round(a.used)));
  const upTo = (u: number) => (u >= dpp ? ppn : Math.round((ppn * u) / dpp));
  return upTo(after) - upTo(before);
}

export type InvoiceLineResult = {
  /** Its cumulative share of the order line's gross and discount (P112). */
  gross: number;
  discount: number;
  /** gross − discount, in the price mode. */
  amount: number;
  /** DPP of the goods billed. */
  dpp: number;
  /** The share of the Uang Muka used that this line carries. */
  advanceDpp: number;
  /** DPP after its share of the advance — the PPh base (§4.4). */
  netDpp: number;
  /** DPP Nilai Lain and PPN on the line's full DPP (P113). */
  dppOther: number;
  ppn: number;
};

export type InvoiceFigures = {
  lines: InvoiceLineResult[];
  gross: number;
  discount: number;
  amount: number;
  dpp: number;
  advanceUsed: number;
  netDpp: number;
  /** Σ lines, on the full DPP. */
  dppOther: number;
  /** Σ lines: the PPN on the full DPP. */
  fullPpn: number;
  /** The PPN of the Uang Muka used, deducted once (P113). */
  advancePpn: number;
  /** fullPpn − advancePpn: what PPN Keluaran is credited with. */
  ppn: number;
  /** Net Piutang: net DPP + PPN. */
  total: number;
  withholdings: WithholdingEstimate[];
  withholdingTotal: number;
  expectedReceipt: number;
};

const Q = 10_000;

/**
 * The order line's gross and discount for its first `q` units (in
 * ten-thousandths), each rounded once: the whole line's stored figures once
 * `q` reaches it, so the last part lands on them exactly.
 */
function orderLineUpTo(l: InvoiceLineInput, q: number): { gross: number; discount: number } {
  const ordered = Math.round((Number(l.orderQty) || 0) * Q);
  if (q <= 0) return { gross: 0, discount: 0 };
  if (ordered > 0 && q >= ordered) return { gross: Math.round(l.orderGross), discount: Math.round(l.orderDiscount) };
  const raw = (q / Q) * (Number(l.price) || 0);
  const gross = Math.round(raw);
  const v = Number(l.discountValue) || 0;
  const off = l.discountType === "Percent" ? (raw * v) / 100 : l.discountType === "Amount" && ordered > 0 ? (v * q) / ordered : 0;
  return { gross, discount: gross - Math.round(raw - off) };
}

/**
 * What one Invoice line bills (P112, `tax_concept.md` §7.5): the order line's
 * figures up to and including it, less those up to what was billed before.
 */
export function invoiceLineFigures(l: InvoiceLineInput): { gross: number; discount: number; amount: number } {
  const qty = Math.round((Number(l.qty) || 0) * Q);
  if (qty <= 0) return { gross: 0, discount: 0, amount: 0 };
  const before = Math.round((Number(l.billedQtyBefore) || 0) * Q);
  const upTo = orderLineUpTo(l, before + qty);
  const was = orderLineUpTo(l, before);
  const gross = upTo.gross - was.gross;
  const discount = upTo.discount - was.discount;
  return { gross, discount, amount: gross - discount };
}

export function computeInvoice(input: {
  lines: InvoiceLineInput[];
  mode: PriceMode;
  taxable: boolean;
  rates: PpnRates | null;
  /** Σ DPP used of the Uang Muka picked. */
  advanceUsed: number;
  /** Σ PPN of the Uang Muka used (`advancePpnUsed` per item). */
  advancePpn?: number;
}): InvoiceFigures {
  const parts = input.lines.map(invoiceLineFigures);
  const amounts = parts.map((p) => p.amount);
  const full = amounts.map((a) => taxOf(a, input.mode, input.taxable, input.rates).dpp);
  const dpp = full.reduce((a, b) => a + b, 0);
  const advanceUsed = Math.max(0, Math.min(Math.round(input.advanceUsed) || 0, dpp));
  const shares = advanceUsed > 0 ? allocate(advanceUsed, full) : full.map(() => 0);
  const lines: InvoiceLineResult[] = amounts.map((amount, i) => {
    const netDpp = full[i] - shares[i];
    const tax = input.taxable && input.rates ? ppnChain(full[i], input.rates) : { dppOther: 0, ppn: 0 };
    return { gross: parts[i].gross, discount: parts[i].discount, amount, dpp: full[i], advanceDpp: shares[i], netDpp, ...tax };
  });
  const sum = (f: (l: InvoiceLineResult) => number) => lines.reduce((a, l) => a + f(l), 0);
  const netDpp = sum((l) => l.netDpp);
  const fullPpn = sum((l) => l.ppn);
  const advancePpn = advanceUsed > 0 ? Math.min(fullPpn, Math.max(0, Math.round(input.advancePpn ?? 0))) : 0;
  const ppn = fullPpn - advancePpn;
  const withholdings = withholdingsOf(
    input.lines.map((l, i) => ({ key: l.withholdingKey, rate: l.withholdingRate, dpp: lines[i].netDpp }))
  );
  const withholdingTotal = withholdings.reduce((a, w) => a + w.amount, 0);
  return {
    lines,
    gross: sum((l) => l.gross),
    discount: sum((l) => l.discount),
    amount: sum((l) => l.amount),
    dpp,
    advanceUsed,
    netDpp,
    dppOther: sum((l) => l.dppOther),
    fullPpn,
    advancePpn,
    ppn,
    total: netDpp + ppn,
    withholdings,
    withholdingTotal,
    expectedReceipt: netDpp + ppn - withholdingTotal,
  };
}
