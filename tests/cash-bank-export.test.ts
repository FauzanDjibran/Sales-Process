import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

import { cashBankLedgerWorkbook } from "../src/lib/erp/cash-bank-export";
import { cashBankBalanceWorkbook } from "../src/lib/erp/cash-bank-balance-export";
import type { BalanceReportRow, LedgerEntryRow, LedgerReport } from "../src/lib/erp/cash-bank";

/**
 * Buku Kas & Bank's Unduh XLSX: one block per Cash & Bank, each opening on its
 * Saldo Awal and closing on a Saldo Akhir that reconciles, every figure in the
 * resource's own currency and none in base. Pure.
 */

const range = { from: "2026-01-01", to: "2026-09-30" };

const entry = (o: Partial<LedgerEntryRow>): LedgerEntryRow => ({
  id: 1,
  entryNo: "CBL-0001",
  lineNo: 1,
  date: "2026-01-09",
  type: "Transaction",
  direction: "In",
  amount: 0,
  movement: 0,
  rate: 1,
  baseAmount: 0,
  baseMovement: 0,
  note: null,
  sourceDocTable: null,
  sourceDocId: null,
  sourceDocNo: null,
  ...o,
});

const book = (label: string, currencyLabel: string, o: Partial<LedgerReport>): LedgerReport => ({
  resource: { id: 1, label, name: label, type: "Bank", active: true, currencyLabel },
  range,
  opening: 0,
  totalIn: 0,
  totalOut: 0,
  closing: 0,
  baseOpening: 0,
  baseTotalIn: 0,
  baseTotalOut: 0,
  baseClosing: 0,
  entryCount: o.entries?.length ?? 0,
  entries: [],
  reconciles: true,
  ...o,
});

test("each Cash & Bank runs from Saldo Awal to Saldo Akhir in its own currency, on A4 portrait, with no formula", async () => {
  const file = await cashBankLedgerWorkbook({
    companyName: "ABHC & Co",
    range,
    books: [
      book("BCA-IDR", "IDR", {
        opening: 1000,
        totalIn: 500,
        totalOut: 200,
        closing: 1300,
        entries: [
          entry({ movement: 500, note: "Setoran", sourceDocTable: "fin_cash_bank_tx", sourceDocNo: "BKM/2026/01/0001" }),
          entry({ movement: -200, note: "Bayar", sourceDocTable: "fin_cash_bank_tx", sourceDocNo: "BKK/2026/01/0001" }),
        ],
      }),
      book("BCA-USD", "USD", {
        opening: 50,
        closing: 50,
        baseOpening: 800,
        baseClosing: 800,
      }),
      book("KAS", "IDR", { opening: 7, closing: 7 }),
    ],
    footnotes: ["Catatan."],
    printedBy: "Tester",
    printedAt: "22/10/2026 08:00",
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const rows: ExcelJS.Row[] = [];
  ws.eachRow((r) => rows.push(r));
  const find = (col: number, text: string) => rows.filter((r) => String(r.getCell(col).value ?? "").startsWith(text));
  const figures = (r: ExcelJS.Row) => [4, 5, 6].map((c) => r.getCell(c).value ?? null);

  assert.deepEqual(find(3, "Saldo Awal").map((r) => r.getCell(6).value), [1000, 50, 7]);
  const inn = find(2, "BKM/")[0];
  assert.deepEqual(figures(inn), [500, null, null]);
  assert.equal(inn.getCell(3).value, "Setoran");
  assert.deepEqual(figures(find(2, "BKK/")[0]), [null, 200, null]);
  assert.equal(inn.getCell(2).value, "BKM/2026/01/0001\nPenerimaan");
  assert.equal(find(2, "BKK/")[0].getCell(2).value, "BKK/2026/01/0001\nPengeluaran");

  const closing = find(3, "Saldo Akhir");
  assert.deepEqual(closing.map(figures), [[500, 200, 1300], [0, 0, 50], [0, 0, 7]]);
  assert.equal(find(3, "Tidak ada mutasi").length, 2);

  // Each block states its currency, and its figures carry the code.
  assert.deepEqual(find(6, "Mata uang:").map((r) => r.getCell(6).value), ["Mata uang: IDR", "Mata uang: USD", "Mata uang: IDR"]);
  assert.match(closing[1].getCell(6).numFmt, /"USD"/);
  // No base figure anywhere on a foreign book.
  ws.eachRow((r) => r.eachCell((c) => assert.ok(c.value !== 800 && c.value !== 900)));

  ws.eachRow((r) => r.eachCell((c) => assert.equal(c.formula, undefined)));
  assert.equal(ws.pageSetup.paperSize, 9);
  assert.equal(ws.pageSetup.orientation, "portrait");
});

test("Saldo Kas & Bank: one block per currency, a row per Cash & Bank, a Jumlah per currency, never added across", async () => {
  const row = (cashBankId: number, label: string, o: Partial<BalanceReportRow>): BalanceReportRow => ({
    cashBankId,
    label,
    name: label,
    type: "Bank",
    active: true,
    opening: 0,
    totalIn: 0,
    totalOut: 0,
    closing: 0,
    baseOpening: 0,
    baseTotalIn: 0,
    baseTotalOut: 0,
    baseClosing: 0,
    moved: false,
    ...o,
  });
  const zeroBase = { baseOpening: 0, baseTotalIn: 0, baseTotalOut: 0, baseClosing: 0 };
  const file = await cashBankBalanceWorkbook({
    companyName: "ABHC",
    report: {
      range,
      resources: 3,
      ...zeroBase,
      groups: [
        {
          currencyId: 1,
          currencyLabel: "IDR",
          rows: [
            row(1, "BCA-IDR", { opening: 1000, totalIn: 500, totalOut: 200, closing: 1300 }),
            row(2, "KAS", { opening: 7, closing: 7, type: "Cash", active: false }),
          ],
          opening: 1007,
          totalIn: 500,
          totalOut: 200,
          closing: 1307,
          ...zeroBase,
        },
        {
          currencyId: 2,
          currencyLabel: "USD",
          rows: [row(3, "BCA-USD", { opening: 50, closing: 50, baseOpening: 800, baseClosing: 800 })],
          opening: 50,
          totalIn: 0,
          totalOut: 0,
          closing: 50,
          baseOpening: 800,
          baseTotalIn: 0,
          baseTotalOut: 0,
          baseClosing: 800,
        },
      ],
    },
    footnotes: ["Catatan."],
    printedBy: "Tester",
    printedAt: "22/10/2026 08:00",
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const rows: ExcelJS.Row[] = [];
  ws.eachRow((r) => rows.push(r));
  const find = (col: number, text: string) => rows.filter((r) => String(r.getCell(col).value ?? "").startsWith(text));
  const figures = (r: ExcelJS.Row) => [3, 4, 5, 6].map((c) => r.getCell(c).value ?? null);

  assert.deepEqual(figures(find(1, "BCA-IDR")[0]), [1000, 500, 200, 1300]);
  assert.equal(find(1, "KAS")[0].getCell(2).value, "KAS · Cash · non-aktif");
  const totals = find(2, "Jumlah");
  assert.deepEqual(totals.map((r) => r.getCell(2).value), ["Jumlah IDR", "Jumlah USD"]);
  assert.deepEqual(totals.map(figures), [[1007, 500, 200, 1307], [50, 0, 0, 50]]);
  assert.match(totals[1].getCell(6).numFmt, /"USD"/);
  // No base figure, and no line adding the currencies together.
  ws.eachRow((r) => r.eachCell((c) => assert.ok(c.value !== 800 && c.value !== 1357)));
  ws.eachRow((r) => r.eachCell((c) => assert.equal(c.formula, undefined)));
  assert.equal(ws.pageSetup.paperSize, 9);
});
