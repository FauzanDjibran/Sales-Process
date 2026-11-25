import "server-only";

import { documentHref } from "./document-links";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { RefOption } from "./records";
import { formatNumber } from "@/lib/format";
import { issueWarehouses } from "./production-issue";
import { routeMap } from "./production-master";
import { transferDestinations } from "./production-transfer";
import { allPartai, jobsByIds, partaiNosByIds } from "./production-ledger";
import { deliveriesOfLots } from "./delivery-note";
import { ENTRY_PAGE_SIZE, type BookCursor } from "./register-query";
import { lotStockPositions } from "./stock-report";

/**
 * The production reports (R18, P310): **Saldo Produksi**, **Kartu Produksi** and
 * **Telusur Produksi**. Read-only, and read from the ledger — never from the
 * balance table — so a past date is reported as it stood; the page says whether
 * the balance table still equals its ledger.
 *
 * The book is written only by `production-ledger.ts`; this module only reads it
 * (as `stock-report.ts` reads the stock books).
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | null | undefined) => (d ? d.toNumber() : 0);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export async function stationOptions(): Promise<RefOption[]> {
  const rows = await prisma.refUnit.findMany({ orderBy: { unit_label: "asc" }, select: { id: true, unit_label: true, unit_name: true, status: true } });
  return rows.map((w) => ({ id: w.id, label: w.unit_label, name: w.unit_name, active: w.status === "Active" }));
}

/** Where goods wait inside a Unit (T4, P281), as the Workspace names it. */
const PROCESS_TEXT: Record<string, string> = { Grading: "Grading", JobOrder: "Job Order", Assign: "Assign", Kerja: "Kerja", Assembly: "Assembly" };
export function stageText(stage: string, process: string | null | undefined): string {
  if (stage === "Preparation") return process ? `Persiapan ${PROCESS_TEXT[process] ?? process}` : "Persiapan";
  if (stage === "Working") return process ? `Sedang Dikerjakan ${PROCESS_TEXT[process] ?? process}` : "Sedang Dikerjakan";
  return { QcCheck: "QC Check", StandBy: "Stand By", InTransit: "Dalam Perjalanan" }[stage] ?? stage;
}
/** The five stages of a Unit, in the order goods pass them: a column each in the reports. */
export const PRODUCTION_STAGES = ["Preparation", "Working", "QcCheck", "StandBy", "InTransit"] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];
export type StageFigures = Record<ProductionStage, number>;
const noStages = (): StageFigures => ({ Preparation: 0, Working: 0, QcCheck: 0, StandBy: 0, InTransit: 0 });
const processText = (p: string | null | undefined) => (p ? (PROCESS_TEXT[p] ?? p) : null);

/** Units in the order goods pass them: the segment before the partai, then the lines; a Unit on no routing comes last. */
async function unitOrder(): Promise<(unitId: number) => number> {
  const at = new Map<number, number>();
  for (const route of (await routeMap()).routings) {
    route.steps.forEach((step, i) => {
      const place = (route.lineId === null ? 0 : 1000) + i;
      at.set(step.unitId, Math.min(at.get(step.unitId) ?? Infinity, place));
    });
  }
  return (unitId) => at.get(unitId) ?? 1_000_000;
}

export async function partaiOptions(): Promise<RefOption[]> {
  return (await allPartai()).map((p) => ({ id: p.id, label: p.no, name: "", active: true }));
}

/** Every item production has held. */
export async function productionItemOptions(): Promise<RefOption[]> {
  const held = await prisma.prdBalance.findMany({ distinct: ["item_id"], select: { item: { select: { id: true, item_label: true, item_name: true } } } });
  return held.map(({ item: i }) => ({ id: i.id, label: i.item_label, name: i.item_name, active: true })).sort((a, b) => a.label.localeCompare(b.label));
}

// ----------------------------------------------------------- Saldo Produksi

export type ProductionItemRef = { id: number; label: string; name: string; uomLabel: string };
export type ProductionUnitRef = { id: number; label: string; name: string };

export type WipRow = {
  bucketId: number;
  item: ProductionItemRef;
  unit: ProductionUnitRef;
  partai: { id: number; no: string } | null;
  lotNo: string;
  stage: ProductionStage;
  /** The Unit step goods wait at, in Persiapan or Dikerjakan. */
  process: string | null;
  /** Where goods Dalam Perjalanan go: a Unit or a warehouse. */
  to: string | null;
  jobNo: string | null;
  /** Turned back by a QC Check (W66). */
  qcReturn: boolean;
  auxiliary: boolean;
  qty: number;
};

export type WipFilter = { unitIds: number[]; itemIds: number[]; partaiIds: number[]; auxiliary: boolean };

const ITEM_SELECT = { id: true, item_label: true, item_name: true, base_uom: { select: { uom_label: true } } } as const;
const itemRef = (i: { id: number; item_label: string; item_name: string; base_uom: { uom_label: string } }): ProductionItemRef => ({
  id: i.id,
  label: i.item_label,
  name: i.item_name,
  uomLabel: i.base_uom.uom_label,
});
const UNIT_SELECT = { id: true, unit_label: true, unit_name: true } as const;
const unitRef = (u: { id: number; unit_label: string; unit_name: string }): ProductionUnitRef => ({ id: u.id, label: u.unit_label, name: u.unit_name });

/**
 * What production held on a date, a row per bucket: its movements summed up to
 * it. Never a row's stored balance, which follows posting order and so is off
 * once a movement is backdated (P310). Rows come in the order goods pass
 * through the Units, then by step, item and No. Stok; the page groups them.
 */
export async function wipBalanceReport(asOf: string, f: WipFilter): Promise<WipRow[]> {
  const sums = await prisma.$queryRaw<{ bucket_id: number; qty: Prisma.Decimal }[]>`
    SELECT bucket_id, SUM(qty_change) AS qty FROM prd_ledger
     WHERE posting_date <= ${asOf}::date ${inIds("unit_id", f.unitIds)} ${inIds("item_id", f.itemIds)} ${inIds("partai_id", f.partaiIds)}
     GROUP BY bucket_id HAVING SUM(qty_change) <> 0`;
  if (!sums.length) return [];
  const at = new Map(sums.map((s) => [s.bucket_id, num(s.qty)]));
  const buckets = await prisma.prdBalance.findMany({
    where: { id: { in: [...at.keys()] }, ...(f.auxiliary ? {} : { auxiliary: false }) },
    include: {
      tracking: { select: { tracking_no: true } },
      item: { select: ITEM_SELECT },
      unit: { select: UNIT_SELECT },
      step: { select: { process: true, seq: true } },
      job: { select: { job_no: true } },
      partai: { select: { id: true, partai_no: true } },
    },
  });
  const docType = new Map((await prisma.sysDocType.findMany({ where: { doc_table: { in: ["prd_transfer", "prd_issue"] } }, select: { id: true, doc_table: true } })).map((d) => [d.id, d.doc_table]));
  const transit = (table: string) => buckets.flatMap((b) => (b.transit_doc_id && docType.get(b.transit_doc_type_id ?? 0) === table ? [b.transit_doc_id] : []));
  const [order, toUnit, toWarehouse] = await Promise.all([unitOrder(), transferDestinations(transit("prd_transfer")), issueWarehouses(transit("prd_issue"))]);
  const unitBy = new Map((await prisma.refUnit.findMany({ where: { id: { in: [...toUnit.values()] } }, select: { id: true, unit_label: true } })).map((u) => [u.id, u.unit_label]));
  const destination = (b: (typeof buckets)[number]) => {
    if (!b.transit_doc_id) return null;
    return docType.get(b.transit_doc_type_id ?? 0) === "prd_issue" ? (toWarehouse.get(b.transit_doc_id) ?? null) : (unitBy.get(toUnit.get(b.transit_doc_id) ?? 0) ?? null);
  };
  // Persiapan and Sedang Dikerjakan of a process come together, processes in their order.
  const place = (b: (typeof buckets)[number]) => (b.step ? b.step.seq * 10 : 1000) + PRODUCTION_STAGES.indexOf(b.stage);
  return buckets
    .sort(
      (a, b) =>
        order(a.unit_id) - order(b.unit_id) ||
        a.unit.unit_label.localeCompare(b.unit.unit_label) ||
        place(a) - place(b) ||
        a.item.item_label.localeCompare(b.item.item_label) ||
        a.tracking.tracking_no.localeCompare(b.tracking.tracking_no)
    )
    .map((b) => ({
      bucketId: b.id,
      item: itemRef(b.item),
      unit: unitRef(b.unit),
      partai: b.partai ? { id: b.partai.id, no: b.partai.partai_no } : null,
      lotNo: b.tracking.tracking_no,
      stage: b.stage,
      process: processText(b.step?.process),
      to: destination(b),
      jobNo: b.job?.job_no ?? null,
      qcReturn: b.qc_check_id !== null,
      auxiliary: b.auxiliary,
      qty: at.get(b.id)!,
    }));
}

/** `AND column IN (…)`, or nothing when none is chosen. */
function inIds(column: "unit_id" | "item_id" | "partai_id" | "tracking_id", ids: number[]) {
  return ids.length ? Prisma.sql`AND ${Prisma.raw(column)} IN (${Prisma.join(ids)})` : Prisma.empty;
}

/** Whether every bucket still equals its ledger rows — the book's own check, shown as a warning when it fails. */
export async function productionBooksReconcile(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM prd_balance b
      LEFT JOIN (SELECT bucket_id, SUM(qty_change) AS q, SUM(value_change) AS v FROM prd_ledger GROUP BY bucket_id) l ON l.bucket_id = b.id
     WHERE b.qty_balance <> COALESCE(l.q, 0) OR b.value_balance <> COALESCE(l.v, 0)`;
  return Number(rows[0].n) === 0;
}

// ---------------------------------------------------------- Kartu Produksi

/**
 * Kartu Produksi: the production ledger as blocks, one per Unit, per item, or
 * per chosen No. Stok. A row is one document, one No. Stok, one day, one Unit,
 * with what it did to each stage as signed columns, so a move between stages is
 * read off the columns. **Masuk and Keluar cross the Unit's border**; what a
 * document consumes and produces inside it is neither, and the gap between the
 * two is its **susut** — summed over a document's items, so only where they
 * share one unit of measure, and never over bahan penolong. Nothing here holds
 * a price (P275).
 */
export type ProductionCardKind = "unit" | "item" | "lot";
export type ProductionCardFilter = { unitIds: number[]; itemIds: number[]; lotIds: number[] };

/** A block's figures in one unit of measure: opening + in − out + worked = closing, per stage too. */
export type ProductionFigures = {
  uomLabel: string;
  opening: number;
  totalIn: number;
  totalOut: number;
  /** Produced − consumed. */
  worked: number;
  /** Lost by documents in one unit of measure; null where an item or No. Stok filter hides part of a document. */
  shrinkage: number | null;
  /** Produced − consumed by documents that change the unit of measure; null with `shrinkage`. */
  converted: number | null;
  closing: number;
  stageOpening: StageFigures;
  stageClosing: StageFigures;
};

export type ProductionCard = {
  id: number;
  label: string;
  name: string;
  /** The No. Stok of a No. Stok block. */
  lot: { sourceNo: string; supplier: string | null; expiry: string | null; now: string[] } | null;
  figures: ProductionFigures[];
  entryCount: number;
};

export type ProductionCardEntry = {
  id: number;
  date: string;
  source: { table: string; id: number; no: string };
  text: string;
  /** The Unit steps it touched, `Grading → Job Order`. */
  process: string;
  unitLabel: string;
  itemLabel: string;
  uomLabel: string;
  lotNo: string;
  partaiNo: string | null;
  jobNo: string | null;
  auxiliary: boolean;
  /** Signed, by stage. */
  stages: StageFigures;
  /** Signed: across the Unit's border. */
  crossed: number;
  /** On the last row of a document that consumes and produces in one unit of measure. */
  shrinkage: number | null;
};

const CARD_LIMIT = 300;

const cardWhere = (f: ProductionCardFilter) => Prisma.sql`${inIds("unit_id", f.unitIds)} ${inIds("item_id", f.itemIds)} ${inIds("tracking_id", f.lotIds)}`;
const SUBJECT: Record<ProductionCardKind, "unit_id" | "item_id" | "tracking_id"> = { unit: "unit_id", item: "item_id", lot: "tracking_id" };
/** Part of a document is hidden, so what it lost cannot be said. */
const partial = (kind: ProductionCardKind, f: ProductionCardFilter) => kind !== "unit" || f.itemIds.length > 0 || f.lotIds.length > 0;

const perStage = Prisma.join(PRODUCTION_STAGES.map((st) => Prisma.sql`SUM(qty_change) FILTER (WHERE stage::text = ${st}) AS ${Prisma.raw(`"${st}"`)}`));
type StageSums = Record<ProductionStage, Prisma.Decimal | null>;
const stagesOf = (row: StageSums): StageFigures => {
  const out = noStages();
  for (const st of PRODUCTION_STAGES) out[st] = num(row[st]);
  return out;
};

/** The rows of a range: one document, No. Stok, day and Unit, each knowing what its whole document did there. */
const cardRows = (f: ProductionCardFilter, from: string, to: string) => Prisma.sql`
  WITH e AS (
    SELECT MIN(l.id) AS id, l.posting_date, l.source_doc_type_id, l.source_doc_id, MIN(l.source_no) AS source_no, l.unit_id, l.item_id, l.tracking_id,
           b.auxiliary, i.base_uom_id AS uom_id, MAX(l.partai_id) AS partai_id, MAX(l.job_id) AS job_id,
           array_agg(DISTINCT l.movement::text) AS movements, array_agg(l.unit_step_id ORDER BY l.id) AS steps, array_agg(DISTINCT l.stage::text) AS touched,
           COALESCE(SUM(l.qty_change) FILTER (WHERE l.movement IN ('Issued', 'Released', 'TransferIn', 'TransferOut')), 0) AS crossed,
           COALESCE(SUM(l.qty_change) FILTER (WHERE l.movement IN ('Consumed', 'Produced')), 0) AS worked,
           (bool_or(l.movement IN ('Consumed', 'Produced')) AND NOT b.auxiliary) AS works,
           ${Prisma.raw(PRODUCTION_STAGES.map((st) => `COALESCE(SUM(l.qty_change) FILTER (WHERE l.stage = '${st}'), 0) AS "${st}"`).join(", "))}
      FROM (SELECT * FROM prd_ledger WHERE posting_date BETWEEN ${from}::date AND ${to}::date ${cardWhere(f)}) l
      JOIN prd_balance b ON b.id = l.bucket_id
      JOIN m_item i ON i.id = l.item_id
     GROUP BY l.posting_date, l.source_doc_type_id, l.source_doc_id, l.unit_id, l.item_id, l.tracking_id, b.auxiliary, i.base_uom_id),
  w AS (
    SELECT e.*, SUM(worked) FILTER (WHERE works) OVER doc AS doc_worked, MAX(id) FILTER (WHERE works) OVER doc AS doc_last,
           (MIN(uom_id) FILTER (WHERE works) OVER doc = MAX(uom_id) FILTER (WHERE works) OVER doc) AS one_uom
      FROM e WINDOW doc AS (PARTITION BY posting_date, source_doc_type_id, source_doc_id, unit_id))`;

/** Blocks with an opening or a movement, figures from the database's own sums; No. Stok blocks stop at a limit. */
export async function productionCardReport(
  kind: ProductionCardKind,
  f: ProductionCardFilter,
  range: { from: string; to: string }
): Promise<{ cards: ProductionCard[]; truncated: boolean }> {
  const subject = Prisma.raw(SUBJECT[kind]);
  // A Unit's bahan penolong is listed but not added to the goods being worked.
  const counted = kind === "unit" ? Prisma.sql`NOT auxiliary` : Prisma.sql`TRUE`;
  const [before, moved, counts] = await Promise.all([
    prisma.$queryRaw<({ subject: number; uom_id: number } & StageSums)[]>`
      SELECT ${subject} AS subject, uom_id, ${perStage}
        FROM (SELECT l.unit_id, l.item_id, l.tracking_id, l.stage, l.qty_change, b.auxiliary, i.base_uom_id AS uom_id
                FROM (SELECT * FROM prd_ledger WHERE posting_date < ${range.from}::date ${cardWhere(f)}) l
                JOIN prd_balance b ON b.id = l.bucket_id JOIN m_item i ON i.id = l.item_id) o
       WHERE ${counted} GROUP BY ${subject}, uom_id`,
    prisma.$queryRaw<({ subject: number; uom_id: number; qin: Prisma.Decimal; qout: Prisma.Decimal; worked: Prisma.Decimal; converted: Prisma.Decimal } & StageSums)[]>`
      ${cardRows(f, range.from, range.to)}
      SELECT ${subject} AS subject, uom_id, SUM(GREATEST(crossed, 0)) AS qin, SUM(GREATEST(-crossed, 0)) AS qout, SUM(worked) AS worked,
             COALESCE(SUM(worked) FILTER (WHERE works AND NOT one_uom), 0) AS converted,
             ${Prisma.raw(PRODUCTION_STAGES.map((st) => `SUM("${st}") AS "${st}"`).join(", "))}
        FROM w WHERE ${counted} GROUP BY ${subject}, uom_id`,
    prisma.$queryRaw<{ subject: number; n: bigint }[]>`${cardRows(f, range.from, range.to)} SELECT ${subject} AS subject, COUNT(*) AS n FROM w GROUP BY ${subject}`,
  ]);
  const hidden = partial(kind, f);
  const acc = new Map<number, Map<number, ProductionFigures>>();
  const figures = (subjectId: number, uomId: number) => {
    const block = acc.get(subjectId) ?? new Map<number, ProductionFigures>();
    acc.set(subjectId, block);
    const found = block.get(uomId) ?? { uomLabel: "", opening: 0, totalIn: 0, totalOut: 0, worked: 0, shrinkage: null, converted: null, closing: 0, stageOpening: noStages(), stageClosing: noStages() };
    block.set(uomId, found);
    return found;
  };
  for (const b of before) {
    const x = figures(b.subject, b.uom_id);
    x.stageOpening = stagesOf(b);
    x.opening = round6(PRODUCTION_STAGES.reduce((sum, st) => sum + x.stageOpening[st], 0));
  }
  for (const m of moved) {
    const x = figures(m.subject, m.uom_id);
    const stages = stagesOf(m);
    Object.assign(x, { totalIn: num(m.qin), totalOut: num(m.qout), worked: num(m.worked) });
    for (const st of PRODUCTION_STAGES) x.stageClosing[st] = stages[st];
  }
  const convertedOf = new Map(moved.map((m) => [`${m.subject}:${m.uom_id}`, num(m.converted)]));
  for (const [subjectId, block] of acc) {
    for (const [uomId, x] of block) {
      for (const st of PRODUCTION_STAGES) x.stageClosing[st] = round6(x.stageOpening[st] + x.stageClosing[st]);
      x.closing = round6(x.opening + x.totalIn - x.totalOut + x.worked);
      if (!hidden) {
        x.converted = convertedOf.get(`${subjectId}:${uomId}`) ?? 0;
        x.shrinkage = round6(x.converted - x.worked);
      }
      // What never stood nor moved has nothing to say.
      if (!x.opening && !x.totalIn && !x.totalOut && !x.worked && !x.closing && PRODUCTION_STAGES.every((st) => !x.stageClosing[st]) && block.size > 1) block.delete(uomId);
    }
  }
  const countOf = new Map(counts.map((c) => [c.subject, Number(c.n)]));
  for (const id of countOf.keys()) if (!acc.has(id)) acc.set(id, new Map());
  const ids = [...acc.keys()].filter((id) => countOf.get(id) || [...acc.get(id)!.values()].some((x) => PRODUCTION_STAGES.some((st) => x.stageOpening[st])));
  const [uoms, units, items, lots, order] = await Promise.all([
    prisma.refUom.findMany({ select: { id: true, uom_label: true } }),
    kind === "unit" ? prisma.refUnit.findMany({ where: { id: { in: ids } }, select: UNIT_SELECT }) : [],
    kind === "item" ? prisma.mItem.findMany({ where: { id: { in: ids } }, select: ITEM_SELECT, orderBy: { item_label: "asc" } }) : [],
    kind === "lot"
      ? prisma.logStockTracking.findMany({
          where: { id: { in: ids } },
          orderBy: { tracking_no: "asc" },
          take: CARD_LIMIT,
          include: { source_partner: { select: { partner_label: true, partner_name: true } }, item: { select: ITEM_SELECT } },
        })
      : [],
    unitOrder(),
  ]);
  const held = lots.length
    ? await prisma.prdBalance.findMany({
        where: { tracking_id: { in: lots.map((l) => l.id) }, qty_balance: { gt: 0 } },
        include: { unit: { select: { unit_label: true } }, step: { select: { process: true } } },
      })
    : [];
  const uomBy = new Map(uoms.map((u) => [u.id, u.uom_label]));
  const card = (id: number, label: string, name: string, lot: ProductionCard["lot"] = null): ProductionCard => ({
    id,
    label,
    name,
    lot,
    figures: [...acc.get(id)!].map(([uomId, x]) => ({ ...x, uomLabel: uomBy.get(uomId) ?? "" })),
    entryCount: countOf.get(id) ?? 0,
  });
  const cards =
    kind === "unit"
      ? units.sort((a, b) => order(a.id) - order(b.id) || a.unit_label.localeCompare(b.unit_label)).map((u) => card(u.id, u.unit_label, u.unit_name))
      : kind === "item"
        ? items.map((i) => card(i.id, i.item_label, i.item_name))
        : lots.map((l) =>
            card(l.id, l.tracking_no, `${l.item.item_label} ${l.item.item_name}`, {
              sourceNo: l.source_no,
              supplier: l.source_partner ? `${l.source_partner.partner_label} · ${l.source_partner.partner_name}` : null,
              expiry: l.expiry_date ? iso(l.expiry_date) : null,
              now: held
                .filter((h) => h.tracking_id === l.id)
                .map((h) => `${h.unit.unit_label} · ${stageText(h.stage, h.step?.process)} · ${formatNumber(num(h.qty_balance), h.qty_balance.isInteger() ? 0 : 4)} ${l.item.base_uom.uom_label}`),
            })
          );
  return { cards, truncated: kind === "lot" && ids.length > CARD_LIMIT };
}

const STAGE_TEXT: Record<ProductionStage, string> = { Preparation: "Persiapan", Working: "Dikerjakan", QcCheck: "QC", StandBy: "Stand By", InTransit: "Dalam Perjalanan" };

/** What a row says happened, from the kinds of movement in it and the Unit on its other side. */
function entryText(e: { crossed: number; movements: string[]; stages: StageFigures; touched: string[] }, docName: string, other: string): string {
  const has = (m: string) => e.movements.includes(m);
  const names = (pick: (n: number) => boolean) => PRODUCTION_STAGES.filter((st) => e.touched.includes(st) && pick(e.stages[st])).map((st) => STAGE_TEXT[st]);
  const through = names((n) => n === 0).filter((n) => n !== STAGE_TEXT.Preparation);
  const text = has("Issued")
    ? "Dari gudang"
    : has("Released")
      ? "Ke gudang"
      : e.crossed > 0
        ? `Dari ${other || "unit lain"}`
        : e.crossed < 0
          ? `Ke ${other || "unit lain"}`
          : has("Consumed") && has("Produced")
            ? [names((n) => n < 0).join(", "), names((n) => n > 0).join(", ")].filter(Boolean).join(" → ") || docName
            : has("Produced")
              ? "Hasil"
              : has("Consumed")
                ? "Dipakai"
                : [names((n) => n < 0).join(", "), names((n) => n > 0).join(", ")].filter(Boolean).join(" → ") || docName;
  return through.length ? `${text}, lewat ${through.join(", ")}` : text;
}

/** One page of a block's rows, by date then the order they were posted. */
export async function productionCardEntriesPage(
  kind: ProductionCardKind,
  subjectId: number,
  f: ProductionCardFilter,
  range: { from: string; to: string },
  cursor: BookCursor | null
): Promise<{ entries: ProductionCardEntry[]; next: BookCursor | null }> {
  // The block's own subject takes the place of that filter.
  const own: ProductionCardFilter = { unitIds: kind === "unit" ? [subjectId] : f.unitIds, itemIds: kind === "item" ? [subjectId] : f.itemIds, lotIds: kind === "lot" ? [subjectId] : f.lotIds };
  // A document's own sums are taken before the cursor cuts a page, so a page may split one.
  const rows = await prisma.$queryRaw<
    ({
      id: number;
      posting_date: Date;
      source_doc_type_id: number;
      source_doc_id: number;
      source_no: string;
      unit_id: number;
      item_id: number;
      tracking_id: number;
      auxiliary: boolean;
      uom_id: number;
      partai_id: number | null;
      job_id: number | null;
      movements: string[];
      steps: (number | null)[];
      touched: string[];
      crossed: Prisma.Decimal;
      doc_worked: Prisma.Decimal | null;
      doc_last: number | null;
      one_uom: boolean | null;
    } & StageSums)[]
  >`
    ${cardRows(own, cursor?.date ?? range.from, range.to)}
    SELECT * FROM w WHERE ${cursor ? Prisma.sql`(posting_date, id) > (${cursor.date}::date, ${cursor.id}::int)` : Prisma.sql`TRUE`}
     ORDER BY posting_date, id LIMIT ${ENTRY_PAGE_SIZE + 1}`;
  const page = rows.slice(0, ENTRY_PAGE_SIZE);
  const last = page[page.length - 1];
  const trackingIds = [...new Set(page.map((x) => x.tracking_id))];
  const [docs, steps, units, items, lots, partaiBy, jobBy, transfers] = await Promise.all([
    prisma.sysDocType.findMany({ where: { id: { in: [...new Set(page.map((x) => x.source_doc_type_id))] } }, select: { id: true, doc_table: true, doc_name: true } }),
    prisma.refUnitStep.findMany({ select: { id: true, process: true } }),
    prisma.refUnit.findMany({ select: { id: true, unit_label: true } }),
    prisma.mItem.findMany({ where: { id: { in: [...new Set(page.map((x) => x.item_id))] } }, select: ITEM_SELECT }),
    prisma.logStockTracking.findMany({ where: { id: { in: trackingIds } }, select: { id: true, tracking_no: true } }),
    partaiNosByIds(page.flatMap((x) => x.partai_id ?? [])),
    jobsByIds(page.flatMap((x) => x.job_id ?? [])),
    // The other Unit of a move, which a Unit's own rows do not hold.
    prisma.prdLedger.findMany({
      where: { tracking_id: { in: trackingIds }, source_doc_id: { in: [...new Set(page.map((x) => x.source_doc_id))] }, movement: { in: ["TransferOut", "TransferIn"] } },
      distinct: ["source_doc_type_id", "source_doc_id", "tracking_id", "unit_id"],
      select: { source_doc_type_id: true, source_doc_id: true, tracking_id: true, unit_id: true },
    }),
  ]);
  const docBy = new Map(docs.map((d) => [d.id, d]));
  const stepBy = new Map(steps.map((x) => [x.id, processText(x.process)]));
  const unitBy = new Map(units.map((u) => [u.id, u.unit_label]));
  const itemBy = new Map(items.map((i) => [i.id, itemRef(i)]));
  const lotBy = new Map(lots.map((l) => [l.id, l.tracking_no]));
  const hidden = partial(kind, f);
  const entries = page.map((x): ProductionCardEntry => {
    const stages = stagesOf(x);
    const crossed = num(x.crossed);
    const doc = docBy.get(x.source_doc_type_id);
    const other = transfers
      .filter((t) => t.source_doc_type_id === x.source_doc_type_id && t.source_doc_id === x.source_doc_id && t.tracking_id === x.tracking_id && t.unit_id !== x.unit_id)
      .map((t) => unitBy.get(t.unit_id) ?? "")
      .join(", ");
    return {
      id: x.id,
      date: iso(x.posting_date),
      source: { table: doc?.doc_table ?? "", id: x.source_doc_id, no: x.source_no },
      text: entryText({ crossed, movements: x.movements, stages, touched: x.touched }, doc?.doc_name ?? "", other),
      process: [...new Set(x.steps.flatMap((id) => (id ? (stepBy.get(id) ?? []) : [])))].join(" → "),
      unitLabel: unitBy.get(x.unit_id) ?? "",
      itemLabel: itemBy.get(x.item_id)?.label ?? "",
      uomLabel: itemBy.get(x.item_id)?.uomLabel ?? "",
      lotNo: lotBy.get(x.tracking_id) ?? "",
      partaiNo: x.partai_id ? (partaiBy.get(x.partai_id) ?? null) : null,
      jobNo: x.job_id ? (jobBy.get(x.job_id)?.no ?? null) : null,
      auxiliary: x.auxiliary,
      stages,
      crossed,
      shrinkage: !hidden && x.one_uom && x.doc_last === x.id ? round6(0 - num(x.doc_worked)) : null,
    };
  });
  return { entries, next: rows.length > ENTRY_PAGE_SIZE && last ? { date: iso(last.posting_date), id: last.id } : null };
}

/** The No. Stok behind typed numbers (any case), with the day each first moved in production (null: never). */
export async function productionLots(nos: string[]): Promise<{ id: number; no: string; first: string | null }[]> {
  if (!nos.length) return [];
  const lots = await prisma.logStockTracking.findMany({
    where: { OR: nos.map((no) => ({ tracking_no: { equals: no, mode: "insensitive" as const } })) },
    select: { id: true, tracking_no: true },
  });
  const first = await prisma.prdLedger.groupBy({ by: ["tracking_id"], where: { tracking_id: { in: lots.map((l) => l.id) } }, _min: { posting_date: true } });
  const at = new Map(first.map((x) => [x.tracking_id, x._min.posting_date]));
  return lots.map((l) => ({ id: l.id, no: l.tracking_no, first: at.get(l.id) ? iso(at.get(l.id)!) : null }));
}

// ---------------------------------------------------------- Telusur Produksi

/** `href`: the document that made the step (P318). */
export type TraceEdge = { sourceNo: string; href: string | null; stationLabel: string; qty: number; value: number };

export type TraceNode = {
  lotId: number;
  lotNo: string;
  itemLabel: string;
  itemName: string;
  uom: string;
  /** Steps from the start lots; 0 is the start. */
  depth: number;
  /** The executions between it and the lot one step nearer the start, with the unit they ran at. */
  via: TraceEdge[];
  /** Where the lot was registered and from whom, for a lot no execution made. */
  origin: { sourceNo: string; href: string | null; supplier: string | null } | null;
  /** Where it is now: at a unit, in stock, delivered. Shown for the start and the forward lots. */
  now: { production: { stationLabel: string; stage: string; qty: number }[]; stock: { where: string; qty: number }[]; delivered: { noteNo: string; date: string; to: string; qty: number }[] } | null;
};

export type TraceReport = { start: TraceNode[]; backward: TraceNode[]; forward: TraceNode[]; truncated: boolean };

const TRACE_NODE_CAP = 300;
const TRACE_DEPTH_CAP = 20;

/**
 * The genealogy of a lot number (R27): back through every execution to the
 * lots that came in from a supplier, and forward to where the goods are now —
 * at a unit, in stock, or delivered to a customer. Read from
 * `prd_tracking_link`, which every posted execution writes; every lot of the number
 * starts the walk (a lot is unique per item, P120).
 */
export async function traceReport(lotNo: string): Promise<TraceReport | null> {
  const startIds = (await prisma.logStockTracking.findMany({ where: { tracking_no: { equals: lotNo.trim(), mode: "insensitive" } }, select: { id: true } })).map((l) => l.id);
  if (!startIds.length) return null;

  const tables = new Map((await prisma.sysDocType.findMany({ select: { id: true, doc_table: true } })).map((t) => [t.id, t.doc_table]));
  const hrefOf = (typeId: number, id: number) => documentHref(tables.get(typeId) ?? "", id);
  const edgesOf = { back: new Map<number, Map<string, TraceEdge>>(), fwd: new Map<number, Map<string, TraceEdge>>() };
  const depths = { back: new Map<number, number>(), fwd: new Map<number, number>() };
  const walk = async (dir: "back" | "fwd") => {
    const seen = new Set<number>(startIds);
    let frontier = [...startIds];
    const order: number[] = [];
    let depth = 0;
    let truncated = false;
    while (frontier.length && depth < TRACE_DEPTH_CAP) {
      const links = await prisma.prdTrackingLink.findMany({
        where: dir === "back" ? { to_tracking_id: { in: frontier } } : { from_tracking_id: { in: frontier } },
        select: { from_tracking_id: true, to_tracking_id: true, source_doc_type_id: true, source_doc_id: true, source_no: true, qty: true, value: true, from_bucket: { select: { unit: { select: { unit_label: true } } } } },
      });
      depth += 1;
      const next: number[] = [];
      for (const l of links) {
        // Backward a node is an input lot, forward an output lot; each carries the execution between.
        const id = dir === "back" ? l.from_tracking_id : l.to_tracking_id;
        const edges = edgesOf[dir].get(id) ?? new Map<string, TraceEdge>();
        const e = edges.get(l.source_no) ?? { sourceNo: l.source_no, href: hrefOf(l.source_doc_type_id, l.source_doc_id), stationLabel: l.from_bucket.unit.unit_label, qty: 0, value: 0 };
        e.qty = round6(e.qty + num(l.qty));
        e.value += num(l.value);
        edges.set(l.source_no, e);
        edgesOf[dir].set(id, edges);
        if (seen.has(id)) continue;
        if (order.length >= TRACE_NODE_CAP) {
          truncated = true;
          continue;
        }
        seen.add(id);
        order.push(id);
        depths[dir].set(id, depth);
        next.push(id);
      }
      frontier = next;
    }
    return { order, truncated };
  };
  const [back, fwd] = await Promise.all([walk("back"), walk("fwd")]);

  const allIds = [...new Set([...startIds, ...back.order, ...fwd.order])];
  const lots = await prisma.logStockTracking.findMany({
    where: { id: { in: allIds } },
    include: { item: { select: { item_label: true, item_name: true, base_uom: { select: { uom_label: true } } } }, source_partner: { select: { partner_label: true, partner_name: true } } },
  });
  const lotBy = new Map(lots.map((l) => [l.id, l]));
  const made = new Set((await prisma.prdTrackingLink.findMany({ where: { to_tracking_id: { in: allIds } }, distinct: ["to_tracking_id"], select: { to_tracking_id: true } })).map((x) => x.to_tracking_id));
  const nowIds = [...new Set([...startIds, ...fwd.order])];
  const [held, stock, delivered] = await Promise.all([
    prisma.prdBalance.findMany({ where: { tracking_id: { in: nowIds }, qty_balance: { gt: 0 } }, include: { unit: { select: { unit_label: true } }, step: { select: { process: true } } } }),
    lotStockPositions(nowIds),
    deliveriesOfLots(nowIds),
  ]);
  const node = (id: number, dir: "back" | "fwd" | "start"): TraceNode => {
    const l = lotBy.get(id)!;
    return {
      lotId: id,
      lotNo: l.tracking_no,
      itemLabel: l.item.item_label,
      itemName: l.item.item_name,
      uom: l.item.base_uom.uom_label,
      depth: dir === "start" ? 0 : (depths[dir].get(id) ?? 1),
      via: dir === "start" ? [] : [...(edgesOf[dir].get(id)?.values() ?? [])],
      origin: dir !== "fwd" && !made.has(id) ? { sourceNo: l.source_no, href: hrefOf(l.source_doc_type_id, l.source_doc_id), supplier: l.source_partner ? `${l.source_partner.partner_label} · ${l.source_partner.partner_name}` : null } : null,
      now:
        dir === "back"
          ? null
          : {
              production: held.filter((h) => h.tracking_id === id).map((h) => ({ stationLabel: h.unit.unit_label, stage: stageText(h.stage, h.step?.process), qty: num(h.qty_balance) })),
              stock: stock.filter((s) => s.lotId === id).map((s) => ({ where: s.locationLabel ? `${s.warehouseLabel} · ${s.locationLabel}` : s.warehouseLabel, qty: s.qty })),
              delivered: delivered.filter((d) => d.lotId === id).map((d) => ({ noteNo: d.noteNo, date: d.date, to: `${d.partnerLabel} · ${d.partnerName}`, qty: d.baseQty })),
            },
    };
  };
  return {
    start: startIds.map((id) => node(id, "start")),
    backward: back.order.map((id) => node(id, "back")),
    forward: fwd.order.map((id) => node(id, "fwd")),
    truncated: back.truncated || fwd.truncated,
  };
}
