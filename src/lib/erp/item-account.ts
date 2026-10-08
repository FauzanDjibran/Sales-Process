import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * Accounts per Kategori Item (P122, closes C25; a mapping list since P150 M54):
 * where an item's stock, its cost of sale, its expense and its work in progress
 * post, by its category — the mainstream shape (SAP's valuation class, Odoo's
 * product category accounts).
 *
 * One row per category and **kind of account** (`account_kind`), chosen by the
 * user in a list — the kinds are expected to grow, so each is a row rather than
 * a column:
 *
 * - **Persediaan** (`Inventory`), **HPP** (`Cogs`) and **WIP** (`Wip`) apply to
 *   a Barang category: a Barang with Kelola Stok is valued in Persediaan,
 *   issued to HPP, and held in WIP while it is inside production.
 * - **Beban** (`Expense`) applies to every category: a Barang without Kelola
 *   Stok, and a Jasa, is an expense when it is received.
 *
 * A kind a category does not name — or names in an inactive row — falls back
 * to Account Mapping where there is a fallback (Persediaan, HPP, WIP), so what
 * posted before this mapping posts the same today; a posting that finds
 * neither is refused by name.
 *
 * Named only by this module and the registry (`acc_item_category_account`).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CategoryAccountKind = "Inventory" | "Cogs" | "Expense" | "Wip";

/** The kinds in list order, with their Indonesian names and the item types they apply to. */
export const CATEGORY_ACCOUNT_KINDS: { kind: CategoryAccountKind; label: string; itemTypes: ("Barang" | "Jasa")[] }[] = [
  { kind: "Inventory", label: "Persediaan", itemTypes: ["Barang"] },
  { kind: "Cogs", label: "HPP", itemTypes: ["Barang"] },
  { kind: "Wip", label: "WIP (Barang Dalam Proses)", itemTypes: ["Barang"] },
  { kind: "Expense", label: "Beban", itemTypes: ["Barang", "Jasa"] },
];

/** Why a category of this type cannot name this kind, or null when it can. */
export function categoryAccountKindProblem(itemType: "Barang" | "Jasa", kind: string): string | null {
  const def = CATEGORY_ACCOUNT_KINDS.find((k) => k.kind === kind);
  if (!def) return "Jenis Account tidak dikenali.";
  if (!def.itemTypes.includes(itemType)) return "Kategori Jasa hanya memakai Account Beban.";
  return null;
}

export type ItemAccounts = { inventory: number | null; cogs: number | null; expense: number | null; wip: number | null };

/**
 * The accounts each item's category names, by item id — null where the
 * category names none, or only in an inactive row. The caller falls back to
 * Account Mapping where it has a fallback and refuses where it has none.
 */
export async function accountsForItems(itemIds: number[], db: Db = prisma): Promise<Map<number, ItemAccounts>> {
  if (!itemIds.length) return new Map();
  const items = await db.mItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, category: { select: { accounts: { where: { status: "Active" }, select: { account_kind: true, account_id: true } } } } },
  });
  return new Map(
    items.map((i) => {
      const of = (kind: CategoryAccountKind) => i.category.accounts.find((a) => a.account_kind === kind)?.account_id ?? null;
      return [i.id, { inventory: of("Inventory"), cogs: of("Cogs"), expense: of("Expense"), wip: of("Wip") }];
    })
  );
}

/** The categories naming this account, in any row — read before it is deactivated. */
export async function categoriesUsingAccount(accountId: number): Promise<string[]> {
  const rows = await prisma.accItemCategoryAccount.findMany({
    where: { account_id: accountId },
    select: { category: { select: { category_label: true } } },
  });
  return [...new Set(rows.map((r) => r.category.category_label))];
}
