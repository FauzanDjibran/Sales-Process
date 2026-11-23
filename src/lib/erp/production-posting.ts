import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { BASE_CURRENCY_LABEL } from "./currency";
import { HandoverRefusal, type HandoverMessage, type PostedReply } from "./handover";
import { accountsForItems } from "./item-account";
import { trackingsByNo } from "./inventory";
import { postJournal, type JournalLineInput } from "./journal";
import { fallbackAccounts } from "./system-settings";

/**
 * The one door production's money comes through (P318, `Goods-Movement-Plan.md`
 * step 10): a production document never writes a journal or a Unit cost. It says
 * in `ProductionPosted` how much value each item gained or lost and which Unit
 * costs were charged; here the ERP chooses the accounts, writes the journal and
 * the `prd_cost_entry` rows, which nothing else names.
 *
 * The journal is net per account, because WIP moves only where the accounts
 * differ (§7): each item's WIP is its Kategori Item's, with no fallback (R16);
 * the Unit cost is credited to Biaya Produksi Dibebankan, and value with no
 * receiver debited to Beban Pemusnahan Produksi (W32). Nothing to move is no
 * journal.
 *
 * shortcut: a document may post more than once (a Kerja, Job by Job), so the
 * message has no number to know a repeat by; the inbox will, once there are two
 * databases (§7.2). Until then it is delivered exactly once, in the sender's
 * transaction.
 */

type Tx = Prisma.TransactionClient;
type Posted = Extract<HandoverMessage, { type: "ProductionPosted" }>;

const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

async function journalLines(tx: Tx, m: Posted): Promise<JournalLineInput[]> {
  const items = await tx.mItem.findMany({
    where: { item_code: { in: [...new Set(m.moves.map((x) => x.itemCode))] } },
    select: { id: true, item_code: true, item_label: true, category: { select: { category_label: true } } },
  });
  const byCode = new Map(items.map((i) => [i.item_code, i]));
  const accounts = await accountsForItems(items.map((i) => i.id), tx);
  const net = new Map<number, number>();
  const add = (accountId: number, amount: number) => net.set(accountId, (net.get(accountId) ?? 0) + amount);
  for (const x of m.moves) {
    const item = byCode.get(x.itemCode);
    if (!item) throw new HandoverRefusal(`Item ${x.itemCode} tidak dikenal di ERP.`);
    const wip = accounts.get(item.id)?.wip;
    if (!wip) throw new HandoverRefusal(`Lengkapi Account Kategori Item ${item.category.category_label} dulu: Account WIP untuk ${item.item_label}.`);
    add(wip, x.amount);
  }
  const cost = m.costs.reduce((a, c) => a + c.amount, 0);
  const mapped = await fallbackAccounts(["production_absorbed_account", "production_scrap_account"] as const);
  if (cost) {
    if (!mapped.production_absorbed_account) throw new HandoverRefusal("Lengkapi Account Mapping dulu: Biaya Produksi Dibebankan.");
    add(mapped.production_absorbed_account, -cost);
  }
  if (m.scrap) {
    if (!mapped.production_scrap_account) throw new HandoverRefusal("Lengkapi Account Mapping dulu: Beban Pemusnahan Produksi.");
    add(mapped.production_scrap_account, m.scrap);
  }
  const lines = [...net].filter(([, amount]) => amount !== 0);
  if (!lines.length) return [];
  const currency = await tx.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!currency) throw new HandoverRefusal("Mata uang dasar tidak ditemukan.");
  return lines.map(([accountId, amount]) => ({ accountId, currencyId: currency.id, rate: 1, debit: Math.max(amount, 0), credit: Math.max(-amount, 0), description: m.description }));
}

async function writeCosts(tx: Tx, m: Posted, docTypeId: number, actorId: number) {
  if (!m.costs.length) return;
  const [units, versions, lines, trackings] = await Promise.all([
    tx.refUnit.findMany({ where: { unit_label: { in: m.costs.map((c) => c.unitLabel) } }, select: { id: true, unit_label: true } }),
    tx.prdRateVersion.findMany({ where: { rate_code: { in: m.costs.map((c) => c.rateVersionCode) } }, select: { id: true, rate_code: true } }),
    tx.prdLine.findMany({ where: { line_code: { in: m.costs.flatMap((c) => (c.lineCode ? [c.lineCode] : [])) } }, select: { id: true, line_code: true } }),
    trackingsByNo(tx, m.costs.map((c) => c.trackingNo)),
  ]);
  const unit = new Map(units.map((u) => [u.unit_label, u.id]));
  const version = new Map(versions.map((v) => [v.rate_code, v.id]));
  const line = new Map(lines.map((l) => [l.line_code, l.id]));
  await tx.prdCostEntry.createMany({
    data: m.costs.map((c) => {
      const unit_id = unit.get(c.unitLabel);
      const rate_version_id = version.get(c.rateVersionCode);
      const tracking_id = trackings.get(c.trackingNo)?.id;
      if (!unit_id || !rate_version_id || !tracking_id) throw new HandoverRefusal(`Biaya Unit ${c.unitLabel} untuk No. Stok ${c.trackingNo} tidak dikenal di ERP.`);
      return {
        posting_date: asDate(m.date),
        source_doc_type_id: docTypeId,
        source_doc_id: m.docId,
        source_no: m.no,
        unit_id,
        rate_version_id,
        tracking_id,
        partai_no: c.partaiNo,
        line_id: c.lineCode ? (line.get(c.lineCode) ?? null) : null,
        grams: c.grams,
        rate: c.rate,
        amount: c.amount,
        is_rework: c.isRework,
        created_by: actorId,
      };
    }),
  });
}

export async function takeProductionPosted(tx: Tx, m: Posted, actorId: number): Promise<PostedReply> {
  const type = await tx.sysDocType.findFirst({ where: { doc_table: m.docTable }, select: { id: true } });
  if (!type) throw new HandoverRefusal(`Jenis dokumen ${m.docTable} belum terdaftar. Jalankan db:seed.`);
  await writeCosts(tx, m, type.id, actorId);
  const lines = await journalLines(tx, m);
  const journal = lines.length
    ? await postJournal(tx, { description: m.description, sourceDocTypeId: type.id, sourceDocId: m.docId, postingDate: asDate(m.date), actorId, lines })
    : null;
  return { journalId: journal?.id ?? null, lines };
}
