/**
 * `npm run db:stock-inject -- <file.csv> [--apply]` — brings stock into the
 * stock books without a document (P120), until a receiving document exists.
 * `db:neon-stock-inject` does the same against the deployed database.
 *
 * Every row goes through the inventory book's `receiveStock`, so the lot, both
 * ledgers, both balances and the moving average stay consistent; the whole
 * file is one run (`INJ/YYYY/MM/NNNN`), all or nothing. **No journal is
 * written**: the stock is not in the General Ledger until a journal is made
 * for it, and Nilai Persediaan shows the difference.
 *
 * The CSV has a header row and these columns (`,` or `;` separated):
 *
 *   item       the item's Label or Kode (must be a Barang with Kelola Stok)
 *   warehouse  the Gudang's Label or Kode
 *   lot        lot number; an existing lot of the item is added to
 *   expiry     YYYY-MM-DD or DD/MM/YYYY; required for Memiliki Kadaluarsa
 *   qty        in the item's base unit, `.` decimals, up to 6
 *   value      whole rupiah, the total value of the row (not per unit)
 *   date       the posting date, YYYY-MM-DD or DD/MM/YYYY
 *
 * Without `--apply` it checks the file and prints what it would inject. (Not
 * `--confirm`: the Neon launcher keeps that flag for itself.)
 */
import fs from "node:fs";
import { prisma } from "../src/lib/prisma";
import { InventoryRefusal, injectStock, type InjectionRow } from "../src/lib/erp/inventory";

const COLUMNS = ["item", "warehouse", "lot", "expiry", "qty", "value", "date"] as const;

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function parseDate(raw: string, what: string, line: number): Date | null {
  const v = raw.trim();
  if (!v) return null;
  let iso = v;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (dmy) iso = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) die(`Baris ${line}: ${what} "${v}" bukan tanggal.`);
  return new Date(`${iso}T00:00:00Z`);
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const confirmed = args.includes("--apply");
  if (!file) die("Sebutkan file CSV: npm run db:stock-inject -- stok.csv [--apply]");
  if (!fs.existsSync(file)) die(`File ${file} tidak ditemukan.`);

  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) die("File kosong: butuh baris judul dan minimal satu baris data.");
  const sep = lines[0].includes(";") ? ";" : ",";
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const at = Object.fromEntries(COLUMNS.map((c) => [c, head.indexOf(c)])) as Record<(typeof COLUMNS)[number], number>;
  const missing = COLUMNS.filter((c) => at[c] < 0);
  if (missing.length) die(`Kolom tidak ada: ${missing.join(", ")}. Judul yang dibutuhkan: ${COLUMNS.join(sep)}`);

  const [items, warehouses, sistem] = await Promise.all([
    prisma.mItem.findMany({ select: { id: true, item_code: true, item_label: true } }),
    prisma.refWarehouse.findMany({ select: { id: true, warehouse_code: true, warehouse_label: true } }),
    prisma.sysUser.findUnique({ where: { email: "sistem@erp.app" }, select: { id: true } }),
  ]);
  if (!sistem) die("Data sistem belum ada. Jalankan `npm run db:seed` dulu.");
  const itemBy = new Map<string, number>();
  for (const i of items) {
    itemBy.set(i.item_code.toUpperCase(), i.id);
    itemBy.set(i.item_label.toUpperCase(), i.id);
  }
  const whBy = new Map<string, number>();
  for (const w of warehouses) {
    whBy.set(w.warehouse_code.toUpperCase(), w.id);
    whBy.set(w.warehouse_label.toUpperCase(), w.id);
  }

  const rows: InjectionRow[] = [];
  for (const [n, raw] of lines.slice(1).entries()) {
    const line = n + 2;
    const cell = raw.split(sep).map((c) => c.trim());
    const get = (c: (typeof COLUMNS)[number]) => cell[at[c]] ?? "";
    const itemId = itemBy.get(get("item").toUpperCase());
    if (!itemId) die(`Baris ${line}: barang "${get("item")}" tidak ditemukan.`);
    const warehouseId = whBy.get(get("warehouse").toUpperCase());
    if (!warehouseId) die(`Baris ${line}: gudang "${get("warehouse")}" tidak ditemukan.`);
    const qty = get("qty");
    const value = get("value");
    if (!/^\d+(\.\d{1,6})?$/.test(qty)) die(`Baris ${line}: qty "${qty}" harus angka, titik desimal, paling banyak 6 desimal.`);
    if (!/^\d+$/.test(value)) die(`Baris ${line}: value "${value}" harus rupiah utuh tanpa pemisah.`);
    const date = parseDate(get("date"), "date", line);
    if (!date) die(`Baris ${line}: date wajib diisi.`);
    rows.push({ itemId, warehouseId, lotNo: get("lot"), expiry: parseDate(get("expiry"), "expiry", line), qty, value, date });
  }

  const total = rows.reduce((s, r) => s + Number(r.value), 0);
  console.log(`\n  ${rows.length} baris, total nilai Rp${total.toLocaleString("id-ID")}.`);
  if (!confirmed) {
    console.log("  Belum diinjeksi. Jalankan ulang dengan --apply untuk mencatatnya ke buku stok.\n");
    return;
  }
  try {
    const run = await injectStock(rows, sistem.id);
    console.log(`  Diinjeksi sebagai ${run.no}: ${run.count} baris. Tidak ada jurnal yang dibuat.\n`);
  } catch (e) {
    if (e instanceof InventoryRefusal) die(`Tidak ada yang diinjeksi. ${e.message}`);
    throw e;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
