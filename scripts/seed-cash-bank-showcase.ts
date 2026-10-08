/**
 * Development showcase data for the Cash & Bank reports (Buku Kas & Bank,
 * Saldo Kas & Bank): more resources in rupiah and dollars, and three months of
 * movements through them.
 *
 * **Development only**, like `seed-showcase.ts`, which must have run first
 * (accounts, the fiscal year, the two rupiah banks). Run locally with
 * `npm run db:seed-cash-bank-showcase`, or against Neon with
 * `npm run db:neon-seed-cash-bank-showcase`.
 *
 * What it creates:
 *   six resources — Kas Kecil, Kas Besar, Bank BNI (IDR) and Bank BCA USD,
 *   Bank Mandiri USD, Kas Valas USD — each with its own Cash & Bank account
 *   and a Saldo Awal dated 01/07/2026 (an `Opening` entry, no journal, as the
 *   registration form writes it)
 *   about three months of movements over those six and BCA / MANDIRI:
 *   setoran modal, pendapatan lain-lain, beban, biaya bank, transfers between
 *   resources, buying and selling dollars (with Laba/Rugi Selisih Kurs), and a
 *   few `Adjustment` entries for cash differences
 *
 * **Every movement keeps the books together**: each is one posted journal
 * (`postJournal`) and its Cash Bank Book entries (`recordCashBankEntry`) in one
 * transaction, the entries naming the journal as their source, so `db:reconcile`
 * still finds each resource's book equal to its GL account. Money leaving a
 * dollar resource is released at its moving average (P37), and the journal's
 * bank line takes exactly the base the book released.
 *
 * **Runs once.** If Kas Kecil already exists the movements are skipped; the
 * resources are matched on their label and never created twice. The amounts
 * are deterministic (a seeded generator), so two fresh databases get the same
 * book.
 */
import { prisma } from "../src/lib/prisma";
import { ENTITIES } from "../src/lib/erp/entities";
import { CASH_BANK_SUBCATEGORY, nextCode } from "../src/lib/erp/records";
import { openCashBankBook, recordCashBankEntry } from "../src/lib/erp/cash-bank";
import { postJournal, type JournalLineInput } from "../src/lib/erp/journal";
import { relieve, roundBase } from "../src/lib/erp/fx";
import { BASE_CURRENCY_LABEL } from "../src/lib/erp/currency";
import { nextAccountLabel } from "./lib/starter-accounts";

// ------------------------------------------------------------------- data

type Resource = {
  label: string;
  name: string;
  type: "Cash" | "Bank";
  currency: "IDR" | "USD";
  account: string;
  opening: number;
  openingRate: number;
};

const OPENING_DATE = "2026-07-01";

const RESOURCES: Resource[] = [
  { label: "KAS-KECIL", name: "Kas Kecil Kantor", type: "Cash", currency: "IDR", account: "Kas Kecil Kantor", opening: 5_000_000, openingRate: 1 },
  { label: "KAS-BESAR", name: "Kas Besar", type: "Cash", currency: "IDR", account: "Kas Besar", opening: 35_000_000, openingRate: 1 },
  { label: "BNI", name: "Bank BNI · 0123-456-789", type: "Bank", currency: "IDR", account: "Bank BNI", opening: 185_000_000, openingRate: 1 },
  { label: "BCA-USD", name: "Bank BCA USD · 123-888-9999", type: "Bank", currency: "USD", account: "Bank BCA USD", opening: 12_500, openingRate: 15_950 },
  { label: "MANDIRI-USD", name: "Bank Mandiri USD · 070-00-7654321-0", type: "Bank", currency: "USD", account: "Bank Mandiri USD", opening: 8_000, openingRate: 16_050 },
  { label: "KAS-USD", name: "Kas Valas USD", type: "Cash", currency: "USD", account: "Kas Valas USD", opening: 1_500, openingRate: 16_000 },
];

/** Rupiah per dollar, by month — the day's rate jitters around it. */
const USD_RATE: Record<string, number> = { "07": 16_240, "08": 16_380, "09": 16_420, "10": 16_510 };

const MONTHS = ["07", "08", "09", "10"];
/** The last day each month gets movements — October stops before today. */
const LAST_DAY: Record<string, number> = { "07": 31, "08": 31, "09": 30, "10": 7 };

// ---------------------------------------------------------------- helpers

const entity = (key: string) => {
  const e = ENTITIES.find((x) => x.key === key);
  if (!e) throw new Error(`Registry entity ${key} not found`);
  return e;
};

/** mulberry32 — deterministic, so every run of a fresh database matches. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261008);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
/** A rupiah figure rounded to a step, as people type them. */
const idr = (lo: number, hi: number, step = 50_000) => Math.round(between(lo, hi) / step) * step;
const usd = (lo: number, hi: number, step = 10) => Math.round(between(lo, hi) / step) * step;
const rateOn = (date: string) => Math.round(USD_RATE[date.slice(5, 7)] + between(-60, 60));

let actor = 0;
let journalDocType = 0;
let idrId = 0;
let usdId = 0;
const resourceId = new Map<string, number>();
const accountOf = new Map<string, number>();
const currencyOf = new Map<string, "IDR" | "USD">();
const acc = new Map<string, number>();

// ------------------------------------------------------------ one movement

type Leg = { res: string; dir: "In" | "Out"; amount: number; rate?: number };
type Counter = { account: string; side: "debit" | "credit"; amount?: number; description: string };

/**
 * One journal and its book entries, in one transaction.
 *
 * What a dollar leaving releases is worked out from the pool first (`relieve`,
 * the book's own rule), so the journal can be posted before the book and the
 * entries can name it as their source — the legs of one movement then share
 * one ledger number (P110). The counter lines are rupiah; one without an
 * amount takes whatever balances the journal, and a difference left over (a
 * currency exchange) goes to Laba/Rugi Selisih Kurs.
 */
async function move(
  date: string,
  description: string,
  legs: Leg[],
  counters: Counter[],
  entryType: "Transaction" | "Adjustment" = "Transaction"
): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      const lines: JournalLineInput[] = [];
      const bases: number[] = [];
      for (const leg of legs) {
        const cashBankId = resourceId.get(leg.res)!;
        const foreign = currencyOf.get(leg.res) === "USD";
        let base: number;
        let rate: number;
        if (leg.dir === "In") {
          rate = foreign ? leg.rate! : 1;
          base = roundBase(leg.amount * rate);
        } else {
          const b = await tx.cashBankBalance.findUniqueOrThrow({ where: { cash_bank_id: cashBankId } });
          const pool = { foreign: b.balance.toNumber(), base: b.base_balance.toNumber() };
          if (leg.amount > pool.foreign) throw new SkipMovement();
          base = relieve(pool, leg.amount).base;
          rate = foreign ? Math.round((pool.base / pool.foreign) * 1_000_000) / 1_000_000 : 1;
        }
        bases.push(base);
        lines.push({
          accountId: accountOf.get(leg.res)!,
          currencyId: foreign ? usdId : idrId,
          rate,
          debit: leg.dir === "In" ? leg.amount : 0,
          credit: leg.dir === "Out" ? leg.amount : 0,
          baseAmount: base,
          description,
        });
      }

      const net = () => roundBase(lines.reduce((s, l) => s + (l.debit > 0 ? l.baseAmount! : -l.baseAmount!), 0));
      for (const c of counters) {
        const amount = c.amount ?? Math.abs(net());
        if (amount <= 0) continue;
        lines.push({
          accountId: acc.get(c.account)!,
          currencyId: idrId,
          rate: 1,
          debit: c.side === "debit" ? amount : 0,
          credit: c.side === "credit" ? amount : 0,
          baseAmount: amount,
          description: c.description,
        });
      }
      const diff = net();
      if (diff !== 0) {
        lines.push({
          accountId: acc.get("Laba/Rugi Selisih Kurs")!,
          currencyId: idrId,
          rate: 1,
          debit: diff < 0 ? -diff : 0,
          credit: diff > 0 ? diff : 0,
          baseAmount: Math.abs(diff),
          description: diff > 0 ? "Laba selisih kurs" : "Rugi selisih kurs",
        });
      }

      const journal = await postJournal(tx, {
        description,
        lines,
        actorId: actor,
        postingDate: new Date(`${date}T00:00:00Z`),
      });

      // The book entries name the journal they stand behind and carry its
      // number in the note — the book report resolves no number itself (§17).
      const note = `${journal.journalNo} · ${description}`;
      for (const [i, leg] of legs.entries()) {
        const common = { cashBankId: resourceId.get(leg.res)!, date, type: entryType, amount: leg.amount, sourceDocTypeId: journalDocType, sourceDocId: journal.id, note, actorId: actor };
        const entry =
          leg.dir === "In"
            ? await recordCashBankEntry(tx, { ...common, direction: "In", rate: currencyOf.get(leg.res) === "USD" ? leg.rate! : 1 })
            : await recordCashBankEntry(tx, { ...common, direction: "Out" });
        if (entry.base_amount.toNumber() !== bases[i]) {
          throw new Error(`Book released ${entry.base_amount} for ${leg.res}, journal took ${bases[i]}.`);
        }
      }
    });
    return true;
  } catch (e) {
    if (e instanceof SkipMovement) return false;
    throw e;
  }
}

/** A movement the resource cannot afford at that point; left out, not forced. */
class SkipMovement extends Error {}

// ---------------------------------------------------------------- the plan

function day(m: string, d: number) {
  return `2026-${m}-${String(Math.min(d, LAST_DAY[m])).padStart(2, "0")}`;
}

async function movements() {
  // Planned first, posted in date order: a resource is then never asked for
  // money it only receives later in the month.
  const plan: Parameters<typeof move>[] = [];
  const run = async (...args: Parameters<typeof move>) => {
    plan.push(args);
  };

  for (const m of MONTHS) {
    const monthName = { "07": "Juli", "08": "Agustus", "09": "September", "10": "Oktober" }[m]!;
    const last = LAST_DAY[m];

    // Capital and financing, start of the quarter
    if (m === "07") {
      await run(day(m, 2), "Setoran modal pemegang saham", [{ res: "BCA", dir: "In", amount: 500_000_000 }], [{ account: "Modal Disetor", side: "credit", description: "Setoran modal" }]);
      await run(day(m, 2), "Setoran modal pemegang saham", [{ res: "MANDIRI", dir: "In", amount: 250_000_000 }], [{ account: "Modal Disetor", side: "credit", description: "Setoran modal" }]);
    }

    // Kas Besar fed from BCA, Kas Kecil fed from Kas Besar
    await run(day(m, 1), `Pengisian Kas Besar ${monthName}`, [{ res: "BCA", dir: "Out", amount: 40_000_000 }, { res: "KAS-BESAR", dir: "In", amount: 40_000_000 }], []);
    for (const d of [3, 17]) {
      if (d > last) continue;
      await run(day(m, d), "Pengisian kembali Kas Kecil", [{ res: "KAS-BESAR", dir: "Out", amount: 7_500_000 }, { res: "KAS-KECIL", dir: "In", amount: 7_500_000 }], []);
    }

    // Petty cash spending
    const petty: [string, string, number, number][] = [
      ["Beban Umum & Administrasi", "Pembelian ATK dan materai", 150_000, 900_000],
      ["Beban Umum & Administrasi", "Konsumsi rapat", 200_000, 750_000],
      ["Beban Pengiriman", "Ongkos kurir dokumen", 50_000, 400_000],
      ["Beban Pemeliharaan", "Perbaikan AC kantor", 350_000, 1_500_000],
      ["Beban Umum & Administrasi", "Bensin dan tol operasional", 200_000, 1_000_000],
    ];
    for (let i = 0; i < 9; i++) {
      const d = Math.floor(between(2, last + 1));
      const [account, text, lo, hi] = pick(petty);
      const amount = idr(lo, hi, 5_000);
      await run(day(m, d), text, [{ res: "KAS-KECIL", dir: "Out", amount }], [{ account, side: "debit", amount, description: text }]);
    }

    // Kas Besar: larger cash outlays and cash income
    for (let i = 0; i < 4; i++) {
      const d = Math.floor(between(4, last + 1));
      const amount = idr(1_500_000, 6_000_000);
      await run(day(m, d), "Pembayaran ekspedisi tunai", [{ res: "KAS-BESAR", dir: "Out", amount }], [{ account: "Beban Pengiriman", side: "debit", amount, description: "Ekspedisi" }]);
    }
    {
      const amount = idr(2_000_000, 8_000_000);
      await run(day(m, 20), "Penjualan barang bekas / scrap", [{ res: "KAS-BESAR", dir: "In", amount }], [{ account: "Pendapatan Lain-lain", side: "credit", amount, description: "Penjualan scrap" }]);
    }

    // Banks in rupiah: services, interest, fees, transfers
    for (const res of ["BCA", "MANDIRI", "BNI"]) {
      if (m !== "10" || res !== "BNI") {
        const amount = idr(4_000_000, 25_000_000);
        await run(day(m, Math.floor(between(5, last + 1))), "Pembayaran jasa konsultan pajak", [{ res, dir: "Out", amount }], [{ account: "Beban Jasa Profesional", side: "debit", amount, description: "Jasa konsultan" }]);
      }
      const interest = Math.round(between(150_000, 900_000));
      await run(day(m, last), "Jasa giro bulanan", [{ res, dir: "In", amount: interest }], [{ account: "Pendapatan Lain-lain", side: "credit", amount: interest, description: "Jasa giro" }]);
      const fee = pick([15_000, 25_000, 30_000]);
      await run(day(m, last), "Biaya administrasi rekening", [{ res, dir: "Out", amount: fee }], [{ account: "Beban Bank", side: "debit", amount: fee, description: "Biaya admin bank" }]);
    }
    {
      const amount = idr(20_000_000, 60_000_000, 1_000_000);
      await run(day(m, 12), "Pemindahan dana BCA ke BNI", [{ res: "BCA", dir: "Out", amount }, { res: "BNI", dir: "In", amount }], []);
      await run(day(m, 12), "Biaya transfer antar bank", [{ res: "BCA", dir: "Out", amount: 6_500 }], [{ account: "Beban Bank", side: "debit", amount: 6_500, description: "Biaya transfer" }]);
    }
    {
      const amount = idr(15_000_000, 45_000_000, 1_000_000);
      await run(day(m, 22), "Pemindahan dana Mandiri ke BCA", [{ res: "MANDIRI", dir: "Out", amount }, { res: "BCA", dir: "In", amount }], []);
    }

    // Dollars: buying, selling, moving and spending them
    {
      const d = day(m, 8);
      const rate = rateOn(d) + 45; // the bank sells above its middle rate
      const dollars = usd(2_000, 6_000, 100);
      await run(d, `Pembelian valas USD ${dollars.toLocaleString("id-ID")} kurs ${rate.toLocaleString("id-ID")}`, [{ res: "BCA", dir: "Out", amount: dollars * rate }, { res: "BCA-USD", dir: "In", amount: dollars, rate }], []);
    }
    {
      const d = day(m, 15);
      const dollars = usd(800, 3_200);
      await run(d, "Pembayaran lisensi software (luar negeri)", [{ res: "BCA-USD", dir: "Out", amount: dollars }], [{ account: "Beban Jasa Profesional", side: "debit", description: "Lisensi software" }]);
    }
    {
      const d = day(m, 18);
      const rate = rateOn(d);
      const dollars = usd(1_500, 4_500, 50);
      await run(d, "Penerimaan klaim asuransi pengiriman (USD)", [{ res: "MANDIRI-USD", dir: "In", amount: dollars, rate }], [{ account: "Pendapatan Lain-lain", side: "credit", amount: roundBase(dollars * rate), description: "Klaim asuransi" }]);
    }
    {
      const d = day(m, 25);
      const rate = rateOn(d) - 40; // the bank buys below its middle rate
      const dollars = usd(1_000, 3_000, 100);
      await run(d, `Penjualan valas USD ${dollars.toLocaleString("id-ID")} kurs ${rate.toLocaleString("id-ID")}`, [{ res: "MANDIRI-USD", dir: "Out", amount: dollars }, { res: "MANDIRI", dir: "In", amount: dollars * rate }], []);
    }
    {
      const d = day(m, 10);
      const dollars = usd(300, 800, 50);
      const rate = rateOn(d);
      await run(d, "Penarikan tunai USD untuk perjalanan dinas", [{ res: "BCA-USD", dir: "Out", amount: dollars }, { res: "KAS-USD", dir: "In", amount: dollars, rate }], []);
    }
    for (let i = 0; i < 2; i++) {
      const d = day(m, Math.floor(between(11, last + 1)));
      const dollars = usd(80, 450, 5);
      await run(d, "Biaya perjalanan dinas luar negeri", [{ res: "KAS-USD", dir: "Out", amount: dollars }], [{ account: "Beban Umum & Administrasi", side: "debit", description: "Perjalanan dinas" }]);
    }
    {
      const d = day(m, last);
      const fee = pick([5, 7.5, 10]);
      await run(d, "Biaya administrasi rekening USD", [{ res: "BCA-USD", dir: "Out", amount: fee }], [{ account: "Beban Bank", side: "debit", description: "Biaya admin bank USD" }]);
      await run(d, "Biaya administrasi rekening USD", [{ res: "MANDIRI-USD", dir: "Out", amount: fee }], [{ account: "Beban Bank", side: "debit", description: "Biaya admin bank USD" }]);
    }

    // Cash count differences, recorded as adjustments
    {
      const short = Math.round(between(10_000, 85_000) / 500) * 500;
      await run(day(m, last), "Koreksi selisih kas kecil (hasil opname)", [{ res: "KAS-KECIL", dir: "Out", amount: short }], [{ account: "Beban Umum & Administrasi", side: "debit", amount: short, description: "Selisih kas" }], "Adjustment");
    }
    if (m === "08") {
      await run(day(m, 31), "Koreksi kelebihan kas besar (hasil opname)", [{ res: "KAS-BESAR", dir: "In", amount: 125_000 }], [{ account: "Pendapatan Lain-lain", side: "credit", amount: 125_000, description: "Selisih kas" }], "Adjustment");
    }
  }
  let done = 0;
  let refused = 0;
  plan.sort((a, b) => a[0].localeCompare(b[0]));
  for (const args of plan) {
    if (await move(...args)) done++;
    else refused++;
  }
  return { done, refused };
}

// ------------------------------------------------------------------- main

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed-cash-bank-showcase is development data and never runs in production.");
  }
  const sistem = await prisma.sysUser.findUnique({ where: { email: "sistem@erp.app" }, select: { id: true } });
  if (!sistem) throw new Error("System data is missing. Run `npm run db:seed` first.");
  actor = sistem.id;

  const [idrRow, usdRow] = await Promise.all([
    prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL } }),
    prisma.refCurrency.findFirst({ where: { currency_label: "USD" } }),
  ]);
  if (!idrRow || !usdRow) throw new Error("IDR and USD are missing. Run `npm run db:seed` first.");
  idrId = idrRow.id;
  usdId = usdRow.id;

  const jt = await prisma.sysDocType.findFirst({ where: { doc_table: "acc_journal" } });
  if (!jt) throw new Error("Document type Journal is missing. Run `npm run db:seed` first.");
  journalDocType = jt.id;

  for (const name of ["Modal Disetor", "Pendapatan Lain-lain", "Laba/Rugi Selisih Kurs", "Beban Bank", "Beban Umum & Administrasi", "Beban Pengiriman", "Beban Pemeliharaan", "Beban Jasa Profesional"]) {
    const row = await prisma.accAccount.findFirst({ where: { account_name: { equals: name, mode: "insensitive" } } });
    if (!row) throw new Error(`Account ${name} is missing. Run \`npm run db:seed-showcase\` (or db:seed-accounts) first.`);
    acc.set(name, row.id);
  }

  const periods = await prisma.accFiscalPeriod.findMany({
    where: { start_date: { lte: new Date("2026-10-07T00:00:00Z") }, end_date: { gte: new Date(`${OPENING_DATE}T00:00:00Z`) } },
    select: { period_label: true, status: true },
  });
  if (periods.length < 4 || periods.some((p) => p.status !== "Open")) {
    throw new Error(`Periods July–October 2026 must exist and be Open (found: ${periods.map((p) => `${p.period_label} ${p.status}`).join(", ") || "none"}).`);
  }

  // The two rupiah banks of seed-showcase carry movements too.
  for (const label of ["BCA", "MANDIRI"]) {
    const row = await prisma.mCashBank.findFirst({ where: { cash_bank_label: label } });
    if (!row) throw new Error(`Cash & Bank ${label} is missing. Run \`npm run db:seed-showcase\` first.`);
    resourceId.set(label, row.id);
    accountOf.set(label, row.account_id);
    currencyOf.set(label, "IDR");
  }

  const fresh = !(await prisma.mCashBank.findFirst({ where: { cash_bank_label: "KAS-KECIL" } }));
  const cashSub = await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: CASH_BANK_SUBCATEGORY } });

  let createdResources = 0;
  for (const r of RESOURCES) {
    let account = await prisma.accAccount.findFirst({ where: { account_name: { equals: r.account, mode: "insensitive" } } });
    if (!account) {
      account = await prisma.accAccount.create({
        data: {
          account_code: await nextCode(entity("acc_account")),
          account_label: await nextAccountLabel(CASH_BANK_SUBCATEGORY),
          account_name: r.account,
          account_subcategory_id: cashSub.id,
          is_postable: true,
          normal_balance: "Debit",
          is_control_account: true,
          created_by: actor,
        },
      });
      await prisma.auditLog.create({ data: { entity_key: "acc_account", row_id: account.id, action: "TAMBAH", event: "create", by: actor } });
    }
    let cb = await prisma.mCashBank.findFirst({ where: { cash_bank_label: r.label } });
    if (!cb) {
      const code = await nextCode(entity("m_cash_bank"));
      const accountId = account.id;
      cb = await prisma.$transaction(async (tx) => {
        const row = await tx.mCashBank.create({
          data: {
            cash_bank_code: code,
            cash_bank_label: r.label,
            cash_bank_name: r.name,
            cash_bank_type: r.type,
            currency_id: r.currency === "USD" ? usdId : idrId,
            account_id: accountId,
            created_by: actor,
          },
        });
        await openCashBankBook(tx, { cashBankId: row.id, openingBalance: r.opening, rate: r.openingRate, date: OPENING_DATE, actorId: actor });
        return row;
      });
      await prisma.auditLog.create({ data: { entity_key: "m_cash_bank", row_id: cb.id, action: "TAMBAH", event: "create", by: actor } });
      createdResources++;
    }
    resourceId.set(r.label, cb.id);
    accountOf.set(r.label, cb.account_id);
    currencyOf.set(r.label, r.currency);
  }
  console.log(`Cash & Bank created: ${createdResources}`);

  if (!fresh) {
    console.log("Kas Kecil already existed — movements were made by an earlier run and are not repeated.");
    return;
  }
  const { done, refused } = await movements();
  console.log(`Movements posted: ${done} (each a journal + Cash Bank Book entries)`);
  if (refused) console.log(`Skipped for insufficient balance: ${refused}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
