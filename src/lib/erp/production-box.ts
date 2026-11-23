import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { holdPostingPeriod } from "./fiscal";
import { DAY, Refused, asDate, docTypeId, isoDay, postToErp, nextDailyNumber, refusable, unitSeries, type ValueMove } from "./production-doc";
import { boxRuleErrors, type BoxRule } from "./production-box-shape";
import {
  availableBuckets,
  bucketsByIds,
  consumeBucket,
  linkTracking,
  lockRateVersion,
  produceIntoBucket,
  chargeUnit,
  type CostCharge,
  recordTrackingInfo,
  partaiNosByIds,
  registerAssembledStock,
  trackingsByIds,
  unitStepsOf,
  type BucketView,
} from "./production-ledger";

/**
 * Kotak at Packing 95 (P284, T12; W112–W116). The operator picks a Nama Jual —
 * its active BoM Packing says target gram ± tolerance, the piece count and the
 * bahan penolong per kotak — fills the kotak from the pieces in Persiapan of the
 * Unit's Assembly step (recommended, scanned or put in by hand, a hand-put piece
 * marked Manual), gives each a unique CAIQ, and presses **Tutup Kotak**. The
 * pieces leave whole; one new No. Stok `KTK-<ddmmyy>-<nnn>` of the Nama Jual item
 * is born in Stand By with no Job (W92 gives it one on the way out). Its value is
 * the pieces, the Unit rate per gram of pieces (Assembly is its last step, P281)
 * and the bahan penolong used, from the Unit's own balance. No Draft.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type BoxPieceInput = { bucket_id: number | null; caiq: string; manual: boolean };
export type BoxInput = { unit_id: number | null; box_date: string; bom_id: number | null; pieces: BoxPieceInput[] };
export type BoxResult = { ok: true; id: number; no: string; trackingNo: string } | { ok: false; errors: Record<string, string> };

export type BomView = BoxRule & { id: number; label: string; itemId: number; itemLabel: string; itemName: string; components: { itemId: number; itemLabel: string; itemName: string; qty: number }[] };

async function activeBoms(db: Db): Promise<BomView[]> {
  const rows = await db.prdBom.findMany({
    where: { status: "Active", item: { status: "Active" } },
    orderBy: { bom_label: "asc" },
    include: { item: { select: { item_label: true, item_name: true } }, components: { orderBy: { sort_order: "asc" }, include: { item: { select: { item_label: true, item_name: true } } } } },
  });
  return rows.map((b) => ({
    id: b.id,
    label: b.bom_label,
    itemId: b.item_id,
    itemLabel: b.item.item_label,
    itemName: b.item.item_name,
    target: b.target_grams.toNumber(),
    tolerance: b.tolerance_grams.toNumber(),
    minPieces: b.min_pieces,
    maxPieces: b.max_pieces,
    components: b.components.map((c) => ({ itemId: c.item_id, itemLabel: c.item.item_label, itemName: c.item.item_name, qty: c.qty.toNumber() })),
  }));
}

async function check(db: Db, input: BoxInput) {
  const errors: Record<string, string> = {};
  const unitId = Number(input.unit_id) || null;
  const unit = unitId ? await db.refUnit.findUnique({ where: { id: unitId } }) : null;
  const step = unit ? (await unitStepsOf(db, unit.id)).find((s) => s.process === "Assembly") : undefined;
  if (!unit) errors.unit_id = "Pilih Unit.";
  else if (!step) errors.unit_id = `${unit.unit_label} tidak merakit kotak.`;
  if (!DAY.test(input.box_date)) errors.box_date = "Isi tanggal.";
  const bom = (await activeBoms(db)).find((b) => b.id === Number(input.bom_id));
  if (!bom) errors.bom_id = "Pilih Nama Jual dengan BoM Packing aktif.";

  const raw = Array.isArray(input.pieces) ? input.pieces : [];
  const buckets = await bucketsByIds(raw.flatMap((p) => (p.bucket_id ? [Number(p.bucket_id)] : [])), db);
  const pieces: { bucket: BucketView; caiq: string; manual: boolean }[] = [];
  const seen = new Set<number>();
  raw.forEach((p, i) => {
    const b = buckets.get(Number(p.bucket_id));
    if (!b || b.unitId !== unit?.id || b.stage !== "Preparation" || b.stepId !== step?.id || b.auxiliary || !(b.qty > 0) || b.grams == null) {
      errors[`pieces.${i}`] = "Keping ini tidak lagi di Persiapan unit ini.";
      return;
    }
    if (seen.has(b.id)) {
      errors[`pieces.${i}`] = `${b.lotNo} dimasukkan lebih dari sekali.`;
      return;
    }
    seen.add(b.id);
    pieces.push({ bucket: b, caiq: String(p.caiq ?? "").trim().toUpperCase(), manual: Boolean(p.manual) });
  });
  if (!unit || !step || !bom || Object.keys(errors).length) return { ok: false as const, errors };
  const rule = boxRuleErrors(bom, pieces.map((p) => ({ grams: p.bucket.grams!, caiq: p.caiq })));
  if (rule.length) return { ok: false as const, errors: { _pieces: rule.join(" ") } };
  const used = await db.prdBoxPiece.findMany({ where: { caiq: { in: pieces.map((p) => p.caiq) } }, select: { caiq: true } });
  if (used.length) return { ok: false as const, errors: { _pieces: `No. CAIQ ${used.map((u) => u.caiq).join(", ")} sudah dipakai kotak lain.` } };

  // Bahan penolong per kotak, from the Unit's own balance (W70).
  const aux = (await availableBuckets({ unitIds: [unit.id] }, db)).filter((b) => b.auxiliary && b.qty > 0);
  const takes: { itemId: number; bucket: BucketView; qty: number }[] = [];
  for (const c of bom.components) {
    let need = c.qty;
    for (const b of aux.filter((x) => x.itemId === c.itemId)) {
      if (need <= 0) break;
      const q = Math.min(need, b.qty);
      takes.push({ itemId: c.itemId, bucket: b, qty: q });
      need = Math.round((need - q) * 1e6) / 1e6;
    }
    if (need > 0) return { ok: false as const, errors: { _pieces: `Bahan penolong ${c.itemLabel} di ${unit.unit_label} tidak cukup (kurang ${need}).` } };
  }
  const partais = new Set(pieces.map((p) => p.bucket.partaiId));
  return { ok: true as const, unit, step, bom, pieces, takes, partaiId: partais.size === 1 ? pieces[0].bucket.partaiId : null, date: asDate(input.box_date) };
}

async function nextNo(tx: Prisma.TransactionClient, series: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${series}))`;
  const row = await tx.prdBox.findFirst({ where: { box_doc_no: { startsWith: series } }, orderBy: { box_doc_no: "desc" }, select: { box_doc_no: true } });
  return nextDailyNumber(series, row?.box_doc_no ?? null);
}

/** Tutup Kotak: the pieces and bahan penolong leave, the kotak is born in Stand By. */
export async function closeBox(input: BoxInput, actorId: number): Promise<BoxResult> {
  const first = await check(prisma, input);
  if (!first.ok) return first;
  return refusable(async () =>
    prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, input.box_date);
      const c = await check(tx, input);
      if (!c.ok) throw new Refused(c.errors);
      const no = await nextNo(tx, unitSeries("ASM", c.unit.unit_label, c.date));
      const docType = await docTypeId(tx, "prd_box");
      const grams = c.pieces.reduce((a, p) => a + p.bucket.grams!, 0);
      // The kotak's No. Stok names this document, so the header comes first; its stock fields are filled below.
      const header = await tx.prdBox.create({
        data: { box_doc_no: no, box_date: c.date, unit_id: c.unit.id, unit_step_id: c.step.id, bom_id: c.bom.id, item_id: c.bom.itemId, partai_id: c.partaiId, tracking_id: 0, tracking_no: no, grams, pieces: c.pieces.length, to_bucket_id: 0, created_by: actorId },
      });
      const source = { docTypeId: docType, docId: header.id, no };
      const made = await registerAssembledStock(tx, { prefix: "KTK", itemId: c.bom.itemId, ...{ date: c.date, source, actorId } });
      const common = { date: c.date, source, actorId };
      const moves: ValueMove[] = [];
      const costs: (CostCharge | null)[] = [];

      let pieceValue = 0;
      let cost = 0;
      let rate: { rateVersionId: number; routingId: number | null } | null = null;
      for (const [i, p] of c.pieces.entries()) {
        const t = await consumeBucket(tx, { bucketId: p.bucket.id, baseQty: p.bucket.qty, ...common });
        const locked = await lockRateVersion(tx, { lotId: t.lotId, partaiId: t.partaiId, actorId });
        rate ??= locked;
        const charged = await chargeUnit(tx, { unitId: c.unit.id, stepId: c.step.id, rateVersionId: locked.rateVersionId, lotId: t.lotId, partaiId: t.partaiId, grams: p.bucket.grams!, date: c.date });
        costs.push(charged.charge);
        pieceValue += t.value;
        cost += charged.amount;
        moves.push({ itemId: t.itemId, amount: -t.value });
        await linkTracking(tx, { fromBucketId: p.bucket.id, fromLotId: t.lotId, toLotId: made.id, qty: p.bucket.qty, value: t.value, source });
        await tx.prdBoxPiece.create({ data: { box_id: header.id, line_no: i + 1, bucket_id: p.bucket.id, tracking_id: t.lotId, partai_id: t.partaiId, grams: p.bucket.grams!, value: t.value, caiq: p.caiq, is_manual: p.manual } });
      }
      let auxValue = 0;
      for (const a of c.takes) {
        const used = await consumeBucket(tx, { bucketId: a.bucket.id, baseQty: a.qty, ...common });
        auxValue += used.value;
        moves.push({ itemId: a.itemId, amount: -used.value });
        await tx.prdBoxComponent.create({ data: { box_id: header.id, item_id: a.itemId, bucket_id: a.bucket.id, qty: a.qty, value: used.value } });
      }
      const value = pieceValue + cost + auxValue;
      await recordTrackingInfo(tx, { lotId: made.id, grams, form: "Piece", rateVersionId: rate!.rateVersionId, routingId: rate!.routingId, actorId });
      const placed = await produceIntoBucket(tx, { lotId: made.id, itemId: c.bom.itemId, unitId: c.unit.id, afterStepId: c.step.id, partaiId: c.partaiId, jobId: null, baseQty: 1, value, ...common });
      moves.push({ itemId: c.bom.itemId, amount: value });

      const posted = await postToErp(tx, { source, docTable: "prd_box", date: c.date, description: `${no} · Kotak ${made.no}`, moves, costs, actorId });
      await tx.prdBox.update({ where: { id: header.id }, data: { tracking_id: made.id, tracking_no: made.no, piece_value: pieceValue, cost_amount: cost, aux_value: auxValue, value, to_bucket_id: placed.bucketId, journal_id: posted.journalId } });
      await tx.auditLog.create({ data: { entity_key: "prd_box", row_id: header.id, action: "TAMBAH", event: "post", by: actorId } });
      return { ok: true as const, id: header.id, no, trackingNo: made.no };
    })
  );
}

// -------------------------------------------------------------------- reads

export type BoxRow = { id: number; no: string; date: string; unitId: number; unitLabel: string; trackingNo: string; itemLabel: string; itemName: string; bomLabel: string; partaiNo: string | null; pieces: number; grams: number };

const boxInclude = { unit: { select: { unit_label: true } }, item: { select: { item_label: true, item_name: true } }, bom: { select: { bom_label: true } }, partai: { select: { partai_no: true } } } as const;
type BoxRecord = Prisma.PrdBoxGetPayload<{ include: typeof boxInclude }>;
const toRow = (r: BoxRecord): BoxRow => ({
  id: r.id,
  no: r.box_doc_no,
  date: isoDay(r.box_date),
  unitId: r.unit_id,
  unitLabel: r.unit.unit_label,
  trackingNo: r.tracking_no,
  itemLabel: r.item.item_label,
  itemName: r.item.item_name,
  bomLabel: r.bom.bom_label,
  partaiNo: r.partai?.partai_no ?? null,
  pieces: r.pieces,
  grams: r.grams.toNumber(),
});

export async function listBoxes(units: number[] | null = null): Promise<BoxRow[]> {
  const rows = await prisma.prdBox.findMany({ where: units ? { unit_id: { in: units } } : undefined, orderBy: [{ box_date: "desc" }, { id: "desc" }], include: boxInclude });
  return rows.map(toRow);
}

export type BoxView = BoxRow & {
  pieceList: { lineNo: number; lotNo: string; partaiNo: string | null; grams: number; caiq: string; manual: boolean }[];
  components: { itemLabel: string; itemName: string; qty: number }[];
};

export async function getBox(id: number): Promise<BoxView | null> {
  const b = await prisma.prdBox.findUnique({ where: { id }, include: { ...boxInclude, pieceRows: { orderBy: { line_no: "asc" } }, components: true } });
  if (!b) return null;
  const [lots, partais, items] = await Promise.all([
    trackingsByIds(b.pieceRows.map((p) => p.tracking_id)),
    partaiNosByIds(b.pieceRows.flatMap((p) => (p.partai_id ? [p.partai_id] : []))),
    prisma.mItem.findMany({ where: { id: { in: b.components.map((c) => c.item_id) } }, select: { id: true, item_label: true, item_name: true } }),
  ]);
  const partai = partais;
  const item = new Map(items.map((i) => [i.id, i]));
  const byItem = new Map<number, number>();
  for (const c of b.components) byItem.set(c.item_id, (byItem.get(c.item_id) ?? 0) + c.qty.toNumber());
  return {
    ...toRow(b),
    pieceList: b.pieceRows.map((p) => ({ lineNo: p.line_no, lotNo: lots.get(p.tracking_id)?.no ?? "", partaiNo: p.partai_id ? (partai.get(p.partai_id) ?? null) : null, grams: p.grams.toNumber(), caiq: p.caiq, manual: p.is_manual })),
    components: [...byItem].map(([itemId, qty]) => ({ itemLabel: item.get(itemId)?.item_label ?? "", itemName: item.get(itemId)?.item_name ?? "", qty })),
  };
}

export async function boxNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.prdBox.findMany({ where: { id: { in: ids } }, select: { id: true, box_doc_no: true } });
  return new Map(rows.map((r) => [r.id, r.box_doc_no]));
}

export type BoxOptions = {
  unit: { id: number; label: string; name: string };
  boms: BomView[];
  pieces: { id: number; lotNo: string; itemLabel: string; partaiId: number | null; partaiNo: string | null; grams: number }[];
  aux: { itemId: number; qty: number }[];
};

/** What the Kotak form works from: the Unit's pieces in Persiapan, the active BoMs and the bahan penolong held. */
export async function boxOptions(unitId: number): Promise<BoxOptions | null> {
  const unit = await prisma.refUnit.findUnique({ where: { id: unitId }, select: { id: true, unit_label: true, unit_name: true } });
  if (!unit) return null;
  const step = (await unitStepsOf(prisma, unitId)).find((s) => s.process === "Assembly");
  if (!step) return null;
  const [held, boms] = await Promise.all([availableBuckets({ unitIds: [unitId] }), activeBoms(prisma)]);
  const aux = new Map<number, number>();
  for (const b of held.filter((x) => x.auxiliary && x.qty > 0)) aux.set(b.itemId, (aux.get(b.itemId) ?? 0) + b.qty);
  return {
    unit: { id: unit.id, label: unit.unit_label, name: unit.unit_name },
    boms,
    pieces: held
      .filter((b) => b.stage === "Preparation" && b.stepId === step.id && !b.auxiliary && b.qty > 0 && b.grams != null)
      .map((b) => ({ id: b.id, lotNo: b.lotNo, itemLabel: b.itemLabel, partaiId: b.partaiId, partaiNo: b.partaiNo, grams: b.grams! })),
    aux: [...aux].map(([itemId, qty]) => ({ itemId, qty })),
  };
}
