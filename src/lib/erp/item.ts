import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { parseList } from "./partner-shape";
import { UOMS_KEY, uomErrors, type UomDraft } from "./item-shape";

/**
 * An Item's own collection — its alternate units and their conversion to the
 * base unit — and the rule tying an Item to a Kategori of its own type.
 *
 * The conversions are part of the Item, not records of their own: edited on
 * its form, saved with it in one transaction, and a change to them is the
 * Item's own audit entry (Claude-ERP.md P46). The generic master action calls
 * in here for the one entity that has them.
 */

// -------------------------------------------------------------------- reads

/** An Item's conversions in the shape the form edits them. */
export async function itemCollections(itemId: number): Promise<{ uoms: UomDraft[] }> {
  const rows = await prisma.mItemUom.findMany({
    where: { item_id: itemId },
    orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    include: { uom: true },
  });
  return {
    uoms: rows.map((r) => ({
      id: r.id,
      key: `u${r.id}`,
      uomId: r.uom_id,
      factor: r.factor.toString(),
      uomLabel: r.uom.uom_label,
      uomName: r.uom.uom_name,
    })),
  };
}

// --------------------------------------------------------------- validation

export type ItemCollections = {
  uoms: { id: number | null; uomId: number; factor: string }[];
};

/**
 * Reads and checks the conversions an Item form submits.
 *
 * Every rule the dialog applies is applied again here — against the base unit
 * the form is saving, not the one it was opened with — plus two it cannot: a
 * unit must exist and be active (a unit already on this item may stay even if
 * it has since been deactivated), and a row id must be one of this Item's own.
 */
export async function checkItemCollections(
  values: Record<string, unknown>,
  itemId: number | null
): Promise<{ errors: Record<string, string>; clean: ItemCollections }> {
  const errors: Record<string, string> = {};
  const clean: ItemCollections = { uoms: [] };

  const list = parseList<Partial<UomDraft>>(values[UOMS_KEY]);
  if (list === null) {
    errors[UOMS_KEY] = "Data konversi satuan tidak terbaca.";
    return { errors, clean };
  }

  const own = itemId
    ? await prisma.mItemUom.findMany({ where: { item_id: itemId }, select: { id: true, uom_id: true } })
    : [];
  const ownIds = new Set(own.map((o) => o.id));
  const ownUoms = new Set(own.map((o) => o.uom_id));
  const baseUomId = Number(values.base_uom_id) || null;

  const units = await prisma.refUom.findMany({
    where: { id: { in: list.map((u) => Number(u.uomId)).filter(Boolean) } },
    select: { id: true, status: true, uom_label: true },
  });
  const unit = new Map(units.map((u) => [u.id, u]));

  const problems: string[] = [];
  const taken: number[] = [];
  for (const [i, u] of list.entries()) {
    const n = i + 1;
    const rowErrors = uomErrors(u, baseUomId, taken);
    if (Object.keys(rowErrors).length) {
      problems.push(`Konversi ${n}: ${Object.values(rowErrors)[0]}`);
      continue;
    }
    const uomId = Number(u.uomId);
    taken.push(uomId);

    const found = unit.get(uomId);
    if (!found) {
      problems.push(`Konversi ${n}: satuan tidak ditemukan.`);
      continue;
    }
    if (found.status !== "Active" && !ownUoms.has(uomId)) {
      problems.push(`Konversi ${n}: satuan ${found.uom_label} sudah nonaktif.`);
      continue;
    }

    let id: number | null = null;
    if (u.id != null && u.id !== ("" as unknown)) {
      const asNumber = Number(u.id);
      if (!ownIds.has(asNumber)) {
        problems.push(`Konversi ${n}: bukan konversi milik item ini.`);
        continue;
      }
      id = asNumber;
    }
    clean.uoms.push({ id, uomId, factor: String(u.factor).trim() });
  }
  if (problems.length) errors[UOMS_KEY] = problems.join(" ");

  return { errors, clean };
}

/**
 * The Kategori must exist, be active (unless it is the one the item already
 * has) and belong to the item's own type.
 */
export async function checkItemCategory(
  values: Record<string, unknown>,
  itemId: number | null
): Promise<Record<string, string>> {
  const categoryId = Number(values.category_id) || null;
  const type = String(values.item_type ?? "");
  if (!categoryId || !type) return {};

  const category = await prisma.sysItemCategory.findUnique({ where: { id: categoryId } });
  if (!category) return { category_id: "Kategori tidak ditemukan." };
  if (category.item_type !== type) {
    return { category_id: `Kategori ${category.category_name} bukan untuk tipe ${type}.` };
  }
  if (category.status !== "Active") {
    const current = itemId
      ? await prisma.mItem.findUnique({ where: { id: itemId }, select: { category_id: true } })
      : null;
    if (current?.category_id !== categoryId) {
      return { category_id: `Kategori ${category.category_name} sudah nonaktif.` };
    }
  }
  return {};
}

/** The base unit must exist and be active, unless the item already has it. */
export async function checkItemBaseUom(
  values: Record<string, unknown>,
  itemId: number | null
): Promise<Record<string, string>> {
  const uomId = Number(values.base_uom_id) || null;
  if (!uomId) return {};
  const uom = await prisma.refUom.findUnique({ where: { id: uomId }, select: { status: true } });
  if (!uom) return { base_uom_id: "Satuan tidak ditemukan." };
  if (uom.status === "Active") return {};
  const current = itemId
    ? await prisma.mItem.findUnique({ where: { id: itemId }, select: { base_uom_id: true } })
    : null;
  return current?.base_uom_id === uomId ? {} : { base_uom_id: "Satuan ini sudah nonaktif." };
}

// ------------------------------------------------------------------- writes

/**
 * Makes the Item's conversions exactly what was submitted: updates the rows
 * it kept, adds the new ones, removes the ones taken out. Nothing refers to a
 * conversion yet; a document line will keep its own unit and factor.
 */
export async function writeItemCollections(
  tx: Prisma.TransactionClient,
  itemId: number,
  clean: ItemCollections,
  actorId: number
): Promise<void> {
  const current = new Map(
    (
      await tx.mItemUom.findMany({ where: { item_id: itemId }, select: { id: true, uom_id: true } })
    ).map((r) => [r.id, r.uom_id])
  );

  // A kept row whose unit is unchanged is updated in place. A row whose unit
  // changed is replaced: (item, unit) is unique, and two rows trading units
  // would collide half-way through an in-place update.
  const inPlace = new Set(
    clean.uoms.flatMap((u) => (u.id && current.get(u.id) === u.uomId ? [u.id] : []))
  );
  await tx.mItemUom.deleteMany({ where: { item_id: itemId, id: { notIn: [...inPlace] } } });

  for (const [order, u] of clean.uoms.entries()) {
    const data = { uom_id: u.uomId, factor: u.factor, sort_order: order };
    if (u.id && inPlace.has(u.id)) {
      await tx.mItemUom.update({ where: { id: u.id }, data: { ...data, updated_by: actorId } });
    } else {
      await tx.mItemUom.create({ data: { ...data, item_id: itemId, created_by: actorId } });
    }
  }
}
