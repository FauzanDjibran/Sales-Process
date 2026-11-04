import test, { after, describe } from "node:test";
import assert from "node:assert/strict";

import { listCashPayments } from "../src/lib/erp/cash-payment";
import { listCashReceipts } from "../src/lib/erp/cash-bank-tx";
import { listJournals } from "../src/lib/erp/journal";
import { DEFAULT_PAGE_SIZE, parseRegisterQuery, windowOf } from "../src/lib/erp/register-query";
import { disconnect, prisma } from "./helpers";

after(async () => {
  await disconnect();
});

describe("what a register is asked for", () => {
  test("anything unrecognised reads as the default", () => {
    assert.deepEqual(parseRegisterQuery({ page: "0", size: "7", q: "  abc ", status: "Nope" }, ["Draft"]), {
      page: 1,
      size: DEFAULT_PAGE_SIZE,
      q: "abc",
      status: "",
    });
    assert.deepEqual(parseRegisterQuery({ page: "3", size: "50", status: "Draft" }, ["Draft"]), {
      page: 3,
      size: 50,
      q: "",
      status: "Draft",
    });
  });

  test("a page past the end is the last page, and an empty register has one", () => {
    assert.deepEqual(windowOf(26, { page: 9, size: 25 }), { page: 2, pages: 2, skip: 25, take: 25 });
    assert.deepEqual(windowOf(0, { page: 1, size: 25 }), { page: 1, pages: 1, skip: 0, take: 25 });
  });
});

describe("the database pages each register", () => {
  const query = (over = {}) => ({ page: 1, size: 10, q: "", status: "", ...over });

  test("the Journal holds its filter over every page, Drafts first", async () => {
    const all = await prisma.accJournal.count();
    const page = await listJournals(query());
    assert.equal(page.all, all);
    assert.equal(page.total, all);
    assert.ok(page.rows.length <= 10);
    const ranks = page.rows.map((r) => ["Draft", "Posted", "Cancelled"].indexOf(r.status));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));

    const posted = await listJournals(query({ status: "Posted" }));
    assert.equal(posted.total, await prisma.accJournal.count({ where: { status: "Posted" } }));
    assert.equal(posted.all, all, "`all` ignores the filter");
    assert.ok(posted.rows.every((r) => r.status === "Posted"));

    const manual = await listJournals(query(), "manual");
    assert.ok(manual.rows.every((r) => r.isManual));
  });

  test("Penerimaan and Pengeluaran page their own direction, and a miss is empty", async () => {
    const receipts = await listCashReceipts(query());
    assert.equal(receipts.all, await prisma.finCashBankTx.count({ where: { direction: "In" } }));
    const payments = await listCashPayments(query());
    assert.equal(payments.all, await prisma.finCashBankTx.count({ where: { direction: "Out" } }));

    const miss = await listCashReceipts(query({ q: "no-such-receipt-anywhere" }));
    assert.deepEqual([miss.total, miss.rows.length, miss.pages], [0, 0, 1]);
  });
});
