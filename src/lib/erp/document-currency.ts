import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isBaseCurrency } from "./currency";
import { sumBase, withBase } from "./fx";
import { taxScale, type SalesTotals } from "./sales-tax";

/**
 * A document's currency and its rate (Multi-Currency-Plan MC3, MC6): what a
 * Customer Order or a Purchase Order offers, suggests and checks. The rate
 * suggested is the Kurs master's latest Transaction rate on or before the
 * document's date; the document keeps the rate it was saved with.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CurrencyOption = { id: number; label: string; name: string; active: boolean };
/** One Kurs row a form may suggest from (`suggestRate` in `currency.ts`). */
export type TransactionRate = { currencyId: number; date: string; rate: number };

export async function documentCurrencyOptions(db: Db = prisma): Promise<{ currencies: CurrencyOption[]; rates: TransactionRate[] }> {
  const [currencies, rates] = await Promise.all([
    db.refCurrency.findMany({ orderBy: { currency_label: "asc" } }),
    db.refExchangeRate.findMany({
      where: { rate_type: "Transaction", status: "Active" },
      orderBy: [{ rate_date: "desc" }, { id: "desc" }],
      select: { currency_id: true, rate_date: true, rate: true },
    }),
  ]);
  return {
    // The base currency first: the one a new document starts on.
    currencies: currencies
      .map((c) => ({ id: c.id, label: c.currency_label, name: c.currency_name, active: c.status === "Active" }))
      .sort((a, b) => Number(isBaseCurrency(b.label)) - Number(isBaseCurrency(a.label))),
    rates: rates.map((r) => ({ currencyId: r.currency_id, date: r.rate_date.toISOString().slice(0, 10), rate: r.rate.toNumber() })),
  };
}

export type CheckedCurrency = { currencyId: number; label: string; rate: number; scale: number };

/**
 * The document's currency and rate, or the errors to show: the base currency
 * is always at rate 1 (MC2), any other needs a rate above zero typed or
 * suggested. A currency is fixed once the document has lines (MC3) — the form
 * locks it; the server only checks it exists.
 */
export async function checkDocumentCurrency(
  db: Db,
  input: { currency_id?: number | null; exchange_rate?: number | string | null },
  errors: Record<string, string>
): Promise<CheckedCurrency | null> {
  const id = Number(input.currency_id) || null;
  const c = id ? await db.refCurrency.findUnique({ where: { id } }) : await db.refCurrency.findFirst({ where: { currency_label: "IDR" } });
  if (!c) {
    errors.currency_id = "Pilih currency.";
    return null;
  }
  if (c.status !== "Active") errors.currency_id = "Currency tersebut sudah nonaktif.";
  if (isBaseCurrency(c.currency_label)) return { currencyId: c.id, label: c.currency_label, rate: 1, scale: 1 };
  const rate = Number(String(input.exchange_rate ?? "").replace(",", "."));
  if (!Number.isFinite(rate) || !(rate > 0)) {
    errors.exchange_rate = `Isi kurs ${c.currency_label} ke IDR.`;
    return null;
  }
  return { currencyId: c.id, label: c.currency_label, rate, scale: taxScale(c.currency_label) };
}

/** An order line's money at the order's rate (MC4, MC5). */
export function orderLineBase(t: SalesTotals, i: number, rate: number) {
  const r = t.lines[i];
  return withBase({ discount_amount: r.discount, amount: r.amount, dpp_amount: r.dpp, dpp_other_amount: r.dppOther, ppn_amount: r.ppn }, rate);
}

/** An order's figures with their base: each line at the rate, the header the sum of its lines (MC4). */
export function orderTotalsData(t: SalesTotals, rate: number) {
  const b = sumBase(
    t.lines.map((_, i) => orderLineBase(t, i, rate)),
    ["discount_amount", "amount", "dpp_amount", "dpp_other_amount", "ppn_amount"] as const
  );
  const cents = (n: number) => Math.round(n * 100);
  return {
    gross_amount: t.gross,
    discount_amount: t.discount,
    dpp_amount: t.dpp,
    dpp_other_amount: t.dppOther,
    ppn_amount: t.ppn,
    total_amount: t.total,
    base_gross_amount: (cents(b.base_amount) + cents(b.base_discount_amount)) / 100,
    base_discount_amount: b.base_discount_amount,
    base_dpp_amount: b.base_dpp_amount,
    base_dpp_other_amount: b.base_dpp_other_amount,
    base_ppn_amount: b.base_ppn_amount,
    base_total_amount: (cents(b.base_dpp_amount) + cents(b.base_ppn_amount)) / 100,
  };
}
