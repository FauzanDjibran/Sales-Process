import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_CURRENCY_LABEL,
  isBaseCurrency,
  maySettle,
  needsEnteredRate,
  rateSource,
  settlementRefusal,
} from "../src/lib/erp/currency";
import {
  carryingRate,
  fxDifference,
  FxRangeError,
  originate,
  OverRelief,
  relieve,
  roundBase,
  settle,
  type Balance,
} from "../src/lib/erp/fx";

/**
 * The foreign-exchange kernel.
 *
 * This suite is the reason the kernel is built before anything depends on it.
 * Both source specifications carry fully worked illustrations with stated
 * results, so the arithmetic can be proved outright rather than inspected on a
 * screen — and the properties that matter here are exactly the ones nobody
 * notices being wrong: a cent of drift that compounds, a loss that rounds
 * differently from the matching gain, a balance closing at zero foreign against
 * a base nobody can explain.
 *
 * It needs no database and touches no application state.
 */

// --------------------------------------------------------------- rounding

describe("a base amount rounds half away from zero", () => {
  test("ordinary halves round up", () => {
    assert.equal(roundBase(0.005), 0.01);
    assert.equal(roundBase(1.005), 1.01);
    assert.equal(roundBase(3333.335), 3333.34);
  });

  test("a loss rounds as far from zero as the matching gain", () => {
    // The whole reason this is not `Math.round`, which rounds half toward
    // positive infinity and would make these two disagree by a cent.
    assert.equal(roundBase(-0.005), -0.01);
    assert.equal(roundBase(0.005), 0.01);
    assert.equal(roundBase(-1.005), -1.01);
    for (const v of [0.005, 1.235, 99.995, 12345.675]) {
      assert.equal(
        roundBase(-v),
        -roundBase(v),
        `rounding is not symmetric about zero at ${v}`
      );
    }
  });

  test("values already at the minor unit are untouched", () => {
    for (const v of [0, 1, -1, 16_000_000, -13_217_600, 0.01, -0.01]) {
      assert.equal(roundBase(v), v);
    }
  });

  test("a figure too large to round exactly is refused, not approximated", () => {
    assert.throws(() => roundBase(Number.MAX_SAFE_INTEGER), FxRangeError);
    assert.throws(() => roundBase(Infinity), FxRangeError);
    assert.throws(() => roundBase(NaN), FxRangeError);
  });
});

// ---------------------------------------------------------- carrying rate

describe("a carrying rate is derived, and undefined at nothing", () => {
  test("it is base over foreign", () => {
    assert.equal(carryingRate({ foreign: 880, base: 13_217_600 }), 15_020);
  });

  test("a balance holding nothing has no rate at all", () => {
    // Null, never zero and never the last rate it happened to hold: a figure
    // here would invite being used as a rate.
    assert.equal(carryingRate({ foreign: 0, base: 0 }), null);
  });

  test("it is generally a rate nobody transacted at", () => {
    // 200 at 16.000 and 200 at 15.500 — the pool carries at 15.750, which
    // appeared in neither deal. This is why it is reporting-only.
    const pool: Balance = { foreign: 400, base: 3_200_000 + 3_100_000 };
    assert.equal(carryingRate(pool), 15_750);
  });
});

// --------------------------------------------------------------- relieving

describe("releasing base from a balance", () => {
  test("a partial release is proportional", () => {
    const position: Balance = { foreign: 880, base: 13_217_600 };
    const relief = relieve(position, 200);
    assert.equal(relief.base, 3_004_000);
    assert.deepEqual(relief.remaining, { foreign: 680, base: 10_213_600 });
    assert.equal(relief.exhausted, false);
  });

  test("a partial release leaves the carrying rate untouched", () => {
    // The load-bearing property: relief at a balance's own rate preserves the
    // ratio by construction, so a balance's rate is stable against settlement
    // and moves only when value is genuinely added.
    const position: Balance = { foreign: 880, base: 13_217_600 };
    const before = carryingRate(position);
    const after = carryingRate(relieve(position, 250).remaining);
    assert.equal(after, before);
  });

  test("a full release hands back the remaining base exactly", () => {
    const position: Balance = { foreign: 430, base: 6_458_600 };
    const relief = relieve(position, 430);
    assert.equal(relief.base, 6_458_600);
    assert.deepEqual(relief.remaining, { foreign: 0, base: 0 });
    assert.equal(relief.exhausted, true);
  });

  test("zero foreign always means zero base, however it was reached", () => {
    // A position carrying a rate that does not divide evenly. Each partial
    // release rounds, so a residue accumulates; the final release absorbs it
    // exactly rather than recomputing a product and stranding it.
    let position: Balance = { foreign: 3, base: 10_000 };
    let released = 0;
    for (let i = 0; i < 3; i += 1) {
      const relief = relieve(position, 1);
      released += relief.base;
      position = relief.remaining;
    }
    assert.deepEqual(position, { foreign: 0, base: 0 });
    assert.equal(released, 10_000, "every rupiah of the position was released");
  });

  test("a balance cannot give up more than it holds", () => {
    assert.throws(
      () => relieve({ foreign: 100, base: 1_500_000 }, 101),
      OverRelief
    );
  });

  test("releasing nothing releases nothing", () => {
    const relief = relieve({ foreign: 100, base: 1_500_000 }, 0);
    assert.equal(relief.base, 0);
    assert.equal(relief.exhausted, false);
  });
});

// ----------------------------------------------------------- moving average

describe("a foreign resource is one pool at its moving average", () => {
  test("money arriving moves the average toward its own rate, by weight", () => {
    // USD 200 at 15.000, then USD 300 at 15.500: the pool carries at 15.300,
    // a rate nobody quoted.
    const first = originate(200, 15_000);
    const second = originate(300, 15_500);
    const pool: Balance = {
      foreign: first.foreign + second.foreign,
      base: first.base + second.base,
    };
    assert.deepEqual(pool, { foreign: 500, base: 7_650_000 });
    assert.equal(carryingRate(pool), 15_300);
  });

  test("money leaving never moves the average", () => {
    let pool: Balance = { foreign: 500, base: 7_650_000 };
    for (const take of [100, 50, 130]) {
      const relief = relieve(pool, take);
      assert.equal(relief.base, take * 15_300, "released at the average");
      pool = relief.remaining;
      assert.equal(carryingRate(pool), 15_300);
    }
  });

  test("emptying the pool releases its remaining base exactly", () => {
    // Three receipts whose average is not a whole number of cents: partial
    // releases round, and the last release absorbs what they left behind.
    let pool: Balance = { foreign: 700, base: 10_650_000 };
    let released = 0;
    for (const take of [100, 250]) {
      const relief = relieve(pool, take);
      released += relief.base;
      pool = relief.remaining;
    }
    const last = relieve(pool, pool.foreign);
    assert.equal(last.exhausted, true);
    assert.deepEqual(last.remaining, { foreign: 0, base: 0 });
    assert.equal(roundBase(released + last.base), 10_650_000, "base is conserved");
  });

  test("the pool cannot be overdrawn", () => {
    assert.throws(() => relieve({ foreign: 200, base: 3_000_000 }, 201), OverRelief);
  });

  test("currency joins the pool at a rate above zero only", () => {
    assert.throws(() => originate(100, 0), FxRangeError);
    assert.throws(() => originate(100, -15_000), FxRangeError);
  });
});

// ----------------------------------------------------------- the difference

describe("the FX difference is the balancing figure", () => {
  test("the obligation giving up more than the cash cost is a gain", () => {
    assert.deepEqual(fxDifference(6_458_600, 6_321_000), {
      amount: 137_600,
      side: "gain",
    });
  });

  test("the cash costing more than the obligation gave up is a loss", () => {
    assert.deepEqual(fxDifference(3_004_000, 3_160_000), {
      amount: -156_000,
      side: "loss",
    });
  });

  test("agreement writes no line", () => {
    // A balance built entirely at one rate, settled from currency obtained at
    // that same rate. The general path handles it; no special case is needed.
    assert.deepEqual(fxDifference(3_000_000, 3_000_000), {
      amount: 0,
      side: null,
    });
  });

  test("a gain and its mirrored loss are the same size", () => {
    const gain = fxDifference(1_000_000.005, 0);
    const loss = fxDifference(0, 1_000_000.005);
    assert.equal(gain.amount, -loss.amount);
  });
});

// ------------------------------------------------------ create versus relieve

describe("creating and relieving are told apart by the books, not the document", () => {
  test("nothing on the books means the movement is the origin of the value", () => {
    // An expense, a Piutang raised by paying out, a first-ever Hutang. No base
    // value existed, so there is no second opinion to disagree with.
    const result = settle({
      position: null,
      foreign: 1_000,
      transactionBase: 16_000_000,
    });
    assert.equal(result.settlementBase, 16_000_000);
    assert.equal(result.difference.side, null);
    assert.equal(result.originated, 1_000);
    assert.equal(result.relieved, 0);
  });

  test("a position at nothing is treated the same way", () => {
    const result = settle({
      position: { foreign: 0, base: 0 },
      foreign: 500,
      transactionBase: 7_500_000,
    });
    assert.equal(result.settlementBase, 7_500_000);
    assert.equal(result.difference.side, null);
  });

  test("an existing position releases at its own rate and the gap is recognised", () => {
    const result = settle({
      position: { foreign: 1_000, base: 15_000_000 },
      foreign: 1_000,
      transactionBase: 16_000_000,
    });
    assert.equal(result.settlementBase, 15_000_000);
    assert.deepEqual(result.difference, { amount: -1_000_000, side: "loss" });
    assert.deepEqual(result.remaining, { foreign: 0, base: 0 });
  });

  test("settling past the position relieves what exists and creates the rest", () => {
    // Overpaying a Hutang of USD 500 by USD 300. The first 500 has base value
    // behind it and is relieved; the excess has none and is created.
    const result = settle({
      position: { foreign: 500, base: 7_500_000 },
      foreign: 800,
      transactionBase: 12_800_000, // 800 at 16.000
    });
    assert.equal(result.relieved, 500);
    assert.equal(result.originated, 300);
    // 500 released at 15.000 plus 300 created at 16.000.
    assert.equal(result.settlementBase, 7_500_000 + 4_800_000);
    // Only the relieved half can disagree: 7.500.000 against 500 at 16.000.
    assert.deepEqual(result.difference, { amount: -500_000, side: "loss" });
    assert.deepEqual(result.remaining, { foreign: 0, base: 0 });
  });

  test("a split apportions exactly what left the bank", () => {
    // The relieved share is the exact complement of the created share, so the
    // two always add back to the figure that actually moved.
    const transactionBase = 1_000_000;
    const result = settle({
      position: { foreign: 1, base: 3_333 },
      foreign: 3,
      transactionBase,
    });
    const createdShare = roundBase((transactionBase * result.originated) / 3);
    const relievedShare = roundBase(transactionBase - createdShare);
    assert.equal(createdShare + relievedShare, transactionBase);
    assert.equal(result.difference.amount, roundBase(3_333 - relievedShare));
  });
});

// ------------------------------------------------- the core worked example

describe("the core specification's worked illustration", () => {
  /**
   * An obligation of USD 880 carried at IDR 13.217.600 — a carrying rate of
   * 15.020 — settled three ways, against currency obtained at 15.800, 15.300
   * and 14.700. The specification states every intermediate figure and the
   * net result, so this reproduces it exactly or the kernel is wrong.
   */
  test("880 USD at 15.020, settled three ways, nets an 88.400 loss and closes clean", () => {
    let position: Balance = { foreign: 880, base: 13_217_600 };
    assert.equal(carryingRate(position), 15_020);

    const differences: number[] = [];

    // 1 — allocate an advance of 200, released from a pool carrying 15.800.
    const one = settle({
      position,
      foreign: 200,
      transactionBase: originate(200, 15_800).base,
    });
    assert.equal(one.settlementBase, 3_004_000);
    assert.deepEqual(one.difference, { amount: -156_000, side: "loss" });
    position = one.remaining!;
    differences.push(one.difference.amount);
    assert.deepEqual(position, { foreign: 680, base: 10_213_600 });
    assert.equal(carryingRate(position), 15_020, "relief never moves the rate");

    // 2 — pay 250 from a USD account whose currency cost 15.300.
    const two = settle({
      position,
      foreign: 250,
      transactionBase: originate(250, 15_300).base,
    });
    assert.equal(two.settlementBase, 3_755_000);
    assert.deepEqual(two.difference, { amount: -70_000, side: "loss" });
    position = two.remaining!;
    differences.push(two.difference.amount);
    assert.deepEqual(position, { foreign: 430, base: 6_458_600 });
    assert.equal(carryingRate(position), 15_020);

    // 3 — pay the remaining 430 from a base-currency account at 14.700. Being
    // a full settlement, the remaining base is released exactly rather than
    // recomputed as 430 × 15.020.
    const three = settle({
      position,
      foreign: 430,
      transactionBase: originate(430, 14_700).base,
    });
    assert.equal(three.settlementBase, 6_458_600);
    assert.deepEqual(three.difference, { amount: 137_600, side: "gain" });
    position = three.remaining!;
    differences.push(three.difference.amount);

    assert.deepEqual(position, { foreign: 0, base: 0 }, "no residue is left");
    assert.equal(carryingRate(position), null);

    const net = differences.reduce((t, d) => t + d, 0);
    assert.equal(net, -88_400, "a net loss of 88.400, entirely explained by rate");
  });
});

// --------------------------------------------- paying out of the pool

describe("a payment out of a foreign resource is valued at its average", () => {
  // Receipts of USD 200 at 15.000, 300 at 15.500 and 200 at 15.000: one pool of
  // USD 700 carried at 15.214,29 — the average, not any receipt's rate.
  const pool: Balance = { foreign: 700, base: 10_650_000 };

  test("the pool's rate is the weighted average of what it received", () => {
    assert.equal(Math.round(carryingRate(pool)! * 100) / 100, 15_214.29);
  });

  test("settling an obligation compares its carrying rate with the pool's", () => {
    // A USD 400 obligation carried at 15.020, paid in full from the pool.
    const cash = relieve(pool, 400);
    assert.equal(cash.base, 6_085_714.29);
    const settled = settle({
      position: { foreign: 400, base: 6_008_000 },
      foreign: 400,
      transactionBase: cash.base,
    });
    assert.equal(settled.settlementBase, 6_008_000);
    assert.deepEqual(settled.difference, { amount: -77_714.29, side: "loss" });
    assert.deepEqual(settled.remaining, { foreign: 0, base: 0 });
  });

  test("splitting the payment does not change what it costs", () => {
    // USD 300 then USD 100 out of the same pool releases what USD 400 does in
    // one go, to the rupiah — nothing is left to a choice of which currency
    // was spent.
    const once = relieve(pool, 400).base;
    const first = relieve(pool, 300);
    const second = relieve(first.remaining, 100);
    assert.ok(Math.abs(first.base + second.base - once) <= 0.01);
  });
});

// -------------------------------------------------------- currency pairing

describe("crossing goes through the base currency only", () => {
  test("the base currency is what the seed creates", () => {
    assert.equal(BASE_CURRENCY_LABEL, "IDR");
    assert.equal(isBaseCurrency("IDR"), true);
    assert.equal(isBaseCurrency("idr"), true);
    assert.equal(isBaseCurrency(" IDR "), true);
    assert.equal(isBaseCurrency("USD"), false);
    assert.equal(isBaseCurrency(null), false);
  });

  test("a foreign document settles from its own currency or from base", () => {
    assert.equal(maySettle("USD", "USD"), true);
    assert.equal(maySettle("USD", "IDR"), true);
    assert.equal(maySettle("EUR", "EUR"), true);
    assert.equal(maySettle("EUR", "IDR"), true);
  });

  test("one foreign currency never settles another", () => {
    assert.equal(maySettle("USD", "EUR"), false);
    assert.equal(maySettle("EUR", "USD"), false);
  });

  test("a base-currency document settles from base alone", () => {
    assert.equal(maySettle("IDR", "IDR"), true);
    assert.equal(maySettle("IDR", "USD"), false);
    assert.equal(maySettle("IDR", "EUR"), false);
  });

  test("a refusal names both currencies", () => {
    assert.equal(settlementRefusal("USD", "IDR"), null);
    const cross = settlementRefusal("USD", "EUR");
    assert.ok(cross?.includes("USD") && cross.includes("EUR"));
    const fromBase = settlementRefusal("IDR", "USD");
    assert.ok(fromBase?.includes("IDR"));
  });
});

describe("where a kurs comes from", () => {
  test("a rate of 1 means the money is base currency, and nothing else", () => {
    assert.equal(rateSource("Out", "IDR", "IDR"), "identity");
    assert.equal(rateSource("In", "IDR", "IDR"), "identity");
    // Never for two foreign amounts: that would assert USD 100 is IDR 100.
    assert.notEqual(rateSource("Out", "USD", "USD"), "identity");
    assert.notEqual(rateSource("In", "USD", "USD"), "identity");
  });

  test("foreign leaving a foreign resource is valued at its moving average", () => {
    assert.equal(rateSource("Out", "USD", "USD"), "carrying");
    assert.equal(needsEnteredRate("Out", "USD", "USD"), false);
  });

  test("foreign arriving into a foreign resource states its own rate", () => {
    assert.equal(rateSource("In", "USD", "USD"), "entered");
    assert.equal(needsEnteredRate("In", "USD", "USD"), true);
  });

  test("a foreign document through a base resource states its rate both ways", () => {
    assert.equal(rateSource("Out", "USD", "IDR"), "entered");
    assert.equal(rateSource("In", "USD", "IDR"), "entered");
  });

  test("an impossible pairing has no kurs at all", () => {
    // Null rather than a plausible-looking answer, so a caller that skipped
    // `maySettle` cannot read a rate out of a combination that cannot happen.
    assert.equal(rateSource("Out", "USD", "EUR"), null);
    assert.equal(rateSource("Out", "IDR", "USD"), null);
    assert.equal(needsEnteredRate("Out", "USD", "EUR"), false);
  });

  test("every allowed pairing resolves to exactly one source", () => {
    const currencies = ["IDR", "USD", "EUR"];
    for (const doc of currencies) {
      for (const resource of currencies) {
        for (const direction of ["In", "Out"] as const) {
          const source = rateSource(direction, doc, resource);
          assert.equal(
            source !== null,
            maySettle(doc, resource),
            `${direction} ${doc} from ${resource} disagrees with maySettle`
          );
        }
      }
    }
  });
});
