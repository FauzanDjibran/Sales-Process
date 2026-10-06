/**
 * Brings the system tables up to date. Nothing else.
 *
 * The seed owns exactly three kinds of row:
 *
 *   1. The `sys_*` tables — the bootstrap administrator, the permission
 *      catalogue and the seeded roles.
 *   2. The reference tables that behave as system data even though their names
 *      say otherwise: account types, document types, partner categories, and
 *      the account category / subcategory skeleton the
 *      chart of accounts hangs off. Application logic reads these by label, so
 *      they are code in the same sense the permission catalogue is. The
 *      Indonesian region reference (P40) and Kategori Item (P47) are the same
 *      kind of row.
 *   3. Starting rows the user asked for (P44): the common Jenis PPh. Created
 *      once, then the user's to edit — never overwritten.
 *
 * Everything else — partners, cash & bank resources, currencies beyond the
 * reporting base, accounts, fiscal years and periods, and every document — is
 * business data that real users create through the
 * application. It is deliberately absent here.
 *
 * The seed is idempotent and never deletes business data. Rows are created when
 * missing and otherwise left alone, so running it against a live database is
 * safe: it adds what a new release introduced and touches nothing a user has
 * entered or adjusted.
 *
 * Run with: npm run db:seed
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PERMISSIONS } from "../src/lib/erp/permissions";
import { SEEDED_ROLES, ADMIN_ROLE, adminPermissionCodes } from "../src/lib/erp/roles";
import { parentCode } from "../src/lib/erp/account-code";
import { BASE_CURRENCY_LABEL } from "../src/lib/erp/currency";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * The bootstrap administrator.
 *
 * Credentials come from the environment so no real password is ever committed.
 * Outside development the seed refuses to run without one — the fallback below
 * exists purely so a local checkout works out of the box, and CLAUDE.md §11
 * records that it must not survive into a deployed environment.
 */
const ADMIN_EMAIL = process.env.ERP_ADMIN_EMAIL?.trim().toLowerCase() || "admin@erp.app";
const ADMIN_NAME = process.env.ERP_ADMIN_NAME?.trim() || "Administrator";
const ADMIN_INITIALS = process.env.ERP_ADMIN_INITIALS?.trim().toUpperCase() || "AD";

const DEV_PASSWORD = "erp123";

function resolveAdminPassword(): string {
  const fromEnv = process.env.ERP_ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ERP_ADMIN_PASSWORD is required outside development. Set it before seeding."
    );
  }
  return DEV_PASSWORD;
}

/**
 * The reporting base currency. Further currencies are added through the app.
 *
 * The **label** comes from `lib/erp/currency.ts` and is no longer configurable.
 * It used to be read from `ERP_BASE_CURRENCY`, which was harmless while nothing
 * in the application knew or cared which currency was base. It is not harmless
 * now: every book entry records what it was worth in base currency, and the code
 * that decides whether a rate of 1 is honest reads the constant. Two statements
 * of one fact would mean an installation could seed `USD` while the application
 * valued everything as though it were `IDR`.
 *
 * The **name** stays configurable: it is display text and nothing branches on it.
 */
const BASE_CURRENCY_NAME = process.env.ERP_BASE_CURRENCY_NAME?.trim() || "Rupiah Indonesia";

const pad4 = (n: number) => String(n).padStart(4, "0");
const code = (prefix: string, n: number) => `${prefix}.${pad4(n)}`;

/** Tally of what this run had to create, printed at the end. */
const created: Record<string, number> = {};
const tally = (what: string, n = 1) => {
  if (n) created[what] = (created[what] ?? 0) + n;
};

// ------------------------------------------------------------- system data
//
// Labels are load-bearing: `CASH_BANK_SUBCATEGORY` in `records.ts` names the
// chart-of-accounts group a cash or bank resource posts into. Renaming a label
// here without renaming it there silently breaks a business rule.

/**
 * **Append only.** Each row's `doc_code` is `dtyp.<index + 1>`, so inserting a
 * type in the middle renumbers every one after it and the seed then collides
 * with the codes already in the database — which is a unique-constraint error
 * on a seeder whose whole contract is that it is safe to re-run. A new
 * document type goes at the end, whatever the reading order would prefer.
 */
const DOC_TYPES: [label: string, table: string][] = [
  ["Journal", "acc_journal"],
  ["Opening Balance", "acc_opening_balance"],
  // A Fiscal Year is a document type because closing one *produces* journals:
  // the closing entry names the year it closed as its source, which is what
  // lets a reader get from a journal line back to the close that wrote it.
  ["Fiscal Year", "acc_fiscal_year"],
  // An Invoice and a Pembayaran name the order they come from through the weak
  // (doc_type_id, doc_id) pair (§3.1). Called "Sales Order" until P78, when
  // the migration renamed this row in place.
  ["Customer Order", "sal_customer_order"],
  // Pembayaran will name the advance bill it settles the same way.
  ["Uang Muka Penjualan", "fin_ar_advance"],
  // A posted Penerimaan / Pengeluaran names itself on its journal and its
  // Cash Bank Book entry.
  ["Transaksi Kas & Bank", "fin_cash_bank_tx"],
  // The Customer Order's child that releases quantity to PPIC (P79); the
  // Delivery Order will name it line by line (C28).
  ["Sales Order", "sal_order"],
  // The warehouse instruction drawn from Open Sales Orders (P93); the Delivery
  // Note will name it.
  ["Delivery Order", "sal_delivery_order"],
  // The note the goods leave on; its journal and stock issues name it. A
  // standalone logistics document since P106 (was `sal_delivery_note`).
  ["Delivery Note", "log_delivery_note"],
  ["Invoice Penjualan", "fin_ar_invoice"],
  // Stock brought in by `db:stock-inject` (P120): each run is one source, its
  // ledger rows named by the run's INJ/… number.
  ["Injeksi Stok", "log_stock_injection"],
  // Purchasing (P123): the Purchase Order names it line by line.
  ["Purchase Request", "pur_request"],
];

/**
 * Customer and Supplier only, for now (Claude-ERP.md P30). An account that
 * requires a Partner names one of these, so a Piutang account takes Customers
 * and a Hutang account Suppliers.
 *
 * Supplier starts Inactive (P41): the application is built for sales first,
 * and a supplier's tax treatment is not designed yet. It is created only when
 * missing, so an installation that has switched it back on keeps it on.
 */
const PARTNER_CATEGORIES: [
  label: string,
  name: string,
  note: string,
  status: "Active" | "Inactive",
][] = [
  ["Customer", "Pelanggan", "Pihak yang membeli barang atau jasa dari perusahaan.", "Active"],
  // Active since purchasing (P122; P41 kept it Inactive until then).
  ["Supplier", "Pemasok", "Pihak yang menjual barang atau jasa kepada perusahaan.", "Active"],
];

/**
 * Kategori Item (P47): system data with no menu. Each belongs to one Item
 * Type, and an item may only take a category of its own type. Matched on the
 * label, so a later release can add to the list without duplicating it.
 */
/**
 * Stock statuses (P120), as SAP's unrestricted / quality inspection / blocked.
 * Only Tersedia is received into and issued from today. Append only, like the
 * document types: the code is the index.
 */
const STOCK_STATUSES: [label: string, name: string, issuable: boolean][] = [
  ["TERSEDIA", "Tersedia", true],
  ["KARANTINA", "Karantina", false],
  ["DIBLOKIR", "Diblokir", false],
];

const ITEM_CATEGORIES: [label: string, name: string, type: "Barang" | "Jasa"][] = [
  ["BHN-BAKU", "Bahan Baku", "Barang"],
  ["BHN-KEMAS", "Bahan Kemas", "Barang"],
  ["BRG-SETENGAH-JADI", "Barang Setengah Jadi", "Barang"],
  ["BRG-JADI", "Barang Jadi", "Barang"],
  ["BRG-DAGANG", "Barang Dagangan", "Barang"],
  ["BRG-HABIS-PAKAI", "Barang Habis Pakai", "Barang"],
  ["JASA-PEMELIHARAAN", "Jasa Pemeliharaan", "Jasa"],
  ["JASA-KONSULTASI", "Jasa Konsultasi", "Jasa"],
  ["JASA-PENGIRIMAN", "Jasa Pengiriman", "Jasa"],
  ["JASA-MAKLON", "Jasa Maklon", "Jasa"],
  ["JASA-LAIN", "Jasa Lain-lain", "Jasa"],
];

/**
 * The Jenis PPh a new installation starts with — the withholdings a customer
 * commonly applies when it pays (P44). Starting data, not code: users change
 * rates and objek as the rules change, and add their own. No prepaid-tax
 * account, because the chart a fresh install has holds no such account yet.
 */
const WITHHOLDING_TAXES: [label: string, name: string, rate: number, taxObject: string][] = [
  [
    "PPH22",
    "PPh Pasal 22 — Penjualan kepada Pemungut",
    1.5,
    "Penjualan barang kepada pemungut PPh 22: bendahara instansi pemerintah, BUMN dan badan tertentu.",
  ],
  [
    "PPH23",
    "PPh Pasal 23 — Jasa dan Sewa",
    2,
    "Imbalan jasa, sewa dan penghasilan lain sehubungan dengan penggunaan harta selain tanah dan/atau bangunan.",
  ],
  [
    "PPH23-15",
    "PPh Pasal 23 — Dividen, Bunga, Royalti, Hadiah",
    15,
    "Dividen, bunga, royalti, serta hadiah, penghargaan dan bonus selain yang telah dipotong PPh 21.",
  ],
  // Final withholding (PPh 4(2)) is out of scope until it is needed (P60), so
  // it is not seeded. An installation seeded before that keeps its row; the
  // seed never deletes.
];

/**
 * The chart-of-accounts skeleton, transcribed from `Initialization/Template
 * COA.xlsx` (Sheet1, the workbook's only visible sheet).
 *
 * One flat list, because the hierarchy is already in the codes: a row's depth
 * is its number of segments, and its parent is its code minus the last one.
 * Depth 1 is an Account Type, depth 2 an Account Category, depth 3 an Account
 * Subcategory. Anything deeper is an account, which users create through the
 * application — see `lib/erp/account-code.ts`.
 *
 * Three deviations from the sheet, all of them forced:
 *
 *   - Categories 3.2–3.5 have no row of their own in the sheet, only their
 *     single subcategory. They are named after it, because a subcategory
 *     cannot exist without the category its code claims.
 *   - 4.1.1, 5.1.1 and 5.2.1 have a blank name cell. Each takes its category's
 *     name, the convention the sheet already uses at 4.9.1 and 5.9.1.
 *   - Names are kept verbatim from the sheet, capitals included. They are the
 *     user's own chart, not ours to restyle.
 *
 * `CASH_BANK_SUBCATEGORY` in `lib/erp/records.ts` names 1.1.1 as the group a
 * cash or bank resource posts into, so that code is load-bearing.
 */
const COA_SKELETON: [code: string, name: string][] = [
  ["1", "AKTIVA"],
  ["1.1", "AKTIVA LANCAR"],
  ["1.1.1", "KAS / SETARA KAS"],
  ["1.1.2", "INVESTASI LANCAR"],
  ["1.1.3", "PIUTANG DAGANG"],
  ["1.1.4", "PIUTANG LAIN-LAIN"],
  ["1.1.5", "PERSEDIAAN"],
  ["1.1.6", "UANG MUKA PEMBELIAN"],
  ["1.1.7", "UANG MUKA PAJAK"],
  ["1.1.8", "BIAYA DIBAYAR DIMUKA"],
  ["1.2", "AKTIVA TIDAK LANCAR"],
  ["1.2.1", "INVESTASI JANGKA PANJANG"],
  ["1.3", "AKTIVA TETAP"],
  ["1.3.1", "TANAH"],
  ["1.3.2", "PERALATAN DAN MESIN"],
  ["1.3.3", "GEDUNG DAN BANGUNAN"],
  ["1.3.4", "KENDARAAN DAN INVENTARIS"],
  ["1.3.9", "AKUMULASI PENYUSUTAN"],
  ["1.4", "ASET LAINNYA"],
  ["1.4.1", "ASET TIDAK BERWUJUD"],
  ["1.4.8", "PRA OPERASI"],
  ["1.4.9", "AMORTISASI ASET LAINNYA"],
  ["2", "PASIVA"],
  ["2.1", "KEWAJIBAN JANGKA PENDEK"],
  ["2.1.1", "HUTANG DAGANG"],
  ["2.1.2", "HUTANG PAJAK"],
  ["2.1.3", "HUTANG BIAYA"],
  ["2.1.4", "PENDAPATAN DITERIMA DIMUKA"],
  ["2.1.5", "HUTANG LAIN LAIN"],
  ["2.2", "KEWAJIBAN JANGKA PANJANG"],
  ["2.2.1", "HUTANG JANGKA PANJANG"],
  ["3", "EKUITAS"],
  ["3.1", "MODAL"],
  ["3.1.1", "MODAL AWAL"],
  ["3.2", "REVALUASI AKTIVA TETAP"],
  ["3.2.1", "REVALUASI AKTIVA TETAP"],
  ["3.3", "LABA/RUGI TAHUN SEBELUMNYA"],
  ["3.3.1", "LABA/RUGI TAHUN SEBELUMNYA"],
  ["3.4", "LABA/RUGI TAHUN BERJALAN"],
  ["3.4.1", "LABA/RUGI TAHUN BERJALAN"],
  ["3.5", "L/R ATAS INVESTASI"],
  ["3.5.1", "L/R ATAS INVESTASI"],
  ["4", "PENDAPATAN"],
  ["4.1", "PENDAPATAN DARI USAHA"],
  ["4.1.1", "PENDAPATAN DARI USAHA"],
  ["4.1.8", "PENGURANG HASIL PENJUALAN"],
  ["4.9", "PENDAPATAN DILUAR USAHA"],
  ["4.9.1", "PENDAPATAN DILUAR USAHA"],
  ["5", "BIAYA"],
  ["5.1", "HARGA POKOK PENJUALAN"],
  ["5.1.1", "HARGA POKOK PENJUALAN"],
  ["5.1.9", "HARGA POKOK PENJUALAN WASTE"],
  ["5.2", "BIAYA PENJUALAN"],
  ["5.2.1", "BIAYA PENJUALAN"],
  ["5.3", "BIAYA UMUM DAN ADMINISTRASI"],
  ["5.3.1", "BIAYA UMUM"],
  ["5.3.2", "BIAYA PAJAK"],
  ["5.9", "BIAYA DILUAR USAHA"],
  ["5.9.1", "BIAYA DILUAR USAHA"],
];

/**
 * Which statement each Account Type belongs to.
 *
 * Keyed on the type's code, which is also its label, because that is what the
 * migration backfills on and what a reader of the chart already knows. Neraca
 * is carried forward from one fiscal year into the next; Laba Rugi is closed
 * out into Laba/Rugi Tahun Sebelumnya and starts the new year at nil.
 *
 * Declared here rather than derived from the code's first segment on purpose:
 * the derivation would work today and would break silently the first time
 * somebody added a type. Re-synced on every run, because nothing in the
 * application can change it — the section of a type is not a judgement call,
 * so code is its source of truth in the same sense the permission catalogue is.
 */
const ACCOUNT_TYPE_SECTIONS: Record<string, "BalanceSheet" | "ProfitLoss"> = {
  "1": "BalanceSheet", // AKTIVA
  "2": "BalanceSheet", // PASIVA
  "3": "BalanceSheet", // EKUITAS
  "4": "ProfitLoss", //  PENDAPATAN
  "5": "ProfitLoss", //  BIAYA
};

/**
 * Which step of the multi-step Laba Rugi each Laba Rugi category sits in.
 *
 * Keyed on the category's code, like `ACCOUNT_TYPE_SECTIONS`, and declared for
 * the same reason: `5.1` being Harga Pokok Penjualan is how Sheet1 is laid out,
 * not something the application may infer from a number. Every category under
 * a ProfitLoss type appears here and no Neraca category does — which
 * `tests/accounting.test.ts` asserts against the database. Re-synced on every
 * run, because nothing in the application can write it.
 *
 * `5.3.2 BIAYA PAJAK` sits inside Biaya Umum dan Administrasi, so it is an
 * operating expense: the template has no income-tax category, and therefore
 * the statement has no "Laba Sebelum Pajak" step.
 */
const ACCOUNT_CATEGORY_PL_GROUPS: Record<
  string,
  "OperatingRevenue" | "CostOfSales" | "OperatingExpense" | "OtherIncome" | "OtherExpense"
> = {
  "4.1": "OperatingRevenue", // PENDAPATAN DARI USAHA
  "4.9": "OtherIncome", //      PENDAPATAN DILUAR USAHA
  "5.1": "CostOfSales", //      HARGA POKOK PENJUALAN
  "5.2": "OperatingExpense", // BIAYA PENJUALAN
  "5.3": "OperatingExpense", // BIAYA UMUM DAN ADMINISTRASI
  "5.9": "OtherExpense", //     BIAYA DILUAR USAHA
};

/**
 * Which side each Account Type's own total reads positive on.
 *
 * The Neraca signs every row beneath a type by this rather than by the
 * account's own normal balance, which is what prints Akumulasi Penyusutan — a
 * Kredit account inside AKTIVA — as the deduction it is. Declared rather than
 * inferred from the code for the reason `ACCOUNT_TYPE_SECTIONS` is, and
 * re-synced on every run for the same reason.
 */
const ACCOUNT_TYPE_NORMAL_BALANCE: Record<string, "Debit" | "Kredit"> = {
  "1": "Debit", //  AKTIVA
  "2": "Kredit", // PASIVA
  "3": "Kredit", // EKUITAS
  "4": "Kredit", // PENDAPATAN
  "5": "Debit", //  BIAYA
};

/** The skeleton rows at one depth, in the order the sheet lists them. */
const skeletonLevel = (depth: number) =>
  COA_SKELETON.filter(([c]) => c.split(".").length === depth);


// --------------------------------------------------------------------- run

async function main() {
  const system = await systemUser();
  const audit = { created_by: system, updated_by: null };

  await bootstrapAdministrator();
  await syncPermissionCatalogue();
  await syncRoles(system);
  await ensureReferenceData(audit);
  await ensureStarterReferences(audit);

  report();
}

/**
 * The account every seeded row is attributed to. Seeded Inactive so it can
 * never be signed in as — it exists to be referenced, not used.
 */
async function systemUser(): Promise<number> {
  const existing = await prisma.sysUser.findUnique({
    where: { email: "sistem@erp.app" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const user = await prisma.sysUser.create({
    data: {
      user_code: await nextUserCode(),
      email: "sistem@erp.app",
      name: "Sistem",
      initials: "SY",
      // Unusable by construction: bcrypt never produces this string, so no
      // password can ever verify against it.
      password_hash: "-",
      status: "Inactive",
    },
    select: { id: true },
  });
  tally("system account");
  return user.id;
}

async function nextUserCode(): Promise<string> {
  const count = await prisma.sysUser.count();
  return code("user", count + 1);
}

/**
 * Creates the administrator if the application has none.
 *
 * An existing account is never touched: re-seeding must not reset a password or
 * reactivate an account somebody deliberately disabled.
 */
async function bootstrapAdministrator(): Promise<void> {
  const password_hash = await hash(resolveAdminPassword(), 10);

  const people = [
    { email: ADMIN_EMAIL, name: ADMIN_NAME, initials: ADMIN_INITIALS, tallyAs: "administrator" },
  ];

  for (const person of people) {
    const existing = await prisma.sysUser.findUnique({
      where: { email: person.email },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.sysUser.create({
      data: {
        user_code: await nextUserCode(),
        email: person.email,
        name: person.name,
        initials: person.initials,
        password_hash,
      },
    });
    tally(person.tallyAs);
  }
}

/**
 * `src/lib/erp/permissions.ts` is the source of truth; this table is its
 * materialisation. Names and descriptions are re-synced so the role matrix
 * reads current copy, and a permission dropped from the catalogue is removed
 * along with every grant of it — a row no code reads is a row that can only
 * mislead.
 */
async function syncPermissionCatalogue(): Promise<void> {
  const existing = await prisma.sysPermission.findMany({
    select: { id: true, permission_code: true },
  });
  const byCode = new Map(existing.map((p) => [p.permission_code, p.id]));

  let added = 0;
  for (const p of PERMISSIONS) {
    const description = "description" in p ? p.description : null;
    if (byCode.has(p.code)) {
      await prisma.sysPermission.update({
        where: { permission_code: p.code },
        data: { permission_name: p.name, module: p.module, description },
      });
    } else {
      await prisma.sysPermission.create({
        data: {
          permission_code: p.code,
          permission_name: p.name,
          module: p.module,
          description,
        },
      });
      added += 1;
    }
  }
  tally("permissions", added);

  const live = new Set<string>(PERMISSIONS.map((p) => p.code));
  const stale = existing.filter((p) => !live.has(p.permission_code));
  if (stale.length) {
    const ids = stale.map((p) => p.id);
    await prisma.sysRolePermission.deleteMany({ where: { permission_id: { in: ids } } });
    await prisma.sysPermission.deleteMany({ where: { id: { in: ids } } });
    console.log(`  Removed ${stale.length} permission(s) no longer in the catalogue.`);
  }
}

/**
 * Seeded roles are created once and then belong to whoever administers the
 * system — except ADMIN's grant, which is frozen at the whole catalogue and
 * re-synced on every run so it keeps up as capabilities are added. That is what
 * guarantees the application always has a way to administer itself.
 */
async function syncRoles(system: number): Promise<void> {
  const permissionId = new Map(
    (await prisma.sysPermission.findMany({ select: { id: true, permission_code: true } })).map(
      (p) => [p.permission_code, p.id]
    )
  );

  for (const role of SEEDED_ROLES) {
    let row = await prisma.sysRole.findUnique({
      where: { role_label: role.label },
      select: { id: true },
    });
    if (!row) {
      row = await prisma.sysRole.create({
        data: {
          role_code: code("role", (await prisma.sysRole.count()) + 1),
          role_label: role.label,
          role_name: role.name,
          note: role.note,
          is_system: true,
          created_by: system,
        },
        select: { id: true },
      });
      tally("roles");

      // A custom role starts empty; only ADMIN is granted anything on creation.
      for (const c of role.permissions ?? []) {
        await prisma.sysRolePermission.create({
          data: { role_id: row.id, permission_id: permissionId.get(c)!, created_by: system },
        });
      }
    }

    if (role.label !== ADMIN_ROLE) continue;

    const held = new Set(
      (
        await prisma.sysRolePermission.findMany({
          where: { role_id: row.id },
          select: { permission_id: true },
        })
      ).map((g) => g.permission_id)
    );
    const wanted = adminPermissionCodes().map((c) => permissionId.get(c)!);
    const missing = wanted.filter((id) => !held.has(id));
    if (missing.length) {
      await prisma.sysRolePermission.createMany({
        data: missing.map((permission_id) => ({
          role_id: row!.id,
          permission_id,
          created_by: system,
        })),
      });
      tally("administrator grants", missing.length);
    }
  }

  // The seeded administrator holds the ADMIN role. Re-checked each run so a
  // fresh catalogue entry cannot leave the system unadministrable.
  const adminRole = await prisma.sysRole.findUnique({
    where: { role_label: ADMIN_ROLE },
    select: { id: true },
  });
  if (adminRole) {
    for (const email of [ADMIN_EMAIL]) {
      const user = await prisma.sysUser.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!user) continue;

      const assigned = await prisma.sysUserRole.findUnique({
        where: { user_id_role_id: { user_id: user.id, role_id: adminRole.id } },
        select: { id: true },
      });
      if (!assigned) {
        await prisma.sysUserRole.create({
          data: { user_id: user.id, role_id: adminRole.id, created_by: system },
        });
        tally("administrator role assignment");
      }
    }
  }
}

async function ensureReferenceData(
  audit: { created_by: number; updated_by: null }
): Promise<void> {
  for (const [i, [label, name]] of skeletonLevel(1).entries()) {
    const section = ACCOUNT_TYPE_SECTIONS[label] ?? "BalanceSheet";
    const normalBalance = ACCOUNT_TYPE_NORMAL_BALANCE[label] ?? "Debit";
    const made = await create(
      () => prisma.sysAccountType.findUnique({ where: { type_label: label } }),
      () =>
        prisma.sysAccountType.create({
          data: {
            type_code: code("atyp", i + 1),
            type_label: label,
            type_name: name,
            section,
            normal_balance: normalBalance,
            ...audit,
          },
        })
    );
    tally("account types", made);

    // Nothing in the application writes this column, so a row disagreeing with
    // the declaration above was changed outside it. Corrected rather than left,
    // because closing reads it to decide which accounts are zeroed.
    if (!made) {
      const fixed = await prisma.sysAccountType.updateMany({
        where: { type_label: label, section: { not: section } },
        data: { section },
      });
      if (fixed.count) tally("account type sections corrected", fixed.count);
      const sided = await prisma.sysAccountType.updateMany({
        where: { type_label: label, normal_balance: { not: normalBalance } },
        data: { normal_balance: normalBalance },
      });
      if (sided.count) tally("account type sides corrected", sided.count);
    }
  }

  for (const [i, [label, table]] of DOC_TYPES.entries()) {
    const made = await create(
      // Matched on the label or the table: a document type renamed in the UI
      // (Faktur Penjualan → Invoice Penjualan, P99) keeps its row.
      () => prisma.sysDocType.findFirst({ where: { OR: [{ doc_label: label }, { doc_table: table }] } }),
      () =>
        prisma.sysDocType.create({
          data: {
            doc_code: code("dtyp", i + 1),
            doc_label: label,
            doc_name: label,
            doc_table: table,
            ...audit,
          },
        })
    );
    tally("document types", made);
  }

  for (const [i, [label, name, note, status]] of PARTNER_CATEGORIES.entries()) {
    const made = await create(
      () => prisma.sysPartnerCategory.findFirst({ where: { category_label: label } }),
      () =>
        prisma.sysPartnerCategory.create({
          data: {
            category_code: code("pcat", i + 1),
            category_label: label,
            category_name: name,
            note,
            status,
            ...audit,
          },
        })
    );
    tally("partner categories", made);
  }

  await ensureRegions();

  for (const [i, [label, name, issuable]] of STOCK_STATUSES.entries()) {
    const made = await create(
      () => prisma.sysStockStatus.findUnique({ where: { status_code: code("stst", i + 1) } }),
      () =>
        prisma.sysStockStatus.create({
          data: { status_code: code("stst", i + 1), status_label: label, status_name: name, is_issuable: issuable, sort_order: i + 1, ...audit },
        })
    );
    tally("stock statuses", made);
  }

  for (const [i, [label, name, itemType]] of ITEM_CATEGORIES.entries()) {
    const made = await create(
      () => prisma.sysItemCategory.findUnique({ where: { category_label: label } }),
      () =>
        prisma.sysItemCategory.create({
          data: {
            category_code: code("icat", i + 1),
            category_label: label,
            category_name: name,
            item_type: itemType,
            ...audit,
          },
        })
    );
    tally("item categories", made);
  }

  // The common withholding taxes a customer applies to what it pays (P44).
  // Matched on the system code, which never changes, so a user's edits to the
  // label, name, rate or objek stay theirs and a re-seed adds nothing twice.
  for (const [i, [label, name, rate, taxObject]] of WITHHOLDING_TAXES.entries()) {
    const made = await create(
      () => prisma.refWithholdingTax.findUnique({ where: { wht_code: code("wht", i + 1) } }),
      () =>
        prisma.refWithholdingTax.create({
          data: {
            wht_code: code("wht", i + 1),
            wht_label: label,
            wht_name: name,
            rate,
            tax_object: taxObject,
            ...audit,
          },
        })
    );
    tally("withholding taxes (Jenis PPh)", made);
  }

  // The PPN rate and the DPP Nilai Lain factor (P60, PMK 131/2024: 12 % on
  // 11/12). Set once, when a key has never been set; after that they are the
  // user's, changed when the law changes.
  for (const [key, value] of [
    ["ppn_rate", "12"],
    ["ppn_dpp_other_numerator", "11"],
    ["ppn_dpp_other_denominator", "12"],
    // Purchasing (P121): a supplier's total may differ from the invoice by Rp 100.
    ["supplier_invoice_tolerance", "100"],
  ] as const) {
    const set = await create(
      () => prisma.sysSetting.findUnique({ where: { setting_key: key } }),
      () => prisma.sysSetting.create({ data: { setting_key: key, setting_value: value } })
    );
    tally(`system default: ${key}`, set);
  }


  const typeId = new Map(
    (await prisma.sysAccountType.findMany({ select: { id: true, type_label: true } })).map((t) => [
      t.type_label,
      t.id,
    ])
  );

  // A category hangs off the type its own code names: `1.1` belongs to `1`.
  // Nothing has to be stated twice, and the skeleton cannot contradict itself.
  for (const [i, [label, name]] of skeletonLevel(2).entries()) {
    const plGroup = ACCOUNT_CATEGORY_PL_GROUPS[label] ?? null;
    const made = await create(
      () => prisma.accAccountCategory.findFirst({ where: { category_label: label } }),
      () =>
        prisma.accAccountCategory.create({
          data: {
            account_type_id: typeId.get(parentCode(label)!)!,
            category_code: code("acat", i + 1),
            category_label: label,
            category_name: name,
            pl_group: plGroup,
            ...audit,
          },
        })
    );
    tally("account categories", made);

    // Same reasoning as the type's section: nothing in the application writes
    // this, so a disagreeing row was changed outside it, and the Laba Rugi
    // reads it to decide which subtotal an account falls under.
    if (!made) {
      const fixed = await prisma.accAccountCategory.updateMany({
        // `<> X` never matches a null in SQL, so a missing step is asked for
        // separately from a wrong one.
        where: plGroup
          ? { category_label: label, OR: [{ pl_group: null }, { pl_group: { not: plGroup } }] }
          : { category_label: label, pl_group: { not: null } },
        data: { pl_group: plGroup },
      });
      if (fixed.count) tally("account category Laba Rugi steps corrected", fixed.count);
    }
  }

  const categoryId = new Map(
    (
      await prisma.accAccountCategory.findMany({ select: { id: true, category_label: true } })
    ).map((c) => [c.category_label, c.id])
  );

  for (const [i, [label, name]] of skeletonLevel(3).entries()) {
    const made = await create(
      () =>
        prisma.accAccountSubcategory.findFirst({
          where: { subcategory_label: label },
        }),
      () =>
        prisma.accAccountSubcategory.create({
          data: {
            account_category_id: categoryId.get(parentCode(label)!)!,
            subcategory_code: code("asub", i + 1),
            subcategory_label: label,
            subcategory_name: name,
            ...audit,
          },
        })
    );
    tally("account subcategories", made);
  }

  // The reporting base currency, so a first install can register a Cash & Bank
  // resource without setting up a master first. Every other
  // currency is created through the application.
  const made = await create(
    () => prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL } }),
    () =>
      prisma.refCurrency.create({
        data: {
          currency_code: code("curr", 1),
          currency_label: BASE_CURRENCY_LABEL,
          currency_name: BASE_CURRENCY_NAME,
          note: "Base currency pelaporan.",
          ...audit,
        },
      })
  );
  tally("base currency", made);
}

/**
 * Indonesia's administrative regions and each kelurahan's kode pos, from
 * `prisma/data/region.tsv.gz` (sources and licence in the file's header and in
 * `prisma/data/region.LICENSE`).
 *
 * Matched on the Kemendagri code, level by level, parents first. A missing row
 * is created; a row whose name or kode pos differs from the file is updated, so
 * a newer edition of the file brings an existing installation up to date. A
 * region is never deleted — an address may point at it.
 *
 * ~91.000 rows, so rows are written in batches and an installation already in
 * step costs one read per level.
 */
async function ensureRegions(): Promise<void> {
  const file = path.join(__dirname, "data", "region.tsv.gz");
  const lines = gunzipSync(readFileSync(file)).toString("utf8").split("\n");

  // code -> [name, postal]; level = number of dots.
  const byLevel: Map<string, [string, string]>[] = [new Map(), new Map(), new Map(), new Map()];
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const [regionCode, name, postal = ""] = line.split("\t");
    byLevel[regionCode.split(".").length - 1]?.set(regionCode, [name, postal]);
  }
  const parent = (c: string) => c.slice(0, c.lastIndexOf("."));

  type Level = {
    what: string;
    read: () => Promise<{ id: number; code: string; name: string; postal_code?: string | null }[]>;
    createMany: (rows: Record<string, unknown>[]) => Promise<unknown>;
    update: (id: number, data: Record<string, unknown>) => Promise<unknown>;
    parentKey?: string;
  };
  const levels: Level[] = [
    {
      what: "region provinces",
      read: () => prisma.sysRegionProvince.findMany(),
      createMany: (data) => prisma.sysRegionProvince.createMany({ data: data as never, skipDuplicates: true }),
      update: (id, data) => prisma.sysRegionProvince.update({ where: { id }, data }),
    },
    {
      what: "region cities",
      read: () => prisma.sysRegionCity.findMany(),
      createMany: (data) => prisma.sysRegionCity.createMany({ data: data as never, skipDuplicates: true }),
      update: (id, data) => prisma.sysRegionCity.update({ where: { id }, data }),
      parentKey: "province_id",
    },
    {
      what: "region districts",
      read: () => prisma.sysRegionDistrict.findMany(),
      createMany: (data) => prisma.sysRegionDistrict.createMany({ data: data as never, skipDuplicates: true }),
      update: (id, data) => prisma.sysRegionDistrict.update({ where: { id }, data }),
      parentKey: "city_id",
    },
    {
      what: "region villages",
      read: () => prisma.sysRegionVillage.findMany(),
      createMany: (data) => prisma.sysRegionVillage.createMany({ data: data as never, skipDuplicates: true }),
      update: (id, data) => prisma.sysRegionVillage.update({ where: { id }, data }),
      parentKey: "district_id",
    },
  ];

  let parentIds = new Map<string, number>();
  for (const [depth, level] of levels.entries()) {
    const wanted = byLevel[depth];
    const isVillage = depth === 3;
    const existing = new Map((await level.read()).map((r) => [r.code, r]));

    const missing: Record<string, unknown>[] = [];
    let updated = 0;
    for (const [regionCode, [name, postal]] of wanted) {
      const row = existing.get(regionCode);
      if (!row) {
        missing.push({
          code: regionCode,
          name,
          ...(level.parentKey ? { [level.parentKey]: parentIds.get(parent(regionCode)) } : {}),
          ...(isVillage ? { postal_code: postal || null } : {}),
        });
        continue;
      }
      const postalChanged = isVillage && (row.postal_code ?? "") !== postal;
      if (row.name !== name || postalChanged) {
        await level.update(row.id, {
          name,
          ...(isVillage ? { postal_code: postal || null } : {}),
        });
        updated++;
      }
    }

    for (let i = 0; i < missing.length; i += 5000) {
      await level.createMany(missing.slice(i, i + 5000));
    }
    if (missing.length) tally(level.what, missing.length);
    if (updated) tally(`${level.what} updated`, updated);

    parentIds = new Map((await level.read()).map((r) => [r.code, r.id]));
  }
}

/**
 * Starter rows for the reference masters a user needs on day one (P62): a
 * second currency, the common units of measure and the standard payment
 * terms. They are user data from then on — edited, deactivated or added to
 * through the application.
 *
 * Matched on the **label**, case-insensitively, and created only when no row
 * carries it, with the next free system code. So an installation that already
 * made its own `KG` keeps it and gets no second one, and nothing is ever
 * overwritten. (A starter row renamed by the user comes back under its
 * original label on the next seed; deactivate it instead of renaming it.)
 */
const STARTER_CURRENCIES: [label: string, name: string][] = [["USD", "Dolar Amerika Serikat"]];

const STARTER_UOMS: [label: string, name: string][] = [
  ["PCS", "Pcs"],
  ["UNIT", "Unit"],
  ["SET", "Set"],
  ["PAK", "Pak"],
  ["BOX", "Box"],
  ["LSN", "Lusin"],
  ["KRT", "Karton"],
  ["BTL", "Botol"],
  ["GR", "Gram"],
  ["KG", "Kilogram"],
  ["ML", "Mililiter"],
  ["L", "Liter"],
];

const STARTER_TERMS: [label: string, name: string, days: number][] = [
  ["TUNAI", "Tunai", 0],
  ["NET7", "Net 7 hari", 7],
  ["NET14", "Net 14 hari", 14],
  ["NET30", "Net 30 hari", 30],
  ["NET45", "Net 45 hari", 45],
  ["NET60", "Net 60 hari", 60],
];

/**
 * The Jenis PPh the company withholds from suppliers (P122): a purchase
 * Jenis PPh is its own record, never the sales one, because it posts to a
 * liability rather than a prepaid asset. Matched on its label like the other
 * starters; no account, which the user picks.
 */
const STARTER_PURCHASE_WHT: [label: string, name: string, rate: number, taxObject: string][] = [
  [
    "PPH23-BELI",
    "PPh Pasal 23 — Jasa dan Sewa (dipotong perusahaan)",
    2,
    "Imbalan jasa dan sewa yang dibayar perusahaan kepada supplier, selain sewa tanah dan/atau bangunan.",
  ],
];

/** The next `<prefix>.NNNN` after the highest code already in `codes`. */
function nextCodeAfter(prefix: string, codes: string[]): string {
  let max = 0;
  for (const c of codes) {
    const n = Number(c.split(".")[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return code(prefix, max + 1);
}

async function ensureStarterReferences(audit: { created_by: number; updated_by: null }): Promise<void> {
  for (const [label, name] of STARTER_CURRENCIES) {
    if (await prisma.refCurrency.findFirst({ where: { currency_label: { equals: label, mode: "insensitive" } } })) continue;
    const codes = (await prisma.refCurrency.findMany({ select: { currency_code: true } })).map((r) => r.currency_code);
    await prisma.refCurrency.create({
      data: { currency_code: nextCodeAfter("curr", codes), currency_label: label, currency_name: name, ...audit },
    });
    tally("currencies", 1);
  }

  for (const [label, name] of STARTER_UOMS) {
    if (await prisma.refUom.findFirst({ where: { uom_label: { equals: label, mode: "insensitive" } } })) continue;
    const codes = (await prisma.refUom.findMany({ select: { uom_code: true } })).map((r) => r.uom_code);
    await prisma.refUom.create({
      data: { uom_code: nextCodeAfter("uom", codes), uom_label: label, uom_name: name, ...audit },
    });
    tally("satuan", 1);
  }

  for (const [label, name, days] of STARTER_TERMS) {
    if (await prisma.refPaymentTerm.findFirst({ where: { term_label: { equals: label, mode: "insensitive" } } })) continue;
    const codes = (await prisma.refPaymentTerm.findMany({ select: { term_code: true } })).map((r) => r.term_code);
    await prisma.refPaymentTerm.create({
      data: { term_code: nextCodeAfter("term", codes), term_label: label, term_name: name, due_days: days, ...audit },
    });
    tally("termin pembayaran", 1);
  }

  for (const [label, name, rate, taxObject] of STARTER_PURCHASE_WHT) {
    if (await prisma.refWithholdingTax.findFirst({ where: { wht_label: { equals: label, mode: "insensitive" } } })) continue;
    const codes = (await prisma.refWithholdingTax.findMany({ select: { wht_code: true } })).map((r) => r.wht_code);
    await prisma.refWithholdingTax.create({
      data: { wht_code: nextCodeAfter("wht", codes), wht_label: label, wht_name: name, rate, tax_object: taxObject, usage: "Purchase", ...audit },
    });
    tally("withholding taxes (Jenis PPh pembelian)", 1);
  }
}

/** Creates the row when the lookup finds nothing. Returns 1 if it created one. */
async function create<T>(find: () => Promise<T | null>, make: () => Promise<T>): Promise<number> {
  if (await find()) return 0;
  await make();
  return 1;
}

function report(): void {
  const entries = Object.entries(created);
  if (entries.length) {
    console.log("Created:");
    for (const [what, n] of entries) console.log(`  ${String(n).padStart(5)}  ${what}`);
  } else {
    console.log("Nothing to create — system data is already up to date.");
  }

  console.log(`\nAdministrator : ${ADMIN_EMAIL}`);
  if (!process.env.ERP_ADMIN_PASSWORD) {
    console.log(`Password      : ${DEV_PASSWORD}   <-- DEVELOPMENT ONLY`);
    console.log("                Set ERP_ADMIN_PASSWORD before seeding anywhere real.");
  }
  console.log(
    "\nBusiness data — partners, cash & bank, accounts, fiscal periods, documents —\n" +
      "is created through the application, not by this seed."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
