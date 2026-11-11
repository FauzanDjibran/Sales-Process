import test, { after, describe } from "node:test";
import assert from "node:assert/strict";
import { claimDocumentNumber } from "../src/lib/erp/number-counter";
import { disconnect, prisma } from "./helpers";

/** The series counter (5.4): it carries a series on, counts up, and gives a number back on rollback. */
const PREFIX = `ZT${Date.now().toString(36).slice(-4).toUpperCase()}`;
const DATE = "2026-11-12";

after(async () => {
  await prisma.sysNumberCounter.deleteMany({ where: { series: { startsWith: `${PREFIX}/` } } });
  await disconnect();
});

describe("claimDocumentNumber", () => {
  test("a new counter starts after the highest number already written, then counts up", async () => {
    const first = await prisma.$transaction((tx) => claimDocumentNumber(tx, PREFIX, DATE, async () => `${PREFIX}/2026/11/0041`));
    assert.equal(first, `${PREFIX}/2026/11/0042`);
    const next = await prisma.$transaction((tx) => claimDocumentNumber(tx, PREFIX, DATE, async () => assert.fail("asked only once")));
    assert.equal(next, `${PREFIX}/2026/11/0043`);
  });

  test("a rolled-back posting gives its number back", async () => {
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await claimDocumentNumber(tx, PREFIX, DATE, async () => null);
        throw new Error("dry run");
      })
    );
    assert.equal(await prisma.$transaction((tx) => claimDocumentNumber(tx, PREFIX, DATE, async () => null)), `${PREFIX}/2026/11/0044`);
  });
});
