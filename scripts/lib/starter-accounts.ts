/**
 * Starter chart of accounts and the account pointers that hang off it
 * (Claude-ERP.md P130): the accounts every posting document needs, under the
 * seeded skeleton, then Account Mapping, the Kategori Item accounts and the
 * Jenis PPh accounts pointed at them.
 *
 * **Idempotent and additive, never overwriting.** An account is matched on its
 * name (case-insensitive) and created only when missing, with the next free
 * code and the next free number under its subcategory. A mapping, a Kategori
 * Item account or a Jenis PPh account is filled only where it is still empty,
 * so a chart the user built by hand keeps every choice they made.
 *
 * Shared by `scripts/seed-accounts.ts` (safe for production) and
 * `scripts/seed-showcase.ts` (development data).
 */
import { prisma } from "../../src/lib/prisma";
import { ENTITIES, CUSTOMER_CATEGORY, SUPPLIER_CATEGORY } from "../../src/lib/erp/entities";
import { nextCode } from "../../src/lib/erp/records";

type AccountSpec = {
  key: string;
  /** The seeded Account Subcategory the account sits under. */
  sub: string;
  name: string;
  normal: "Debit" | "Kredit";
  /** Every line names a Partner of this category (P25). */
  partner?: typeof CUSTOMER_CATEGORY | typeof SUPPLIER_CATEGORY;
  /** Posted by documents only; the manual journal refuses it (P16). */
  control?: boolean;
  note?: string;
};

const C = CUSTOMER_CATEGORY;
const S = SUPPLIER_CATEGORY;

export const STARTER_ACCOUNTS: AccountSpec[] = [
  // ---- assets
  { key: "ar", sub: "1.1.3", name: "Piutang Usaha", normal: "Debit", partner: C, control: true, note: "Tagihan invoice penjualan yang belum dibayar, per customer" },
  { key: "invRaw", sub: "1.1.5", name: "Persediaan Bahan Baku", normal: "Debit", control: true },
  { key: "invPack", sub: "1.1.5", name: "Persediaan Bahan Kemas", normal: "Debit", control: true },
  { key: "invWip", sub: "1.1.5", name: "Persediaan Barang Setengah Jadi", normal: "Debit", control: true },
  { key: "inventory", sub: "1.1.5", name: "Persediaan Barang Jadi", normal: "Debit", control: true },
  { key: "invTrade", sub: "1.1.5", name: "Persediaan Barang Dagangan", normal: "Debit", control: true },
  { key: "invSupplies", sub: "1.1.5", name: "Persediaan Barang Habis Pakai", normal: "Debit", control: true },
  { key: "purchaseAdvance", sub: "1.1.6", name: "Uang Muka Pembelian", normal: "Debit", partner: S, control: true, note: "Uang muka yang sudah dibayar ke supplier, per supplier" },
  { key: "pph23", sub: "1.1.7", name: "PPh 23 Dibayar Dimuka", normal: "Debit", note: "PPh 23 yang dipotong customer — dikreditkan dengan bukti potong" },
  { key: "pph22", sub: "1.1.7", name: "PPh 22 Dibayar Dimuka", normal: "Debit", note: "PPh 22 yang dipungut pembeli atas barang" },
  { key: "inputVat", sub: "1.1.7", name: "PPN Masukan", normal: "Debit", control: true, note: "PPN dari faktur pajak supplier" },
  // ---- liabilities
  { key: "ap", sub: "2.1.1", name: "Hutang Usaha", normal: "Kredit", partner: S, control: true, note: "Tagihan invoice pembelian yang belum dibayar, per supplier" },
  { key: "grir", sub: "2.1.1", name: "Barang Diterima Belum Ditagih", normal: "Kredit", partner: S, control: true, note: "Kliring antara Receipt Note dan Invoice Pembelian, per supplier" },
  { key: "vat", sub: "2.1.2", name: "PPN Keluaran", normal: "Kredit", control: true, note: "PPN terutang atas penyerahan dan uang muka" },
  { key: "pph23Payable", sub: "2.1.2", name: "Hutang PPh 23", normal: "Kredit", note: "PPh 23 yang dipotong dari supplier, disetor ke negara" },
  { key: "advance", sub: "2.1.4", name: "Uang Muka Penjualan", normal: "Kredit", partner: C, control: true, note: "Kewajiban menyerahkan barang atas uang muka yang sudah diterima" },
  // ---- equity
  { key: "capital", sub: "3.1.1", name: "Modal Disetor", normal: "Kredit" },
  { key: "plPrior", sub: "3.3.1", name: "Laba/Rugi Tahun Sebelumnya", normal: "Kredit" },
  { key: "plCurrent", sub: "3.4.1", name: "Laba/Rugi Tahun Berjalan", normal: "Kredit" },
  // ---- income
  { key: "sales", sub: "4.1.1", name: "Penjualan Barang", normal: "Kredit" },
  { key: "returns", sub: "4.1.8", name: "Retur Penjualan", normal: "Debit" },
  { key: "otherIncome", sub: "4.9.1", name: "Pendapatan Lain-lain", normal: "Kredit" },
  { key: "fx", sub: "4.9.1", name: "Laba/Rugi Selisih Kurs", normal: "Kredit" },
  // ---- costs and expenses
  { key: "cogs", sub: "5.1.1", name: "HPP Barang", normal: "Debit" },
  { key: "cogsTrade", sub: "5.1.1", name: "HPP Barang Dagangan", normal: "Debit" },
  { key: "toll", sub: "5.1.1", name: "Biaya Jasa Maklon", normal: "Debit" },
  { key: "freight", sub: "5.2.1", name: "Beban Pengiriman", normal: "Debit" },
  { key: "bankFee", sub: "5.3.1", name: "Beban Bank", normal: "Debit" },
  { key: "admin", sub: "5.3.1", name: "Beban Umum & Administrasi", normal: "Debit" },
  { key: "supplies", sub: "5.3.1", name: "Beban Bahan Habis Pakai", normal: "Debit", note: "Barang yang dibeli tanpa Kelola Stok" },
  { key: "maintenance", sub: "5.3.1", name: "Beban Pemeliharaan", normal: "Debit" },
  { key: "consulting", sub: "5.3.1", name: "Beban Jasa Profesional", normal: "Debit" },
  { key: "otherServices", sub: "5.3.1", name: "Beban Jasa Lain-lain", normal: "Debit" },
  { key: "invoiceDiff", sub: "5.9.1", name: "Selisih Tagihan Supplier", normal: "Debit", note: "Selisih dalam toleransi antara tagihan supplier dan Invoice Pembelian" },
];

/** Account Mapping keys → the starter account each points at (P61). */
export const STARTER_MAPPINGS: [setting: string, account: string][] = [
  ["fx_account", "fx"],
  ["accumulated_pl_account", "plPrior"],
  ["current_pl_account", "plCurrent"],
  ["sales_advance_account", "advance"],
  ["output_vat_account", "vat"],
  ["bank_charge_account", "bankFee"],
  ["cogs_account", "cogs"],
  ["inventory_account", "inventory"],
  ["receivable_account", "ar"],
  ["sales_revenue_account", "sales"],
  ["goods_received_account", "grir"],
  ["payable_account", "ap"],
  ["purchase_advance_account", "purchaseAdvance"],
  ["input_vat_account", "inputVat"],
  ["supplier_invoice_diff_account", "invoiceDiff"],
];

/** Jenis PPh label → its account: PPh Dibayar Dimuka for sales, Hutang PPh for purchases (P122). */
export const STARTER_WHT_ACCOUNTS: [whtLabel: string, account: string][] = [
  ["PPH22", "pph22"],
  ["PPH23", "pph23"],
  ["PPH23-15", "pph23"],
  ["PPH23-BELI", "pph23Payable"],
];

/** Kategori Item → [Persediaan, HPP, Beban]; a Jasa category takes Beban only (P122). */
export const STARTER_CATEGORY_ACCOUNTS: [category: string, inventory: string | null, cogs: string | null, expense: string][] = [
  ["BHN-BAKU", "invRaw", "cogs", "supplies"],
  ["BHN-KEMAS", "invPack", "cogs", "supplies"],
  ["BRG-SETENGAH-JADI", "invWip", "cogs", "supplies"],
  ["BRG-JADI", "inventory", "cogs", "supplies"],
  ["BRG-DAGANG", "invTrade", "cogsTrade", "supplies"],
  ["BRG-HABIS-PAKAI", "invSupplies", "cogs", "supplies"],
  ["JASA-PEMELIHARAAN", null, null, "maintenance"],
  ["JASA-KONSULTASI", null, null, "consulting"],
  ["JASA-PENGIRIMAN", null, null, "freight"],
  ["JASA-MAKLON", null, null, "toll"],
  ["JASA-LAIN", null, null, "otherServices"],
];

const accountEntity = () => {
  const e = ENTITIES.find((x) => x.key === "acc_account");
  if (!e) throw new Error("Registry entity acc_account not found");
  return e;
};

/** The next free account number directly under a subcategory: `1.1.3` → `1.1.3.2`. */
export async function nextAccountLabel(sub: string): Promise<string> {
  const rows = await prisma.accAccount.findMany({
    where: { account_label: { startsWith: `${sub}.` } },
    select: { account_label: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = Number(r.account_label.slice(sub.length + 1).split(".")[0]);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${sub}.${max + 1}`;
}

export type StarterAccountsResult = {
  /** Starter key → account id, for the accounts found or created. */
  accountId: Map<string, number>;
  /** What was created or filled, by kind. */
  made: Record<string, number>;
};

/** Create the starter accounts and fill every empty pointer to them. */
export async function seedStarterAccounts(actor: number): Promise<StarterAccountsResult> {
  const made: Record<string, number> = {};
  const tally = (what: string) => (made[what] = (made[what] ?? 0) + 1);

  const categories = new Map(
    (await prisma.sysPartnerCategory.findMany()).map((c) => [c.category_label, c.id]),
  );

  const accountId = new Map<string, number>();
  for (const a of STARTER_ACCOUNTS) {
    let row = await prisma.accAccount.findFirst({ where: { account_name: { equals: a.name, mode: "insensitive" } } });
    if (!row) {
      const sub = await prisma.accAccountSubcategory.findFirst({ where: { subcategory_label: a.sub } });
      if (!sub) throw new Error(`Account subcategory ${a.sub} is missing. Run \`npm run db:seed\` first.`);
      const partnerCategory = a.partner ? categories.get(a.partner) : null;
      if (a.partner && !partnerCategory) throw new Error(`Partner Category ${a.partner} is missing. Run \`npm run db:seed\` first.`);
      row = await prisma.accAccount.create({
        data: {
          account_code: await nextCode(accountEntity()),
          account_label: await nextAccountLabel(a.sub),
          account_name: a.name,
          account_subcategory_id: sub.id,
          is_postable: true,
          normal_balance: a.normal,
          is_control_account: Boolean(a.control),
          require_partner: Boolean(a.partner),
          partner_category_id: partnerCategory ?? null,
          note: a.note ?? null,
          created_by: actor,
        },
      });
      await prisma.auditLog.create({
        data: { entity_key: "acc_account", row_id: row.id, action: "TAMBAH", event: "create", by: actor },
      });
      tally("accounts");
    }
    accountId.set(a.key, row.id);
  }

  // ---- Account Mapping — only where still empty.
  for (const [key, account] of STARTER_MAPPINGS) {
    const current = await prisma.sysSetting.findUnique({ where: { setting_key: key } });
    if (current?.setting_value) continue;
    const value = String(accountId.get(account));
    await prisma.sysSetting.upsert({
      where: { setting_key: key },
      update: { setting_value: value, updated_by: actor },
      create: { setting_key: key, setting_value: value, updated_by: actor },
    });
    tally("account mappings");
  }

  // ---- Jenis PPh accounts — only where still empty.
  for (const [whtLabel, account] of STARTER_WHT_ACCOUNTS) {
    const done = await prisma.refWithholdingTax.updateMany({
      where: { wht_label: whtLabel, account_id: null },
      data: { account_id: accountId.get(account), updated_by: actor },
    });
    if (done.count) tally("jenis PPh accounts");
  }

  // ---- Kategori Item accounts — each column only where still empty.
  for (const [label, inventory, cogs, expense] of STARTER_CATEGORY_ACCOUNTS) {
    const category = await prisma.sysItemCategory.findFirst({ where: { category_label: label } });
    if (!category) continue;
    const want = {
      inventory_account_id: inventory ? accountId.get(inventory)! : null,
      cogs_account_id: cogs ? accountId.get(cogs)! : null,
      expense_account_id: accountId.get(expense)!,
    };
    const current = await prisma.accItemCategoryAccount.findUnique({ where: { category_id: category.id } });
    const fill = {
      inventory_account_id: current?.inventory_account_id ?? want.inventory_account_id,
      cogs_account_id: current?.cogs_account_id ?? want.cogs_account_id,
      expense_account_id: current?.expense_account_id ?? want.expense_account_id,
    };
    if (
      current &&
      current.inventory_account_id === fill.inventory_account_id &&
      current.cogs_account_id === fill.cogs_account_id &&
      current.expense_account_id === fill.expense_account_id
    ) continue;
    const row = await prisma.accItemCategoryAccount.upsert({
      where: { category_id: category.id },
      update: { ...fill, updated_by: actor },
      create: { category_id: category.id, ...fill, created_by: actor },
    });
    await prisma.auditLog.create({
      data: { entity_key: "acc_item_category_account", row_id: row.id, action: "UPDATE", event: "update", by: actor },
    });
    tally("kategori item accounts");
  }

  return { accountId, made };
}
