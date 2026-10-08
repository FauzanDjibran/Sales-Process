import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createPermitRequest,
  getPermitRequest,
  saveRealization,
  transitionPermitRequest,
  updatePermitRequest,
  type PermitRequestHeaderInput,
  type PermitRequestLineInput,
} from "../src/lib/erp/permit-request";
import { computePermitTotals } from "../src/lib/erp/sales-tax";
import { ppnRates } from "../src/lib/erp/system-settings";
import { FIXTURE_PREFIX, cleanupFixtures, disconnect, makePartner, prisma, systemUserId } from "./helpers";

/**
 * The Pengajuan Perizinan (P137, Perizinan-Concept.md §5–§6): what may be
 * saved, PPN once on the total (Z5), Draft → Diajukan → Disetujui, the
 * realisation entered on the same document with permits added (Z7), and the
 * RLZ number. It posts nothing, which the journal count proves.
 */

let actor = 0;
const f = {} as Record<string, number>;
const requests: number[] = [];
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;

const header = (over: Partial<PermitRequestHeaderInput> = {}): PermitRequestHeaderInput => ({
  request_date: "2026-09-24",
  customer_id: f.customer,
  address_id: f.address,
  term_id: f.term,
  price_mode: "Exclude",
  is_taxable: true,
  withholding_tax_id: f.wht,
  po_no: "GBK/PO/2026/090",
  po_date: "2026-09-23",
  salesperson: "",
  product_name: 'Serum Wajah "Glowin" 30 ml',
  note: "",
  ...over,
});

const line = (type: number, price: number): PermitRequestLineInput => ({ permit_type_id: type, description: "", estimate_price: price });

before(async () => {
  actor = await systemUserId();
  f.customer = await makePartner({ categoryLabel: "Customer" });
  const village = await prisma.sysRegionVillage.findFirstOrThrow({ orderBy: { code: "asc" } });
  await prisma.mPartner.update({
    where: { id: f.customer },
    data: { taxpayer_type: "Badan", tax_id_type: "NPWP", tax_id: "0987654321098765", tax_name: "PT FIXTURE", is_pkp: true },
  });
  f.address = (await prisma.mPartnerAddress.create({ data: { partner_id: f.customer, village_id: village.id, street: "Kantor", created_by: actor } })).id;
  f.term = (await prisma.refPaymentTerm.create({ data: { term_code: `test.${key("T")}`, term_label: key("T"), term_name: "Net 7", due_days: 7, created_by: actor } })).id;
  f.wht = (await prisma.refWithholdingTax.create({ data: { wht_code: `test.${key("W")}`, wht_label: key("W"), wht_name: "PPh 23 Uji", rate: 2, created_by: actor } })).id;
  const type = async (l: string) =>
    (await prisma.refPermitType.create({ data: { permit_code: `test.${key(l)}`, permit_label: key(l), permit_name: l, category: "Regulatory", created_by: actor } })).id;
  f.pre = await type("PRE");
  f.bpom = await type("BPOM");
  f.stab = await type("STAB");
  f.micro = await type("MICRO");
});

after(async () => {
  await prisma.salPermitRequestLine.deleteMany({ where: { request_id: { in: requests } } });
  await prisma.salPermitRequest.deleteMany({ where: { id: { in: requests } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sal_permit_request", row_id: { in: requests } } });
  await prisma.refPermitType.deleteMany({ where: { id: { in: [f.pre, f.bpom, f.stab, f.micro] } } });
  await cleanupFixtures();
  await prisma.refPaymentTerm.deleteMany({ where: { id: f.term } });
  await prisma.refWithholdingTax.deleteMany({ where: { id: f.wht } });
  await disconnect();
});

async function create(h = header(), lines = [line(f.pre, 500_000), line(f.bpom, 100_000), line(f.stab, 200_000)]) {
  const r = await createPermitRequest(h, lines, actor);
  if (r.ok) requests.push(r.id);
  return r;
}

describe("saving a Pengajuan", () => {
  test("PPN is computed once on the total, the faktur's one line (Z5)", async () => {
    const rates = (await ppnRates())!;
    const r = await create();
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.requestNo, /^PRZ\/2026\/09\/\d{4}$/);
    const v = (await getPermitRequest(r.id))!;
    const expected = computePermitTotals({ prices: [800_000], mode: "Exclude", taxable: true, rates, withholdingRate: 2 });
    assert.deepEqual(v.estimate, { amount: 800_000, dpp: expected.dpp, dppOther: expected.dppOther, ppn: expected.ppn, total: expected.total });
    assert.equal(v.lines.length, 3);
    assert.equal(v.lines[0].description, "PRE", "an empty description takes the permit's name");
  });

  test("a permit once, a positive whole-rupiah estimate, a product named", async () => {
    const r = await create(header({ product_name: " " }), [line(f.pre, 500_000), line(f.pre, 0)]);
    assert.ok(!r.ok);
    assert.ok(r.errors.product_name);
    assert.ok(r.errors["lines.1.permit_type_id"], "each Jenis Perizinan once");
    const zero = await create(header(), [line(f.pre, 0)]);
    assert.ok(!zero.ok && zero.errors["lines.0.estimate_price"]);
  });

  test("without PPN it is numbered PRZ-NP and carries no PPN", async () => {
    const r = await create(header({ is_taxable: false }));
    assert.ok(r.ok);
    assert.match(r.requestNo, /^PRZ-NP\//);
    const v = (await getPermitRequest(r.id))!;
    assert.equal(v.estimate.ppn, 0);
    assert.equal(v.estimate.total, 800_000);
  });
});

describe("the lifecycle and the realisation", () => {
  test("Draft → Diajukan → Disetujui, realised with a permit added, RLZ numbered, no journal", async () => {
    const journals = await prisma.accJournal.count();
    const r = await create();
    assert.ok(r.ok);
    const id = r.id;

    assert.ok((await updatePermitRequest(id, header({ note: "ubah" }), [line(f.pre, 500_000), line(f.bpom, 100_000), line(f.stab, 200_000)], actor)).ok);
    const early = await saveRealization(id, { realization_date: "2026-09-25", realization_note: "", lines: [] }, actor);
    assert.ok(!early.ok, "a Draft takes no realisation");

    assert.ok((await transitionPermitRequest(id, "submit", actor)).ok);
    assert.ok(!(await updatePermitRequest(id, header(), [line(f.pre, 1)], actor)).ok, "a submitted Pengajuan is locked");
    assert.ok((await transitionPermitRequest(id, "approve", actor)).ok);
    assert.ok(!(await transitionPermitRequest(id, "realize", actor)).ok, "Realisasikan needs the realisation entered");

    const missing = await saveRealization(
      id,
      { realization_date: "2026-09-25", realization_note: "", lines: [{ permit_type_id: f.pre, description: "", realized_price: 550_000, is_added: false }] },
      actor
    );
    assert.ok(!missing.ok, "every estimated permit takes a realised price");

    const saved = await saveRealization(
      id,
      {
        realization_date: "2026-09-25",
        realization_note: "uji mikro ditambah",
        lines: [
          { permit_type_id: f.pre, description: "", realized_price: 550_000, is_added: false },
          { permit_type_id: f.bpom, description: "", realized_price: 100_000, is_added: false },
          { permit_type_id: f.stab, description: "", realized_price: 180_000, is_added: false },
          { permit_type_id: f.micro, description: "Uji mikro", realized_price: 150_000, is_added: true },
        ],
      },
      actor
    );
    assert.ok(saved.ok, JSON.stringify(saved));
    let v = (await getPermitRequest(id))!;
    assert.equal(v.realization.figures.amount, 980_000);
    assert.equal(v.estimate.amount, 800_000, "the estimate stays locked");
    assert.deepEqual(v.lines.map((l) => [l.isAdded, l.estimatePrice, l.realizedPrice]), [
      [false, 500_000, 550_000],
      [false, 100_000, 100_000],
      [false, 200_000, 180_000],
      [true, 0, 150_000],
    ]);

    assert.ok((await transitionPermitRequest(id, "realize", actor)).ok);
    v = (await getPermitRequest(id))!;
    assert.equal(v.status, "Realized");
    assert.match(v.realization.no ?? "", /^RLZ\/2026\/09\/\d{4}$/);

    // Still correctable until billed or paid (Z8): an added permit can be dropped.
    const again = await saveRealization(
      id,
      {
        realization_date: "2026-09-25",
        realization_note: "",
        lines: [
          { permit_type_id: f.pre, description: "", realized_price: 550_000, is_added: false },
          { permit_type_id: f.bpom, description: "", realized_price: 100_000, is_added: false },
          { permit_type_id: f.stab, description: "", realized_price: 180_000, is_added: false },
        ],
      },
      actor
    );
    assert.ok(again.ok);
    assert.equal((await getPermitRequest(id))!.lines.length, 3);
    assert.equal(await prisma.accJournal.count(), journals, "a Pengajuan posts nothing");
  });

  test("Tolak and Batalkan need a reason and are final", async () => {
    const a = await create();
    assert.ok(a.ok);
    assert.ok(!(await transitionPermitRequest(a.id, "cancel", actor)).ok, "reason required");
    assert.ok((await transitionPermitRequest(a.id, "cancel", actor, "salah customer")).ok);
    assert.ok(!(await transitionPermitRequest(a.id, "submit", actor)).ok);

    const b = await create();
    assert.ok(b.ok);
    assert.ok((await transitionPermitRequest(b.id, "submit", actor)).ok);
    assert.ok((await transitionPermitRequest(b.id, "reject", actor, "harga terlalu tinggi")).ok);
    assert.equal((await getPermitRequest(b.id))!.statusReason, "harga terlalu tinggi");
  });

  test("Batalkan of an approved Pengajuan takes the caller's guard", async () => {
    const r = await create();
    assert.ok(r.ok);
    await transitionPermitRequest(r.id, "submit", actor);
    await transitionPermitRequest(r.id, "approve", actor);
    const refused = await transitionPermitRequest(r.id, "cancel", actor, "x", async () => "Masih ada Uang Muka Perizinan.");
    assert.ok(!refused.ok && refused.errors._form === "Masih ada Uang Muka Perizinan.");
    assert.equal((await getPermitRequest(r.id))!.status, "Open");
  });
});
