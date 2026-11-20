/**
 * What the two demo seeds share (`seed-makloon.ts`, `seed-walet.ts`): the Sistem
 * actor, the audit entry every master gets, partners with addresses, banks with
 * their book, and the current fiscal year. Each writer is additive: it matches on
 * the label or name a person would recognise and creates only what is missing.
 */
import { prisma } from "../../src/lib/prisma";
import { ENTITIES, CUSTOMER_CATEGORY, SUPPLIER_CATEGORY } from "../../src/lib/erp/entities";
import { CASH_BANK_SUBCATEGORY, nextCode } from "../../src/lib/erp/records";
import { openCashBankBook } from "../../src/lib/erp/cash-bank";
import { ensureFiscalPeriods, fiscalYearShape } from "../../src/lib/erp/fiscal";
import { nextAccountLabel } from "./starter-accounts";

export const entity = (key: string) => {
  const e = ENTITIES.find((x) => x.key === key);
  if (!e) throw new Error(`Registry entity ${key} not found`);
  return e;
};

/** The Sistem user, author of every seeded row. Refuses production: demo data never goes there (P11). */
export async function seedActor(script: string): Promise<number> {
  if (process.env.NODE_ENV === "production") throw new Error(`${script} is development data and never runs in production.`);
  const sistem = await prisma.sysUser.findUnique({ where: { email: "sistem@erp.app" }, select: { id: true } });
  if (!sistem) throw new Error("System data is missing. Run `npm run db:seed` first.");
  return sistem.id;
}

export const audit = (actor: number, entityKey: string, rowId: number) =>
  prisma.auditLog.create({ data: { entity_key: entityKey, row_id: rowId, action: "TAMBAH", event: "create", by: actor } });

export type Address = { city: string; district: string; street: string; note?: string; billing?: boolean; shipping?: boolean };

/** A kelurahan in the named kecamatan of the named kota / kabupaten. */
export async function villageFor(a: Address): Promise<number> {
  const city = await prisma.sysRegionCity.findFirst({ where: { name: { equals: a.city, mode: "insensitive" } } });
  if (!city) throw new Error(`Region not found: ${a.city} — has npm run db:seed loaded the regions?`);
  // Refused rather than guessed: a silent fallback would put an address in
  // the wrong kecamatan, which a Faktur Pajak would later print.
  const district = await prisma.sysRegionDistrict.findFirst({ where: { city_id: city.id, name: { equals: a.district, mode: "insensitive" } } });
  if (!district) throw new Error(`Kecamatan not found: ${a.district}, ${a.city}`);
  const village = await prisma.sysRegionVillage.findFirst({ where: { district_id: district.id }, orderBy: { name: "asc" } });
  if (!village) throw new Error(`No kelurahan found in ${a.district}, ${a.city}`);
  return village.id;
}

export type PartnerSpec = {
  label: string;
  name: string;
  active?: boolean;
  taxpayer: "Badan" | "OrangPribadi" | "InstansiPemerintah";
  idType: "NPWP" | "NIK";
  taxId: string;
  taxName?: string;
  pkp: boolean;
  pph23?: boolean;
  pph22?: boolean;
  government?: boolean;
  /** Sales defaults for a customer, purchase defaults for a supplier (P51, P122). */
  term: string;
  mode: "Exclude" | "Include";
  /** Currency Default (P270); empty = IDR. */
  currency?: string;
  supplier?: boolean;
  addresses: Address[];
  contact?: [name: string, position: string, phone: string, email: string];
};

/** Creates the partner unless one of that name exists; true when it did. */
export async function ensurePartner(actor: number, c: PartnerSpec): Promise<boolean> {
  if (await prisma.mPartner.findFirst({ where: { partner_name: { equals: c.name, mode: "insensitive" } } })) return false;
  const category = await prisma.sysPartnerCategory.findFirstOrThrow({ where: { category_label: c.supplier ? SUPPLIER_CATEGORY : CUSTOMER_CATEGORY } });
  const term = await prisma.refPaymentTerm.findFirst({ where: { term_label: { equals: c.term, mode: "insensitive" } } });
  const currency = c.currency ? await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: c.currency } }) : null;
  const villages = await Promise.all(c.addresses.map(villageFor));
  const row = await prisma.mPartner.create({
    data: {
      partner_code: await nextCode(entity("m_partner")),
      partner_label: c.label,
      partner_name: c.name,
      category_id: category.id,
      status: c.active === false ? "Inactive" : "Active",
      taxpayer_type: c.taxpayer,
      tax_id_type: c.idType,
      tax_id: c.taxId,
      tax_name: c.taxName ?? c.name,
      is_pkp: c.pkp,
      withholds_pph23: Boolean(c.pph23),
      collects_pph22: Boolean(c.pph22),
      vat_collector: c.government ? "Government" : "None",
      default_term_id: c.supplier ? null : term?.id ?? null,
      default_price_mode: c.supplier ? null : c.mode,
      purchase_term_id: c.supplier ? term?.id ?? null : null,
      purchase_price_mode: c.supplier ? c.mode : null,
      sales_currency_id: c.supplier ? null : currency?.id ?? null,
      purchase_currency_id: c.supplier ? currency?.id ?? null : null,
      created_by: actor,
      addresses: {
        create: c.addresses.map((a, i) => ({
          village_id: villages[i],
          street: a.street,
          note: a.note ?? null,
          is_billing: Boolean(a.billing),
          is_shipping: Boolean(a.shipping),
          sort_order: i,
          created_by: actor,
        })),
      },
      contacts: c.contact
        ? { create: [{ contact_name: c.contact[0], position: c.contact[1], phone: c.contact[2], email: c.contact[3], sort_order: 0, created_by: actor }] }
        : undefined,
    },
  });
  await audit(actor, "m_partner", row.id);
  return true;
}

export type BankSpec = { label: string; name: string; account: string; note?: string; currency: string };

/** A bank's Cash & Bank account (created when no account has its name), then the resource with an empty book. True when the resource was created. */
export async function ensureBank(actor: number, b: BankSpec): Promise<boolean> {
  if (await prisma.mCashBank.findFirst({ where: { cash_bank_label: b.label } })) return false;
  let account = await prisma.accAccount.findFirst({ where: { account_name: { equals: b.account, mode: "insensitive" } } });
  if (!account) {
    const cashSub = await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: CASH_BANK_SUBCATEGORY } });
    account = await prisma.accAccount.create({
      data: {
        account_code: await nextCode(entity("acc_account")),
        account_label: await nextAccountLabel(CASH_BANK_SUBCATEGORY),
        account_name: b.account,
        account_subcategory_id: cashSub.id,
        is_postable: true,
        normal_balance: "Debit",
        is_control_account: true,
        note: b.note ?? null,
        created_by: actor,
      },
    });
    await audit(actor, "acc_account", account.id);
  }
  const currency = await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: b.currency } });
  const code = await nextCode(entity("m_cash_bank"));
  const accountId = account.id;
  const row = await prisma.$transaction(async (tx) => {
    const cb = await tx.mCashBank.create({
      data: { cash_bank_code: code, cash_bank_label: b.label, cash_bank_name: b.name, cash_bank_type: "Bank", currency_id: currency.id, account_id: accountId, created_by: actor },
    });
    await openCashBankBook(tx, { cashBankId: cb.id, openingBalance: 0, rate: 1, date: new Date().toISOString().slice(0, 10), actorId: actor });
    return cb;
  });
  await audit(actor, "m_cash_bank", row.id);
  return true;
}

/** The current calendar year, Open, with its twelve periods. True when it was created. */
export async function ensureFiscalYear(actor: number): Promise<boolean> {
  const year = new Date().getUTCFullYear();
  if (await prisma.accFiscalYear.findFirst({ where: { year_label: String(year) } })) return false;
  const code = await nextCode(entity("acc_fiscal_year"));
  const fy = await prisma.$transaction(async (tx) => {
    const row = await tx.accFiscalYear.create({ data: { year_code: code, year_label: String(year), ...fiscalYearShape(year), status: "Open", created_by: actor } });
    await ensureFiscalPeriods(tx, { fiscalYearId: row.id, year, actorId: actor });
    return row;
  });
  await audit(actor, "acc_fiscal_year", fy.id);
  return true;
}
