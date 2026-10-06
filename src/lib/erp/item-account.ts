import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { checkAccountIsLeaf } from "./records";

/**
 * Accounts per Kategori Item (P122, closes C25): where an item's stock, its
 * cost of sale and its expense post, by its category — the mainstream shape
 * (SAP's valuation class, Odoo's product category accounts).
 *
 * - **Persediaan** and **HPP** apply to a Barang category: a Barang with Kelola
 *   Stok is valued in Persediaan and issued to HPP.
 * - **Beban** applies to every category: a Barang without Kelola Stok, and a
 *   Jasa, is an expense when it is received.
 *
 * Each is optional. A document that posts reads the category's account and,
 * where it is empty, falls back to Account Mapping (Persediaan and HPP on the
 * *Pengiriman Barang* card, P94), so what posted before this mapping posts the
 * same today. A posting that finds neither is refused by name.
 *
 * Named only by this module.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CategoryAccountKind = "inventory" | "cogs" | "expense";

/** Which accounts a category of this type may carry. */
export function categoryAccountKinds(itemType: "Barang" | "Jasa"): CategoryAccountKind[] {
  return itemType === "Barang" ? ["inventory", "cogs", "expense"] : ["expense"];
}

export type ItemCategoryAccountRow = {
  categoryId: number;
  label: string;
  name: string;
  itemType: "Barang" | "Jasa";
  active: boolean;
  inventory: number | null;
  cogs: number | null;
  expense: number | null;
};

/** Every Kategori Item with the accounts it names, Barang first. */
export async function itemCategoryAccounts(): Promise<ItemCategoryAccountRow[]> {
  const rows = await prisma.sysItemCategory.findMany({
    include: { accounts: true },
    orderBy: [{ item_type: "asc" }, { category_code: "asc" }],
  });
  return rows.map((c) => ({
    categoryId: c.id,
    label: c.category_label,
    name: c.category_name,
    itemType: c.item_type,
    active: c.status === "Active",
    inventory: c.accounts?.inventory_account_id ?? null,
    cogs: c.accounts?.cogs_account_id ?? null,
    expense: c.accounts?.expense_account_id ?? null,
  }));
}

export type ItemCategoryAccountInput = {
  categoryId: number;
  inventory: number | null;
  cogs: number | null;
  expense: number | null;
};

export type ItemCategoryAccountResult = { ok: true; changed: number } | { ok: false; errors: Record<string, string> };

/**
 * Writes the submitted rows. An account must be active, postable and a leaf,
 * as every posting target is (`checkSystemDefaultValue`); a kind the category's
 * type does not take is refused. Each category that changed is audited.
 */
export async function saveItemCategoryAccounts(input: ItemCategoryAccountInput[], actorId: number): Promise<ItemCategoryAccountResult> {
  const errors: Record<string, string> = {};
  const categories = new Map((await prisma.sysItemCategory.findMany({ include: { accounts: true } })).map((c) => [c.id, c]));
  const ids = [...new Set(input.flatMap((r) => [r.inventory, r.cogs, r.expense]).filter((v): v is number => Boolean(v)))];
  const accounts = new Map(
    (await prisma.accAccount.findMany({ where: { id: { in: ids } }, select: { id: true, is_active: true, is_postable: true } })).map((a) => [a.id, a])
  );
  const leafProblems = new Map<number, string | null>();
  for (const id of ids) leafProblems.set(id, await checkAccountIsLeaf(id));

  const writes: { categoryId: number; data: { inventory_account_id: number | null; cogs_account_id: number | null; expense_account_id: number | null } }[] = [];
  for (const r of input) {
    const c = categories.get(Number(r.categoryId));
    if (!c) {
      errors._form = "Kategori Item tidak ditemukan.";
      continue;
    }
    const allowed = new Set(categoryAccountKinds(c.item_type));
    const values = { inventory: Number(r.inventory) || null, cogs: Number(r.cogs) || null, expense: Number(r.expense) || null };
    for (const kind of ["inventory", "cogs", "expense"] as const) {
      const id = values[kind];
      if (!id) continue;
      const key = `${c.id}.${kind}`;
      if (!allowed.has(kind)) {
        errors[key] = "Kategori Jasa hanya memakai Account Beban.";
        continue;
      }
      const a = accounts.get(id);
      if (!a) errors[key] = "Account tidak ditemukan.";
      else if (!a.is_postable) errors[key] = "Account tersebut bukan account postable.";
      else if (!a.is_active) errors[key] = "Account tersebut non-aktif.";
      else if (leafProblems.get(id)) errors[key] = leafProblems.get(id)!;
    }
    const data = { inventory_account_id: values.inventory, cogs_account_id: values.cogs, expense_account_id: values.expense };
    const before = c.accounts;
    const same =
      (before?.inventory_account_id ?? null) === data.inventory_account_id &&
      (before?.cogs_account_id ?? null) === data.cogs_account_id &&
      (before?.expense_account_id ?? null) === data.expense_account_id;
    if (!same) writes.push({ categoryId: c.id, data });
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  await prisma.$transaction(async (tx) => {
    for (const w of writes) {
      const row = await tx.accItemCategoryAccount.upsert({
        where: { category_id: w.categoryId },
        update: { ...w.data, updated_by: actorId },
        create: { category_id: w.categoryId, ...w.data, created_by: actorId },
      });
      await tx.auditLog.create({ data: { entity_key: "acc_item_category_account", row_id: row.id, action: "UPDATE", event: "update", by: actorId } });
    }
  });
  return { ok: true, changed: writes.length };
}

export type ItemAccounts = { inventory: number | null; cogs: number | null; expense: number | null };

/**
 * The accounts each item's category names, by item id — null where the
 * category names none. The caller falls back to Account Mapping where it has
 * a fallback (Persediaan, HPP) and refuses where it has none.
 */
export async function accountsForItems(itemIds: number[], db: Db = prisma): Promise<Map<number, ItemAccounts>> {
  if (!itemIds.length) return new Map();
  const items = await db.mItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, category: { select: { accounts: true } } },
  });
  return new Map(
    items.map((i) => [
      i.id,
      {
        inventory: i.category.accounts?.inventory_account_id ?? null,
        cogs: i.category.accounts?.cogs_account_id ?? null,
        expense: i.category.accounts?.expense_account_id ?? null,
      },
    ])
  );
}

/** Whether any category points at this account — read before it is deactivated. */
export async function categoriesUsingAccount(accountId: number): Promise<string[]> {
  const rows = await prisma.accItemCategoryAccount.findMany({
    where: { OR: [{ inventory_account_id: accountId }, { cogs_account_id: accountId }, { expense_account_id: accountId }] },
    select: { category: { select: { category_label: true } } },
  });
  return rows.map((r) => r.category.category_label);
}
