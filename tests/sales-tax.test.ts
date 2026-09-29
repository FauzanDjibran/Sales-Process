import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  advanceAmountProblem,
  allocate,
  computeAdvance,
  computeSalesTotals,
  inclusiveSplit,
  lineAmount,
  lineProblem,
  percentOf,
  ppnChain,
  type PpnRates,
  type SalesLineInput,
} from "../src/lib/erp/sales-tax";

/**
 * The sales tax arithmetic (P59, P60; `tax_concept.md` §3, §7), against figures
 * worked out independently of this module (Python, Decimal ROUND_HALF_UP):
 * whole rupiah, half up, the chain per line, the document summing its lines.
 */

const R: PpnRates = { rate: 12, otherNum: 11, otherDen: 12 };

const line = (qty: number, price: number, over: Partial<SalesLineInput> = {}): SalesLineInput => ({
  qty,
  price,
  discountType: null,
  discountValue: null,
  withholdingRate: null,
  withholdingKey: null,
  ...over,
});

describe("rounding (PER-11/PJ/2025)", () => {
  test("half a rupiah rounds up", () => {
    assert.equal(percentOf(100, 1.5), 2, "1,5 → 2");
    assert.equal(percentOf(99, 1.5), 1, "1,485 → 1");
    assert.equal(ppnChain(6, R).dppOther, 6, "DPP Nilai Lain 5,5 → 6");
  });

  test("the chain: DPP → round(× 11/12) → round(× 12 %)", () => {
    assert.deepEqual(ppnChain(1_716_400, R), { dppOther: 1_573_367, ppn: 188_804 });
  });

  test("the rate and the factor are the document's, not constants", () => {
    assert.deepEqual(ppnChain(1_000_000, { rate: 11, otherNum: 1, otherDen: 1 }), { dppOther: 1_000_000, ppn: 110_000 });
  });

  test("an inclusive price: the largest DPP whose DPP + PPN fits", () => {
    assert.deepEqual(inclusiveSplit(1_110_000, R), { dpp: 1_000_000, dppOther: 916_667, ppn: 110_000 });
    for (let price = 1; price <= 50_000; price++) {
      const { dpp, ppn } = inclusiveSplit(price, R);
      const total = dpp + ppn;
      assert.ok(total <= price && total >= price - 1, `price ${price} splits to ${total}`);
    }
    assert.deepEqual(
      inclusiveSplit(1_004, R),
      { dpp: 904, dppOther: 829, ppn: 99 },
      "no exact split exists: the total is one rupiah under, never over"
    );
  });
});

describe("allocation to shares", () => {
  test("by weight, the largest absorbing what flooring leaves", () => {
    assert.deepEqual(allocate(188_804, [850_000, 866_400]), [93_500, 95_304]);
    assert.deepEqual(allocate(0, [1, 2]), [0, 0]);
    assert.deepEqual(allocate(5, [0, 0]), [0, 0]);
  });
});

describe("a line", () => {
  test("percent and nominal discounts", () => {
    assert.deepEqual(lineAmount({ qty: 24, price: 38_000, discountType: "Percent", discountValue: 5 }), {
      gross: 912_000,
      discount: 45_600,
      amount: 866_400,
    });
    assert.deepEqual(lineAmount({ qty: 3, price: 47_500, discountType: "Amount", discountValue: 10_000 }), {
      gross: 142_500,
      discount: 10_000,
      amount: 132_500,
    });
  });

  test("what cannot be priced is refused", () => {
    assert.ok(lineProblem({ qty: 0, price: 1, discountType: null, discountValue: null }));
    assert.ok(lineProblem({ qty: 1, price: 0, discountType: null, discountValue: null }));
    assert.ok(lineProblem({ qty: 1, price: 100, discountType: "Percent", discountValue: 100 }));
    assert.ok(lineProblem({ qty: 1, price: 100, discountType: "Amount", discountValue: 100 }));
    assert.ok(lineProblem({ qty: 1, price: 100, discountType: "Amount", discountValue: -1 }));
    assert.equal(lineProblem({ qty: 1.5, price: 100, discountType: "Percent", discountValue: 12.5 }), null);
  });
});

describe("a document's totals are the sum of its lines", () => {
  test("PPN per line, not once on the total (P60)", () => {
    const t = computeSalesTotals({
      lines: [line(1, 1_000_003), line(1, 1_000_003)],
      mode: "Exclude",
      taxable: true,
      vatCollector: false,
      rates: R,
    });
    assert.equal(t.ppn, 220_000, "110.000 + 110.000; once on 2.000.006 would give 220.001");
  });

  test("Exclude PPN, taxable", () => {
    const t = computeSalesTotals({
      lines: [line(10, 85_000), line(24, 38_000, { discountType: "Percent", discountValue: 5 })],
      mode: "Exclude",
      taxable: true,
      vatCollector: false,
      rates: R,
    });
    assert.equal(t.gross, 1_762_000);
    assert.equal(t.discount, 45_600);
    assert.equal(t.dpp, 1_716_400);
    assert.deepEqual(t.lines.map((l) => [l.dppOther, l.ppn]), [[779_167, 93_500], [794_200, 95_304]]);
    assert.equal(t.dppOther, 1_573_367);
    assert.equal(t.ppn, 188_804);
    assert.equal(t.total, 1_905_204);
  });

  test("Include PPN: each line's DPP absorbs its difference", () => {
    const t = computeSalesTotals({
      lines: [line(2, 1_134_000), line(3, 47_500, { discountType: "Amount", discountValue: 10_000 })],
      mode: "Include",
      taxable: true,
      vatCollector: false,
      rates: R,
    });
    assert.deepEqual(t.lines.map((l) => [l.dpp, l.dppOther, l.ppn]), [
      [2_043_243, 1_872_973, 224_757],
      [119_369, 109_422, 13_131],
    ]);
    assert.equal(t.dpp, 2_162_612);
    assert.equal(t.dppOther, 1_982_395);
    assert.equal(t.ppn, 237_888);
    assert.equal(t.total, 2_400_500, "the typed prices, since both lines split exactly");
  });

  test("an order that is not Kena PPN has no PPN in either mode, and needs no rates", () => {
    for (const mode of ["Exclude", "Include"] as const) {
      const t = computeSalesTotals({ lines: [line(1, 111_000)], mode, taxable: false, vatCollector: false, rates: null });
      assert.deepEqual([t.dpp, t.dppOther, t.ppn, t.total], [111_000, 0, 0, 111_000]);
    }
  });

  test("the PPh estimate is per Jenis PPh, on the lines' DPP, half up", () => {
    const t = computeSalesTotals({
      lines: [
        line(2, 1_134_000, { withholdingKey: "22", withholdingRate: 1.5 }),
        line(3, 47_500, { discountType: "Amount", discountValue: 10_000 }),
      ],
      mode: "Include",
      taxable: true,
      vatCollector: false,
      rates: R,
    });
    assert.deepEqual(t.withholdings, [{ key: "22", rate: 1.5, base: 2_043_243, amount: 30_649 }]);
    assert.equal(t.expectedReceipt, 2_400_500 - 30_649);
  });

  test("a WAPU buyer keeps the PPN as well", () => {
    const t = computeSalesTotals({
      lines: [line(10, 85_000, { withholdingKey: "22", withholdingRate: 1.5 })],
      mode: "Exclude",
      taxable: true,
      vatCollector: true,
      rates: R,
    });
    assert.equal(t.ppn, 93_500);
    assert.equal(t.collectedPpn, 93_500);
    assert.equal(t.withholdingTotal, 12_750);
    assert.equal(t.expectedReceipt, 850_000 + 93_500 - 93_500 - 12_750);
  });
});

describe("an advance bill (P55, P60)", () => {
  test("Exclude: a percent of the order's DPP, PPN by the chain, PPh shared by the lines it covers", () => {
    const a = computeAdvance({
      basis: {
        mode: "Exclude",
        taxable: true,
        vatCollector: false,
        dpp: 1_716_400,
        total: 1_905_204,
        withholdings: [{ key: "22", rate: 1.5, base: 850_000 }],
      },
      type: "Percent",
      typed: 30,
      rates: R,
    });
    assert.equal(a.amount, 514_920);
    assert.equal(a.dpp, 514_920, "Exclude: the value typed is the DPP");
    assert.equal(a.dppOther, 472_010);
    assert.equal(a.ppn, 56_641);
    assert.equal(a.total, 571_561);
    assert.equal(a.percent, 30);
    assert.deepEqual(a.withholdings, [{ key: "22", rate: 1.5, base: 255_000, amount: 3_825 }]);
    assert.equal(a.expectedReceipt, 571_561 - 3_825);
  });

  test("Include: a flat value with the PPN in it, and a WAPU buyer", () => {
    const a = computeAdvance({
      basis: { mode: "Include", taxable: true, vatCollector: true, dpp: 2_162_612, total: 2_400_500, withholdings: [] },
      type: "Amount",
      typed: 1_000_000,
      rates: R,
    });
    assert.deepEqual([a.dpp, a.dppOther, a.ppn], [900_901, 825_826, 99_099]);
    assert.equal(a.total, 1_000_000, "the value typed is what the bill asks for");
    assert.equal(a.percent, 41.66, "of the order's total, since its prices include PPN");
    assert.equal(a.collectedPpn, 99_099);
    assert.equal(a.expectedReceipt, 900_901);
  });

  test("an order that is not Kena PPN gives an advance without PPN", () => {
    const a = computeAdvance({
      basis: { mode: "Include", taxable: false, vatCollector: false, dpp: 111_000, total: 111_000, withholdings: [] },
      type: "Percent",
      typed: 100,
      rates: null,
    });
    assert.deepEqual([a.amount, a.ppn, a.dpp, a.dppOther, a.total], [111_000, 0, 111_000, 0, 111_000]);
  });

  test("what cannot be billed is refused", () => {
    assert.ok(advanceAmountProblem("Percent", 0, 1_000, 1_000));
    assert.ok(advanceAmountProblem("Percent", 100.01, 1_000, 1_000));
    assert.ok(advanceAmountProblem("Amount", 1_001, 1_000, 1_000), "more than the order");
    assert.ok(advanceAmountProblem("Percent", 60, 1_000, 500), "more than is left of it");
    assert.equal(advanceAmountProblem("Percent", 50, 1_000, 500), null);
    assert.equal(advanceAmountProblem("Amount", 1_000, 1_000, 1_000), null);
  });
});
