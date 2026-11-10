import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { actorOf, cleanup, makeUser, prisma, systemUserId } from "./helpers";
import { assertUnit, narrowToUnits, setUserUnits, unitIdsOf } from "../src/lib/erp/production-access";
import { listGradings } from "../src/lib/erp/production-grading";
import { isAccessDenied } from "../src/lib/erp/auth-errors";

/**
 * Which Units a user may open in Produksi (P260): permission says what, the
 * assignment says where, PRODUCTION_UNIT_ALL needs none, and nobody assigns
 * their own.
 */
const units: number[] = [];
let admin: number;
let worker: number;
let supervisor: number;
let unassigned: number;

before(async () => {
  const by = await systemUserId();
  const tag = `UA${Date.now() % 100000}`;
  for (const n of [1, 2]) {
    units.push((await prisma.refUnit.create({ data: { unit_code: `test.${tag}${n}`, unit_label: `${tag}${n}`, unit_name: `Uji ${n}`, process: "PassThrough", created_by: by } })).id);
  }
  admin = (await makeUser({ permissions: ["USER_ROLE_ASSIGN", "PRODUCTION_UNIT_VIEW"] })).id;
  worker = (await makeUser({ permissions: ["PRODUCTION_UNIT_VIEW", "PRODUCTION_GRADING_VIEW"] })).id;
  supervisor = (await makeUser({ permissions: ["PRODUCTION_UNIT_VIEW", "PRODUCTION_UNIT_ALL"] })).id;
  unassigned = (await makeUser({ permissions: ["PRODUCTION_UNIT_VIEW"] })).id;
});

after(async () => {
  await cleanup();
  await prisma.prdUserUnit.deleteMany({ where: { unit_id: { in: units } } });
  await prisma.refUnit.deleteMany({ where: { id: { in: units } } });
});

const denied = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return isAccessDenied(error);
  }
  return false;
};

describe("a user opens only the Units assigned to them", () => {
  test("assigning takes USER_ROLE_ASSIGN, never one's own, and is audited", async () => {
    assert.ok(await denied(async () => setUserUnits(await actorOf(worker), unassigned, [units[0]])));
    const self = await setUserUnits(await actorOf(admin), admin, [units[0]]);
    assert.equal(self.ok, false);

    const ok = await setUserUnits(await actorOf(admin), worker, [units[0], units[0]]);
    assert.ok(ok.ok);
    const rows = await prisma.prdUserUnit.findMany({ where: { user_id: worker } });
    assert.deepEqual(rows.map((r) => r.unit_id), [units[0]]);
    assert.equal(await prisma.auditLog.count({ where: { entity_key: "sys_user", row_id: worker, event: "units" } }), 1);

    const unknown = await setUserUnits(await actorOf(admin), worker, [999_999_999]);
    assert.equal(unknown.ok, false);
  });

  test("the Units read, and a Unit outside them is refused", async () => {
    const w = await actorOf(worker);
    assert.deepEqual(await unitIdsOf(w), [units[0]]);
    await assertUnit(w, units[0]);
    assert.ok(await denied(() => assertUnit(w, units[1])));

    assert.deepEqual(await unitIdsOf(await actorOf(unassigned)), []);
    assert.ok(await denied(async () => assertUnit(await actorOf(unassigned), units[0])));
  });

  test("PRODUCTION_UNIT_ALL opens every Unit without an assignment", async () => {
    const s = await actorOf(supervisor);
    assert.equal(await unitIdsOf(s), null);
    await assertUnit(s, units[1]);
  });

  test("options and registers keep to the user's Units", async () => {
    const w = await actorOf(worker);
    const options = { units: units.map((id) => ({ id })), inputs: units.map((unitId) => ({ id: unitId * 10, unitId })), items: [{ id: 1 }] };
    const narrowed = await narrowToUnits(w, options);
    assert.deepEqual(narrowed.units.map((u) => u.id), [units[0]]);
    assert.deepEqual(narrowed.inputs.map((r) => r.unitId), [units[0]]);
    assert.equal(narrowed.items.length, 1, "lists without a Unit are left alone");

    const rows = await listGradings([units[0]]);
    assert.ok(rows.every((r) => r.unitLabel.endsWith("1")));
  });
});
