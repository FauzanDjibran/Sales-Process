import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  allocate,
  computeSalesTotals,
  lineAmount,
  lineProblem,
  ppnOf,
  type SalesLineInput,
} from "../src/lib/erp/sales-tax";

/**
 * The sales tax arithmetic (P52), against figures worked out independently of
 * this module. Whole rupiah, floored the way the simulation floors.
 */

const line = (qty: number, price: number, over: Partial<SalesLineInput> = {}): SalesLineInput => ({
  qty,
  price,
  discountType: null,
  discountValue: null,
  withholdingRate: null,
  withholdingKey: null,
  ...over,
});

describe("PPN on a sum", () => {
  test("Exclude: 11 % of the amount, floored", () => {
    assert.equal(ppnOf(1_716_400, "Exclude"), 188_804);
  });
  test("Include: 11/111 of the amount, floored", () => {
    assert.equal(ppnOf(111_000, "Include"), 11_000);
    assert.equal(ppnOf(2_400_500, "Include"), 237_887);
  });
});

describe("allocation to lines", () => {
  test("by weight, the largest line absorbing what flooring leaves", () => {
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

describe("an order's totals", () => {
  test("Exclude PPN, taxable", () => {
    const t = computeSalesTotals({
      lines: [line(10, 85_000), line(24, 38_000, { discountType: "Percent", discountValue: 5 })],
      mode: "Exclude",
      taxable: true,
      vatCollector: false,
    });
    assert.equal(t.gross, 1_762_000);
    assert.equal(t.discount, 45_600);
    assert.equal(t.dpp, 1_716_400);
    assert.equal(t.dppOther, 1_573_366.67);
    assert.equal(t.ppn, 188_804);
    assert.equal(t.total, 1_905_204);
    assert.deepEqual(t.lines.map((l) => l.ppn), [93_500, 95_304]);
    assert.deepEqual(t.lines.map((l) => l.dpp), [850_000, 866_400], "Exclude: DPP is the amount");
  });

  test("Include PPN: DPP is what is left once PPN is taken out", () => {
    const t = computeSalesTotals({
      lines: [line(2, 1_134_000), line(3, 47_500, { discountType: "Amount", discountValue: 10_000 })],
      mode: "Include",
      taxable: true,
      vatCollector: false,
    });
    assert.equal(t.ppn, 237_887);
    assert.equal(t.dpp, 2_162_613);
    assert.equal(t.total, 2_400_500, "the typed prices already hold the PPN");
    assert.deepEqual(t.lines.map((l) => l.dpp), [2_043_243, 119_370]);
    assert.equal(t.dppOther, 1_982_395.25);
  });

  test("an order that is not Kena PPN has no PPN in either mode", () => {
    for (const mode of ["Exclude", "Include"] as const) {
      const t = computeSalesTotals({ lines: [line(1, 111_000)], mode, taxable: false, vatCollector: false });
      assert.equal(t.ppn, 0);
      assert.equal(t.dpp, 111_000);
      assert.equal(t.total, 111_000);
    }
  });

  test("the PPh estimate is per Jenis PPh, on the lines' DPP", () => {
    const t = computeSalesTotals({
      lines: [
        line(2, 1_134_000, { withholdingKey: "22", withholdingRate: 1.5 }),
        line(3, 47_500, { discountType: "Amount", discountValue: 10_000 }),
      ],
      mode: "Include",
      taxable: true,
      vatCollector: false,
    });
    assert.deepEqual(t.withholdings, [{ key: "22", rate: 1.5, base: 2_043_243, amount: 30_648 }]);
    assert.equal(t.expectedReceipt, 2_400_500 - 30_648);
  });

  test("a WAPU buyer keeps the PPN as well", () => {
    const t = computeSalesTotals({
      lines: [line(10, 85_000, { withholdingKey: "22", withholdingRate: 1.5 })],
      mode: "Exclude",
      taxable: true,
      vatCollector: true,
    });
    assert.equal(t.ppn, 93_500);
    assert.equal(t.collectedPpn, 93_500);
    assert.equal(t.withholdingTotal, 12_750);
    assert.equal(t.expectedReceipt, 850_000 + 93_500 - 93_500 - 12_750);
  });
});
