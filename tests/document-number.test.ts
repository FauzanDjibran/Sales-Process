import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  documentSeries,
  documentSequence,
  formatDocumentNumber,
  nextDocumentNumber,
} from "../src/lib/erp/document-number";

/**
 * Every document, journal and book entry is numbered `PREFIX/YYYY/MM/NNNN`,
 * one series per prefix per month (Claude-ERP.md P15) — the format the sales
 * simulation's `nextNo` produces. Pure arithmetic, so no database is needed.
 */
describe("document numbers read PREFIX/YYYY/MM/NNNN", () => {
  test("the month comes from the document's date", () => {
    assert.equal(formatDocumentNumber("JV", "2026-09-15", 1), "JV/2026/09/0001");
    assert.equal(
      formatDocumentNumber("OPB", new Date(Date.UTC(2027, 0, 1)), 12),
      "OPB/2027/01/0012"
    );
  });

  test("a sequence beyond four digits simply grows", () => {
    assert.equal(formatDocumentNumber("JV", "2026-09-15", 12345), "JV/2026/09/12345");
  });

  test("the series a reader filters on is the number without its tail", () => {
    assert.equal(documentSeries("SOB", "2026-12-31"), "SOB/2026/12/");
  });

  test("the tail is read after the last slash, whatever the prefix", () => {
    assert.equal(documentSequence("JV/2026/09/0042"), 42);
    assert.equal(documentSequence("CBLY/2026/09/0007"), 7);
    assert.equal(documentSequence(null), 0);
    assert.equal(documentSequence("nonsense"), 0);
  });

  test("each month starts its own series", async () => {
    const asked: string[] = [];
    const september = await nextDocumentNumber("JV", "2026-09-30", async (series) => {
      asked.push(series);
      return "JV/2026/09/0041";
    });
    const october = await nextDocumentNumber("JV", "2026-10-01", async (series) => {
      asked.push(series);
      return null;
    });
    assert.equal(september, "JV/2026/09/0042");
    assert.equal(october, "JV/2026/10/0001");
    assert.deepEqual(asked, ["JV/2026/09/", "JV/2026/10/"], "the reader is asked for one month's series");
  });
});
