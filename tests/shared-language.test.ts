import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** One word and one colour per status, one term per thing (UI-UX-Plan stage 1, P312). */

const LIB = path.join(process.cwd(), "src/lib/erp");

/** Posted is the receipt itself on these documents. */
const RECEIVED = new Set(["PRODUCTION_RECEIPT", "TRANSFER", "STOCK_TRANSFER_RECEIPT"]);

test("a status reads the same word in the same colour on every document", async () => {
  const seen = new Map<string, string>();
  const bad: string[] = [];
  for (const f of fs.readdirSync(LIB).filter((x) => /(workflow|shape)\.ts$/.test(x))) {
    const mod = (await import(pathToFileURL(path.join(LIB, f)).href)) as Record<string, unknown>;
    for (const [name, map] of Object.entries(mod)) {
      const kind = /^(.+)_STATUS_(TEXT|BADGE)$/.exec(name);
      if (!kind) continue;
      for (const [status, value] of Object.entries(map as Record<string, string>)) {
        if (kind[2] === "TEXT" && status === "Posted" && RECEIVED.has(kind[1])) {
          if (value !== "Diterima") bad.push(`${name}.${status} = ${value}`);
          continue;
        }
        const key = `${kind[2]}.${status}`;
        if (!seen.has(key)) seen.set(key, value);
        else if (seen.get(key) !== value) bad.push(`${name}.${status} = ${value}, elsewhere ${seen.get(key)}`);
      }
    }
  }
  assert.ok(seen.size > 15, "status maps not found");
  assert.deepEqual(bad, []);
});

test("the retired terms are not on an ERP screen", () => {
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === "generated" ? [] : walk(path.join(d, e.name))) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []
    );
  const old = /Cash & Bank|Cash Bank Book|Pilih Surat Jalan|"Tutup Pesanan"|No\. Lot\b/;
  const bad = walk("src").flatMap((f) =>
    fs
      .readFileSync(f, "utf8")
      .split("\n")
      .flatMap((l, i) => (old.test(l) && !/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(l) ? [`${f}:${i + 1}`] : []))
  );
  assert.deepEqual(bad, []);
});
