/**
 * The sales tax arithmetic — the one place PPN, DPP Nilai Lain and the PPh
 * estimate are computed (Claude-ERP.md §7, §14, P52).
 *
 * Client-safe and pure: the Sales Order form previews exactly what the Server
 * Action stores, because both call this. Whole rupiah throughout, rounded the
 * way the simulation rounds (`calcSo`, `ppnOf`, `allocate`):
 *
 *   line amount   = round(qty × price − discount)
 *   Exclude PPN   PPN = ⌊Σ amount × 11/100⌋, DPP = Σ amount
 *   Include PPN   PPN = ⌊Σ amount × 11/111⌋, DPP = Σ amount − PPN
 *   DPP Nilai Lain = DPP × 11/12        (PPN 12 % × 11/12 = 11 % effective)
 *   PPN is allocated to the lines by weight; the largest line absorbs the
 *   rounding.
 *
 * A Sales Order is Kena PPN or not as a whole (P52). A non-taxable order has no
 * PPN whatever its price mode: its prices are the amounts.
 */

export type PriceMode = "Exclude" | "Include";
export type DiscountType = "Percent" | "Amount";

export type SalesLineInput = {
  qty: number;
  /** Per unit, in the order's price mode. */
  price: number;
  discountType: DiscountType | null;
  /** A percent for `Percent`, rupiah for `Amount`. */
  discountValue: number | null;
  /** Percent, e.g. 1.5 — null when the line is not withheld. */
  withholdingRate: number | null;
  /** Groups the PPh estimate; null when not withheld. */
  withholdingKey: string | null;
};

export type SalesLineResult = {
  gross: number;
  discount: number;
  amount: number;
  dpp: number;
  ppn: number;
};

export type WithholdingEstimate = { key: string; rate: number; base: number; amount: number };

export type SalesTotals = {
  lines: SalesLineResult[];
  gross: number;
  discount: number;
  dpp: number;
  /** DPP Nilai Lain, to two decimals. */
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

/** PPN on a sum, per the price mode. The epsilon mirrors the simulation's. */
export function ppnOf(amount: number, mode: PriceMode): number {
  return mode === "Exclude"
    ? Math.floor((amount * 11) / 100 + 1e-7)
    : Math.floor((amount * 11) / 111 + 1e-7);
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

export function computeSalesTotals(input: {
  lines: SalesLineInput[];
  mode: PriceMode;
  taxable: boolean;
  /** The customer collects the PPN itself (Pemungut PPN). */
  vatCollector: boolean;
}): SalesTotals {
  const base = input.lines.map(lineAmount);
  const amounts = base.map((b) => b.amount);
  const sumAmount = amounts.reduce((a, b) => a + b, 0);

  const ppn = input.taxable ? ppnOf(sumAmount, input.mode) : 0;
  const ppnLines = input.taxable ? allocate(ppn, amounts) : amounts.map(() => 0);
  const inclusive = input.taxable && input.mode === "Include";

  const lines: SalesLineResult[] = base.map((b, i) => ({
    gross: b.gross,
    discount: b.discount,
    amount: b.amount,
    dpp: inclusive ? b.amount - ppnLines[i] : b.amount,
    ppn: ppnLines[i],
  }));

  const dpp = inclusive ? sumAmount - ppn : sumAmount;
  const total = dpp + ppn;

  const groups = new Map<string, WithholdingEstimate>();
  input.lines.forEach((l, i) => {
    if (!l.withholdingKey || !l.withholdingRate) return;
    const g = groups.get(l.withholdingKey) ?? { key: l.withholdingKey, rate: l.withholdingRate, base: 0, amount: 0 };
    g.base += lines[i].dpp;
    groups.set(l.withholdingKey, g);
  });
  const withholdings = [...groups.values()].map((g) => ({
    ...g,
    amount: Math.floor((g.base * g.rate) / 100 + 1e-7),
  }));
  const withholdingTotal = withholdings.reduce((a, w) => a + w.amount, 0);
  const collectedPpn = input.vatCollector ? ppn : 0;

  return {
    lines,
    gross: base.reduce((a, b) => a + b.gross, 0),
    discount: base.reduce((a, b) => a + b.discount, 0),
    dpp,
    dppOther: Math.round(((dpp * 11) / 12) * 100) / 100,
    ppn,
    total,
    withholdings,
    withholdingTotal,
    collectedPpn,
    expectedReceipt: total - withholdingTotal - collectedPpn,
  };
}
