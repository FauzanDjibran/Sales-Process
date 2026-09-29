import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  checkItemBaseUom,
  checkItemCategory,
  checkItemCollections,
  itemCollections,
  writeItemCollections,
} from "../src/lib/erp/item";
import { UOMS_KEY, uomErrors, type UomDraft } from "../src/lib/erp/item-shape";
import { ENTITIES, fieldApplies } from "../src/lib/erp/entities";
import { FIXTURE_PREFIX, disconnect, prisma, systemUserId } from "./helpers";

/**
 * The Item master (P46–P48): its type-scoped categories, the flags a Jasa
 * cannot carry, and its unit conversions. The Server Action is a thin shell
 * over these functions, so the rules are proved here against the database.
 */

let actor = 0;
const uom: Record<string, number> = {};
const made = { items: [] as number[], uoms: [] as number[] };
let barangCategory = 0;
let jasaCategory = 0;

async function makeUom(label: string, status: "Active" | "Inactive" = "Active") {
  const key = `${FIXTURE_PREFIX}${label}${Date.now() % 100000}`;
  const row = await prisma.refUom.create({
    data: { uom_code: `test.${key}`, uom_label: key, uom_name: label, status, created_by: actor },
  });
  made.uoms.push(row.id);
  return row.id;
}

async function makeItem(baseUomId: number) {
  const key = `${FIXTURE_PREFIX}IT${made.items.length}${Date.now() % 100000}`;
  const row = await prisma.mItem.create({
    data: {
      item_code: `test.${key}`,
      item_label: key,
      item_name: `Fixture ${key}`,
      item_type: "Barang",
      category_id: barangCategory,
      base_uom_id: baseUomId,
      created_by: actor,
    },
  });
  made.items.push(row.id);
  return row.id;
}

const draft = (uomId: number, factor: string, over: Partial<UomDraft> = {}): Partial<UomDraft> => ({
  key: `k${uomId}`,
  uomId,
  factor,
  ...over,
});
const submit = (baseUomId: number, rows: unknown[]) => ({
  base_uom_id: String(baseUomId),
  [UOMS_KEY]: JSON.stringify(rows),
});

before(async () => {
  actor = await systemUserId();
  for (const l of ["PCS", "BOX", "CTN", "OLD"]) uom[l] = await makeUom(l, l === "OLD" ? "Inactive" : "Active");
  barangCategory = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  jasaCategory = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "JASA-LAIN" } })).id;
});

after(async () => {
  await prisma.mItemUom.deleteMany({ where: { item_id: { in: made.items } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "m_item", row_id: { in: made.items } } });
  await prisma.mItem.deleteMany({ where: { id: { in: made.items } } });
  await prisma.refUom.deleteMany({ where: { id: { in: made.uoms } } });
  await disconnect();
});

// --------------------------------------------------------------- categories

describe("Kategori Item is seeded system data, one type each", () => {
  test("the standard list is there, split by type", async () => {
    const rows = await prisma.sysItemCategory.findMany({ select: { category_name: true, item_type: true } });
    const names = (t: string) => rows.filter((r) => r.item_type === t).map((r) => r.category_name);
    for (const n of ["Bahan Baku", "Bahan Kemas", "Barang Setengah Jadi", "Barang Jadi", "Barang Dagangan", "Barang Habis Pakai"]) {
      assert.ok(names("Barang").includes(n), `${n} is a Barang category`);
    }
    for (const n of ["Jasa Pemeliharaan", "Jasa Konsultasi", "Jasa Pengiriman", "Jasa Maklon", "Jasa Lain-lain"]) {
      assert.ok(names("Jasa").includes(n), `${n} is a Jasa category`);
    }
  });

  test("it has no menu of its own", () => {
    assert.ok(!ENTITIES.some((e) => e.key === "sys_item_category"));
  });

  test("an item takes only a category of its own type", async () => {
    assert.deepEqual(await checkItemCategory({ item_type: "Barang", category_id: barangCategory }, null), {});
    const e = await checkItemCategory({ item_type: "Barang", category_id: jasaCategory }, null);
    assert.match(e.category_id, /bukan untuk tipe Barang/);
  });

  test("an inactive unit cannot become a base unit", async () => {
    assert.deepEqual(await checkItemBaseUom({ base_uom_id: uom.PCS }, null), {});
    assert.ok((await checkItemBaseUom({ base_uom_id: uom.OLD }, null)).base_uom_id);
  });
});

// -------------------------------------------------------------------- flags

describe("stock and expiry belong to Barang", () => {
  const item = ENTITIES.find((e) => e.key === "m_item")!;
  const goodsOnly = item.fields.filter((f) => f.visibleWhen === "itemIsGoods").map((f) => f.name);

  test("Kelola Stok and Memiliki Kadaluarsa apply to a Barang only", () => {
    assert.deepEqual(goodsOnly.sort(), ["has_expiry", "track_stock"]);
    for (const f of item.fields.filter((x) => goodsOnly.includes(x.name))) {
      assert.equal(fieldApplies(f, { item_type: "Barang" }), true);
      assert.equal(fieldApplies(f, { item_type: "Jasa" }), false);
    }
  });

  test("the item carries no tax treatment: PPN and PPh are decided on the transaction", () => {
    const names = item.fields.map((f) => f.name).join(" ");
    assert.doesNotMatch(names, /ppn|vat|pph|wht|tax/i);
    assert.deepEqual(item.tabs?.map((t) => t.key), ["uoms"]);
  });
});

// -------------------------------------------------------------- conversions

describe("a conversion is to the base unit", () => {
  test("the dialog's rules", () => {
    assert.deepEqual(uomErrors({ uomId: 2, factor: "12" }, 1, []), {});
    assert.deepEqual(uomErrors({ uomId: 2, factor: "0.5" }, 1, []), {});
    assert.ok(uomErrors({ uomId: 1, factor: "12" }, 1, []).uom, "not the base unit itself");
    assert.ok(uomErrors({ uomId: 2, factor: "12" }, 1, [2]).uom, "each unit once");
    assert.ok(uomErrors({ uomId: 2, factor: "0" }, 1, []).factor, "more than zero");
    assert.ok(uomErrors({ uomId: 2, factor: "1.23456" }, 1, []).factor, "four decimals at most");
    assert.ok(uomErrors({ uomId: null, factor: "" }, 1, []).uom);
  });

  test("the server applies them against the base unit being saved", async () => {
    const { errors } = await checkItemCollections(
      submit(uom.BOX, [draft(uom.BOX, "12")]),
      null
    );
    assert.match(errors[UOMS_KEY], /Satuan dasar/);
  });

  test("an inactive unit cannot be added", async () => {
    const { errors } = await checkItemCollections(submit(uom.PCS, [draft(uom.OLD, "6")]), null);
    assert.match(errors[UOMS_KEY], /nonaktif/);
  });

  test("a row id belonging to another item is refused", async () => {
    const other = await makeItem(uom.PCS);
    await prisma.$transaction((tx) =>
      writeItemCollections(tx, other, { uoms: [{ id: null, uomId: uom.BOX, factor: "12" }] }, actor)
    );
    const theirs = (await itemCollections(other)).uoms[0];
    const mine = await makeItem(uom.PCS);
    const { errors } = await checkItemCollections(
      submit(uom.PCS, [draft(uom.BOX, "12", { id: theirs.id })]),
      mine
    );
    assert.match(errors[UOMS_KEY], /bukan konversi milik item ini/);
  });

  test("saving adds, updates in place, removes — and survives two rows trading units", async () => {
    const id = await makeItem(uom.PCS);
    const save = async (rows: unknown[]) => {
      const { errors, clean } = await checkItemCollections(submit(uom.PCS, rows), id);
      assert.deepEqual(errors, {});
      await prisma.$transaction((tx) => writeItemCollections(tx, id, clean, actor));
      return (await itemCollections(id)).uoms;
    };

    let saved = await save([draft(uom.BOX, "12"), draft(uom.CTN, "144")]);
    assert.deepEqual(saved.map((u) => [u.uomId, Number(u.factor)]), [[uom.BOX, 12], [uom.CTN, 144]]);
    const [box, ctn] = saved;

    // BOX re-factored in place; CTN removed.
    saved = await save([{ ...box, factor: "10" }]);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, box.id, "an unchanged unit is updated in place");
    assert.equal(Number(saved[0].factor), 10);
    assert.equal(await prisma.mItemUom.count({ where: { id: ctn.id } }), 0);

    // Two kept rows swap units: no unique clash.
    saved = await save([saved[0], draft(uom.CTN, "100")]);
    const [a, b] = saved;
    saved = await save([
      { ...a, uomId: uom.CTN, factor: "100" },
      { ...b, uomId: uom.BOX, factor: "10" },
    ]);
    assert.deepEqual(saved.map((u) => [u.uomId, Number(u.factor)]), [[uom.CTN, 100], [uom.BOX, 10]]);
  });
});
