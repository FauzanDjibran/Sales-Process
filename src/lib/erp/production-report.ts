import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { RefOption } from "./records";
import { formatNumber } from "@/lib/format";
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
const STAGE_ORDER = ["Preparation", "Working", "QcCheck", "StandBy", "InTransit"];

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
  /** Persiapan <proses>, Sedang Dikerjakan, QC Check, Stand By, Dalam Perjalanan (P305). */
  stage: string;
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
 * through a Unit, then by item and No. Stok; the page groups them.
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
  // Persiapan and Sedang Dikerjakan of a process come together, processes in their order.
  const place = (b: (typeof buckets)[number]) => (b.step ? b.step.seq * 10 : 1000) + STAGE_ORDER.indexOf(b.stage);
  return buckets
    .sort(
      (a, b) =>
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
      stage: stageText(b.stage, b.step?.process),
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
 * Kartu Produksi (P310): the production ledger as cards, one per item × Unit,
 * or one per No. Stok across every Unit. A card nets what one document did to
 * one No. Stok on one day, because a move between stages of a Unit (39 % of the
 * book) neither brings goods into it nor takes them out; those rows are shown
 * only on request and carry no figure. Nothing here holds a price (P275).
 */
export type ProductionCardKind = "unit" | "lot";
export type ProductionCardFilter = { unitIds: number[]; itemIds: number[]; lotIds: number[] };

export type ProductionCard = {
  key: string;
  item: ProductionItemRef;
  /** The Unit of an item × Unit card. */
  unit: ProductionUnitRef | null;
  /** The No. Stok of a No. Stok card. */
  lot: { no: string; sourceNo: string; supplier: string | null; expiry: string | null; now: string[] } | null;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  entryCount: number;
};

export type ProductionCardEntry = {
  id: number;
  date: string;
  ledgerNo: string;
  source: { table: string; id: number; no: string };
  text: string;
  /** Where inside the Unit, `Persiapan Grading → Stand By`. */
  stages: string;
  unitLabel: string;
  lotNo: string;
  partaiNo: string | null;
  jobNo: string | null;
  /** Net, signed; 0 for a move that brought nothing in or out. */
  change: number;
};

const CARD_LIMIT = 300;

const cardWhere = (f: ProductionCardFilter) => Prisma.sql`${inIds("unit_id", f.unitIds)} ${inIds("item_id", f.itemIds)} ${inIds("tracking_id", f.lotIds)}`;
const subjectCols = (kind: ProductionCardKind) => Prisma.raw(kind === "unit" ? "item_id, unit_id" : "item_id, tracking_id");
/** What one row of a card is: one document, one No. Stok, one day (in one Unit). */
const entryCols = (kind: ProductionCardKind) =>
  Prisma.raw(`posting_date, source_doc_type_id, source_doc_id, item_id, tracking_id${kind === "unit" ? ", unit_id" : ""}`);
/** A move between Units is worth a row on a No. Stok card; one between stages only when asked for. */
const shown = (kind: ProductionCardKind, stages: boolean) =>
  stages ? Prisma.sql`TRUE` : kind === "lot" ? Prisma.sql`(SUM(qty_change) <> 0 OR COUNT(DISTINCT unit_id) > 1)` : Prisma.sql`SUM(qty_change) <> 0`;

type Subject = { item_id: number; unit_id?: number; tracking_id?: number };
const subjectKey = (kind: ProductionCardKind, s: Subject) => `${s.item_id}:${kind === "unit" ? s.unit_id : s.tracking_id}`;

/** The cards with an opening or a movement, figures from the database's own sums; No. Stok cards stop at a limit. */
export async function productionCardReport(
  kind: ProductionCardKind,
  f: ProductionCardFilter,
  range: { from: string; to: string },
  stages: boolean
): Promise<{ cards: ProductionCard[]; truncated: boolean }> {
  const [before, moved] = await Promise.all([
    prisma.$queryRaw<(Subject & { qty: Prisma.Decimal })[]>`
      SELECT ${subjectCols(kind)}, SUM(qty_change) AS qty FROM prd_ledger
       WHERE posting_date < ${range.from}::date ${cardWhere(f)}
       GROUP BY ${subjectCols(kind)} HAVING SUM(qty_change) <> 0`,
    prisma.$queryRaw<(Subject & { qin: Prisma.Decimal; qout: Prisma.Decimal; n: bigint })[]>`
      SELECT ${subjectCols(kind)}, SUM(GREATEST(net, 0)) AS qin, SUM(GREATEST(-net, 0)) AS qout, COUNT(*) FILTER (WHERE seen) AS n
        FROM (SELECT ${entryCols(kind)}, SUM(qty_change) AS net, ${shown(kind, stages)} AS seen FROM prd_ledger
               WHERE posting_date BETWEEN ${range.from}::date AND ${range.to}::date ${cardWhere(f)}
               GROUP BY ${entryCols(kind)}) e
       GROUP BY ${subjectCols(kind)}`,
  ]);
  const acc = new Map<string, Subject & { opening: number; qin: number; qout: number; n: number }>();
  for (const b of before) acc.set(subjectKey(kind, b), { ...b, opening: num(b.qty), qin: 0, qout: 0, n: 0 });
  for (const m of moved) {
    const k = subjectKey(kind, m);
    acc.set(k, { ...m, opening: acc.get(k)?.opening ?? 0, qin: num(m.qin), qout: num(m.qout), n: Number(m.n) });
  }
  // A card that stood at nothing and only moved between stages has nothing to say unless they are shown.
  const all = [...acc].filter(([, c]) => c.opening !== 0 || c.n > 0);
  const ids = (pick: (s: Subject) => number | undefined) => [...new Set(all.flatMap(([, c]) => pick(c) ?? []))];
  const [items, units, lots] = await Promise.all([
    prisma.mItem.findMany({ where: { id: { in: ids((s) => s.item_id) } }, select: ITEM_SELECT }),
    prisma.refUnit.findMany({ where: { id: { in: ids((s) => s.unit_id) } }, select: UNIT_SELECT }),
    kind === "lot"
      ? prisma.logStockTracking.findMany({
          where: { id: { in: ids((s) => s.tracking_id) } },
          orderBy: { tracking_no: "asc" },
          take: CARD_LIMIT,
          include: { source_partner: { select: { partner_label: true, partner_name: true } } },
        })
      : [],
  ]);
  const held = lots.length
    ? await prisma.prdBalance.findMany({
        where: { tracking_id: { in: lots.map((l) => l.id) }, qty_balance: { gt: 0 } },
        include: { unit: { select: { unit_label: true } }, step: { select: { process: true } } },
      })
    : [];
  const itemBy = new Map(items.map((i) => [i.id, itemRef(i)]));
  const unitBy = new Map(units.map((u) => [u.id, unitRef(u)]));
  const lotBy = new Map(lots.map((l) => [l.id, l]));
  const cards = all
    .filter(([, c]) => kind === "unit" || lotBy.has(c.tracking_id!))
    .map(([key, c]): ProductionCard => {
      const item = itemBy.get(c.item_id)!;
      const l = kind === "lot" ? lotBy.get(c.tracking_id!)! : null;
      return {
        key,
        item,
        unit: kind === "unit" ? unitBy.get(c.unit_id!)! : null,
        lot: l && {
          no: l.tracking_no,
          sourceNo: l.source_no,
          supplier: l.source_partner ? `${l.source_partner.partner_label} · ${l.source_partner.partner_name}` : null,
          expiry: l.expiry_date ? iso(l.expiry_date) : null,
          now: held.filter((h) => h.tracking_id === l.id).map((h) => `${h.unit.unit_label} · ${stageText(h.stage, h.step?.process)} · ${formatNumber(num(h.qty_balance), h.qty_balance.isInteger() ? 0 : 4)} ${item.uomLabel}`),
        },
        opening: c.opening,
        totalIn: c.qin,
        totalOut: c.qout,
        closing: round6(c.opening + c.qin - c.qout),
        entryCount: c.n,
      };
    })
    .sort((a, b) =>
      kind === "lot" ? a.lot!.no.localeCompare(b.lot!.no) : a.unit!.label.localeCompare(b.unit!.label) || a.item.label.localeCompare(b.item.label)
    );
  return { cards, truncated: kind === "lot" && all.length > CARD_LIMIT };
}

type Place = { unitId: number; stage: string; stepId: number };
const places = (raw: string[] | null): Place[] =>
  (raw ?? []).map((p) => {
    const [unitId, stage, stepId] = p.split(":");
    return { unitId: Number(unitId), stage, stepId: Number(stepId) };
  });

/** What a netted row says happened, from the kinds of movement in it. */
function entryText(change: number, movements: string[], docName: string, from: string[], to: string[]): string {
  const has = (m: string) => movements.includes(m);
  if (change > 0) return has("Issued") ? "Dari gudang" : has("TransferIn") ? (from.length ? `Dari ${from.join(", ")}` : "Pindah masuk") : `Hasil ${docName}`;
  if (change < 0) return has("Released") ? "Ke gudang" : has("TransferOut") ? (to.length ? `Ke ${to.join(", ")}` : "Pindah keluar") : `Dipakai ${docName}`;
  return from.length && to.length ? `${from.join(", ")} → ${to.join(", ")}` : docName;
}

/** One page of a card's netted rows, by date then the order they were posted. */
export async function productionCardEntriesPage(
  kind: ProductionCardKind,
  subject: { itemId: number; ofId: number },
  f: ProductionCardFilter,
  range: { from: string; to: string },
  stages: boolean,
  cursor: BookCursor | null
): Promise<{ entries: ProductionCardEntry[]; next: BookCursor | null }> {
  // The card's own Unit or No. Stok takes the place of that filter.
  const own: ProductionCardFilter = {
    itemIds: [subject.itemId],
    unitIds: kind === "unit" ? [subject.ofId] : f.unitIds,
    lotIds: kind === "lot" ? [subject.ofId] : f.lotIds,
  };
  const rows = await prisma.$queryRaw<
    {
      id: number;
      posting_date: Date;
      ledger_no: string;
      source_doc_type_id: number;
      source_doc_id: number;
      source_no: string;
      tracking_id: number;
      partai_id: number | null;
      job_id: number | null;
      net: Prisma.Decimal;
      movements: string[];
      outs: string[] | null;
      ins: string[] | null;
    }[]
  >`
    SELECT MIN(id) AS id, posting_date, MIN(ledger_no) AS ledger_no, source_doc_type_id, source_doc_id, MIN(source_no) AS source_no, tracking_id,
           MAX(partai_id) AS partai_id, MAX(job_id) AS job_id, SUM(qty_change) AS net, array_agg(DISTINCT movement::text) AS movements,
           array_agg(DISTINCT unit_id || ':' || stage::text || ':' || COALESCE(unit_step_id, 0)) FILTER (WHERE qty_change < 0) AS outs,
           array_agg(DISTINCT unit_id || ':' || stage::text || ':' || COALESCE(unit_step_id, 0)) FILTER (WHERE qty_change > 0) AS ins
      FROM prd_ledger
     WHERE posting_date BETWEEN ${cursor?.date ?? range.from}::date AND ${range.to}::date ${cardWhere(own)}
     GROUP BY ${entryCols(kind)}
    HAVING ${shown(kind, stages)} ${cursor ? Prisma.sql`AND (posting_date, MIN(id)) > (${cursor.date}::date, ${cursor.id}::int)` : Prisma.empty}
     ORDER BY posting_date, MIN(id) LIMIT ${ENTRY_PAGE_SIZE + 1}`;
  const page = rows.slice(0, ENTRY_PAGE_SIZE);
  const last = page[page.length - 1];
  const docIds = [...new Set(page.map((r) => r.source_doc_id))];
  const trackingIds = [...new Set(page.map((r) => r.tracking_id))];
  const [docs, steps, units, lots, partaiBy, jobBy, transfers] = await Promise.all([
    prisma.sysDocType.findMany({ where: { id: { in: [...new Set(page.map((r) => r.source_doc_type_id))] } }, select: { id: true, doc_table: true, doc_name: true } }),
    prisma.refUnitStep.findMany({ select: { id: true, process: true } }),
    prisma.refUnit.findMany({ select: { id: true, unit_label: true } }),
    prisma.logStockTracking.findMany({ where: { id: { in: trackingIds } }, select: { id: true, tracking_no: true } }),
    partaiNosByIds(page.flatMap((r) => r.partai_id ?? [])),
    jobsByIds(page.flatMap((r) => r.job_id ?? [])),
    // The other Unit of a move, which a Unit's own rows do not hold.
    prisma.prdLedger.findMany({
      where: { tracking_id: { in: trackingIds }, source_doc_id: { in: docIds }, movement: { in: ["TransferOut", "TransferIn"] } },
      distinct: ["source_doc_type_id", "source_doc_id", "tracking_id", "unit_id"],
      select: { source_doc_type_id: true, source_doc_id: true, tracking_id: true, unit_id: true },
    }),
  ]);
  const docBy = new Map(docs.map((d) => [d.id, d]));
  const stepBy = new Map(steps.map((s) => [s.id, s.process]));
  const unitBy = new Map(units.map((u) => [u.id, u.unit_label]));
  const lotBy = new Map(lots.map((l) => [l.id, l.tracking_no]));
  const entries = page.map((r): ProductionCardEntry => {
    const out = places(r.outs);
    const into = places(r.ins);
    const key = (p: Place) => `${p.unitId}:${p.stage}:${p.stepId}`;
    // Where it left for good and where it ended, not the places it passed through in one document.
    const left = out.filter((o) => !into.some((i) => key(i) === key(o)));
    const ended = into.filter((i) => !out.some((o) => key(o) === key(i)));
    const unitIds = new Set([...out, ...into].map((p) => p.unitId));
    const others = transfers
      .filter((t) => t.source_doc_type_id === r.source_doc_type_id && t.source_doc_id === r.source_doc_id && t.tracking_id === r.tracking_id && !unitIds.has(t.unit_id))
      .map((t) => unitBy.get(t.unit_id) ?? "");
    const names = (ps: Place[]) => [...new Set(ps.map((p) => unitBy.get(p.unitId) ?? ""))];
    const crossed = unitIds.size > 1;
    const change = num(r.net);
    const stageNames = (ps: Place[]) => [...new Set(ps.map((p) => stageText(p.stage, stepBy.get(p.stepId))))].join(", ");
    const doc = docBy.get(r.source_doc_type_id);
    return {
      id: r.id,
      date: iso(r.posting_date),
      ledgerNo: r.ledger_no,
      source: { table: doc?.doc_table ?? "", id: r.source_doc_id, no: r.source_no },
      text: entryText(change, r.movements, doc?.doc_name ?? "", crossed ? names(left) : change > 0 ? others : [], crossed ? names(ended) : change < 0 ? others : []),
      stages: [stageNames(left), stageNames(ended)].filter(Boolean).join(" → "),
      unitLabel: names([...left, ...ended]).join(" → ") || names([...out, ...into]).join(", "),
      lotNo: lotBy.get(r.tracking_id) ?? "",
      partaiNo: r.partai_id ? (partaiBy.get(r.partai_id) ?? null) : null,
      jobNo: r.job_id ? (jobBy.get(r.job_id)?.no ?? null) : null,
      change,
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

export type TraceEdge = { sourceNo: string; stationLabel: string; qty: number; value: number };

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
  origin: { sourceNo: string; supplier: string | null } | null;
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
        select: { from_tracking_id: true, to_tracking_id: true, source_no: true, qty: true, value: true, from_bucket: { select: { unit: { select: { unit_label: true } } } } },
      });
      depth += 1;
      const next: number[] = [];
      for (const l of links) {
        // Backward a node is an input lot, forward an output lot; each carries the execution between.
        const id = dir === "back" ? l.from_tracking_id : l.to_tracking_id;
        const edges = edgesOf[dir].get(id) ?? new Map<string, TraceEdge>();
        const e = edges.get(l.source_no) ?? { sourceNo: l.source_no, stationLabel: l.from_bucket.unit.unit_label, qty: 0, value: 0 };
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
      origin: dir !== "fwd" && !made.has(id) ? { sourceNo: l.source_no, supplier: l.source_partner ? `${l.source_partner.partner_label} · ${l.source_partner.partner_name}` : null } : null,
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
