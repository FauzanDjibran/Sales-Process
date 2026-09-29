import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  checkPartnerCollections,
  checkPartnerTax,
  partnerCollections,
  regionOptions,
  writePartnerCollections,
} from "../src/lib/erp/partner";
import {
  ADDRESSES_KEY,
  CONTACTS_KEY,
  addressErrors,
  contactErrors,
  formatAddress,
  formatTaxId,
  normalizeTaxId,
  type AddressDraft,
  type ContactDraft,
} from "../src/lib/erp/partner-shape";
import { ENTITIES, fieldApplies } from "../src/lib/erp/entities";
import {
  cleanupFixtures,
  disconnect,
  makePartner,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The Partner master: its region reference data, its addresses and contacts,
 * and its tax identity.
 *
 * The Server Action is a thin shell over these functions — it authorizes,
 * calls them, and writes in one transaction — so the rules are proved here,
 * against the real seeded region data.
 */

let actor = 0;

/** A real kelurahan from the seeded data, with everything above it. */
type Place = {
  provinceId: number;
  cityId: number;
  districtId: number;
  villageId: number;
  postalCode: string | null;
  names: string[];
};
let place: Place;
let elsewhere: Place;

async function placeOf(villageCode: string): Promise<Place> {
  const v = await prisma.sysRegionVillage.findUniqueOrThrow({
    where: { code: villageCode },
    include: { district: { include: { city: { include: { province: true } } } } },
  });
  const d = v.district;
  return {
    provinceId: d.city.province.id,
    cityId: d.city.id,
    districtId: d.id,
    villageId: v.id,
    postalCode: v.postal_code,
    names: [d.city.province.name, d.city.name, d.name, v.name],
  };
}

const address = (over: Partial<AddressDraft> = {}): Partial<AddressDraft> => ({
  key: "k1",
  provinceId: place.provinceId,
  cityId: place.cityId,
  districtId: place.districtId,
  villageId: place.villageId,
  street: "Jl. Gatot Subroto Kav. 21",
  note: "",
  isBilling: true,
  isShipping: true,
  ...over,
});

const contact = (over: Partial<ContactDraft> = {}): Partial<ContactDraft> => ({
  key: "c1",
  name: "Bpk. Hadi Santoso",
  position: "Purchasing",
  phone: "0812 8800 1122",
  email: "hadi@sentosa.co.id",
  ...over,
});

const submit = (addresses: unknown[], contacts: unknown[] = []) => ({
  [ADDRESSES_KEY]: JSON.stringify(addresses),
  [CONTACTS_KEY]: JSON.stringify(contacts),
});

before(async () => {
  actor = await systemUserId();
  // The first kelurahan of the first kecamatan of two different provinces.
  const first = await prisma.sysRegionVillage.findFirstOrThrow({ orderBy: { code: "asc" } });
  const last = await prisma.sysRegionVillage.findFirstOrThrow({ orderBy: { code: "desc" } });
  place = await placeOf(first.code);
  elsewhere = await placeOf(last.code);
});

after(async () => {
  await cleanupFixtures();
  await disconnect();
});

// ------------------------------------------------------------------ regions

describe("region reference data", () => {
  test("is seeded at every level, each kelurahan with a kode pos", async () => {
    assert.ok((await prisma.sysRegionProvince.count()) >= 38);
    assert.ok((await prisma.sysRegionCity.count()) >= 514);
    assert.ok((await prisma.sysRegionDistrict.count()) >= 7000);
    assert.ok((await prisma.sysRegionVillage.count()) >= 83000);
    assert.equal(
      await prisma.sysRegionVillage.count({ where: { postal_code: null } }),
      0,
      "the source gives every kelurahan a kode pos"
    );
  });

  test("each level lists only the children of the one chosen above it", async () => {
    const cities = await regionOptions("city", place.provinceId);
    assert.ok(cities.some((c) => c.id === place.cityId));
    assert.ok(!cities.some((c) => c.id === elsewhere.cityId));

    const villages = await regionOptions("village", place.districtId);
    const mine = villages.find((v) => v.id === place.villageId);
    assert.ok(mine, "the kelurahan is listed under its own kecamatan");
    assert.equal(mine.postalCode, place.postalCode, "and carries its kode pos");
  });

  test("a level with nothing chosen above it offers nothing", async () => {
    assert.deepEqual(await regionOptions("city", null), []);
    assert.deepEqual(await regionOptions("village", null), []);
  });
});

// ------------------------------------------------------------ the one line

describe("an address reads as one line", () => {
  test("provinsi, kota, kecamatan, kelurahan, alamat, kode pos", () => {
    assert.equal(
      formatAddress({
        provinceName: "DKI Jakarta",
        cityName: "Kota Adm. Jakarta Selatan",
        districtName: "Setiabudi",
        villageName: "Kuningan Timur",
        street: "Jl. Gatot Subroto Kav. 21",
        postalCode: "12950",
      }),
      "DKI Jakarta, Kota Adm. Jakarta Selatan, Setiabudi, Kuningan Timur, Jl. Gatot Subroto Kav. 21, 12950"
    );
  });

  test("a blank part is skipped rather than printed as an empty comma", () => {
    assert.equal(
      formatAddress({
        provinceName: "Jawa Timur",
        cityName: "Kota Surabaya",
        districtName: "Tegalsari",
        villageName: "Kedungdoro",
        street: "Jl. Diponegoro No. 88",
        postalCode: "",
      }),
      "Jawa Timur, Kota Surabaya, Tegalsari, Kedungdoro, Jl. Diponegoro No. 88"
    );
  });
});

// ------------------------------------------------------ the dialog's rules

describe("the dialogs refuse what the server refuses", () => {
  test("an address needs every region level and a street", () => {
    const e = addressErrors({ street: "  " });
    assert.deepEqual(Object.keys(e).sort(), ["city", "district", "province", "street", "village"]);
  });

  test("a contact needs all four fields, a phone number and an email that look like one", () => {
    assert.deepEqual(Object.keys(contactErrors({})).sort(), ["email", "name", "phone", "position"]);
    const e = contactErrors(contact({ phone: "call me", email: "hadi.sentosa" }));
    assert.deepEqual(Object.keys(e).sort(), ["email", "phone"]);
    assert.deepEqual(contactErrors(contact({ phone: "+62 21 344-9900" })), {});
  });
});

// ---------------------------------------------------------- collections

describe("a Partner has at least one address", () => {
  test("none at all is refused", async () => {
    const { errors } = await checkPartnerCollections(submit([]), null);
    assert.match(errors[ADDRESSES_KEY], /minimal satu alamat/);
  });

  test("one address, with or without flags, is enough", async () => {
    const { errors, clean } = await checkPartnerCollections(
      submit([address({ isBilling: false, isShipping: false })]),
      null
    );
    assert.deepEqual(errors, {});
    assert.equal(clean.addresses.length, 1);
    assert.equal(clean.contacts.length, 0, "a contact person is not required");
  });

  test("a region chain that does not hold together is refused", async () => {
    // A kelurahan from one province claimed under another.
    const { errors } = await checkPartnerCollections(
      submit([address({ villageId: elsewhere.villageId })]),
      null
    );
    assert.match(errors[ADDRESSES_KEY], /tidak saling cocok/);
  });

  test("a row id that belongs to another Partner is refused", async () => {
    const other = await makePartner({ categoryLabel: "Customer" });
    await prisma.$transaction((tx) =>
      writePartnerCollections(
        tx,
        other,
        {
          addresses: [
            { id: null, villageId: place.villageId, street: "X", note: null, isBilling: true, isShipping: true },
          ],
          contacts: [],
        },
        actor
      )
    );
    const theirs = await prisma.mPartnerAddress.findFirstOrThrow({ where: { partner_id: other } });

    const mine = await makePartner({ categoryLabel: "Customer" });
    const { errors } = await checkPartnerCollections(submit([address({ id: theirs.id })]), mine);
    assert.match(errors[ADDRESSES_KEY], /bukan alamat milik Partner ini/);
  });

  test("an unreadable submission is refused, not treated as empty", async () => {
    const { errors } = await checkPartnerCollections(
      { [ADDRESSES_KEY]: "{not json", [CONTACTS_KEY]: "[]" },
      null
    );
    assert.match(errors[ADDRESSES_KEY], /tidak terbaca/);
  });
});

describe("saving makes the collections exactly what was submitted", () => {
  test("adds, updates in place and removes, keeping the order given", async () => {
    const id = await makePartner({ categoryLabel: "Customer" });
    const save = async (addresses: unknown[], contacts: unknown[]) => {
      const { errors, clean } = await checkPartnerCollections(submit(addresses, contacts), id);
      assert.deepEqual(errors, {});
      await prisma.$transaction((tx) => writePartnerCollections(tx, id, clean, actor));
      return partnerCollections(id);
    };

    // First save: two addresses, one contact.
    let saved = await save(
      [address({ key: "a", street: "Kantor Pusat" }), address({ key: "b", street: "Gudang", isBilling: false })],
      [contact()]
    );
    assert.deepEqual(saved.addresses.map((a) => a.street), ["Kantor Pusat", "Gudang"]);
    assert.equal(saved.contacts.length, 1);
    const [hq, wh] = saved.addresses;
    // What the form reads back names every level and the kode pos.
    assert.deepEqual([hq.provinceName, hq.cityName, hq.districtName, hq.villageName], place.names);
    assert.equal(hq.postalCode, place.postalCode ?? "");

    // Second save: the warehouse moves first and is renamed, head office goes,
    // a new address arrives, the contact is taken out.
    saved = await save(
      [
        { ...wh, street: "Gudang Cakung" },
        address({ key: "c", street: "Cabang Bekasi", isShipping: false }),
      ],
      []
    );
    assert.deepEqual(saved.addresses.map((a) => a.street), ["Gudang Cakung", "Cabang Bekasi"]);
    assert.equal(saved.addresses[0].id, wh.id, "a kept address is updated in place, not recreated");
    assert.equal(
      await prisma.mPartnerAddress.count({ where: { id: hq.id } }),
      0,
      "a removed address is gone"
    );
    assert.equal(saved.contacts.length, 0);
  });
});

// --------------------------------------------------------------- Pajak

describe("the tax identity", () => {
  const base = { taxpayer_type: "Badan", tax_id_type: "NPWP", tax_id: "0987654321098765", is_pkp: true };

  test("a separated NPWP is stored as its 16 digits, and printed back grouped", () => {
    assert.equal(normalizeTaxId("0987 6543.2109-8765"), "0987654321098765");
    assert.equal(formatTaxId("0987654321098765"), "0987 6543 2109 8765");
  });

  test("a well-formed company identity passes", () => {
    assert.deepEqual(checkPartnerTax(base, true), {});
  });

  test("the number has to be 16 digits", () => {
    assert.ok(checkPartnerTax({ ...base, tax_id: "12345" }, true).tax_id);
    assert.ok(checkPartnerTax({ ...base, tax_id: "09876543210987AB" }, true).tax_id);
  });

  test("only an individual may be known by a NIK", () => {
    assert.ok(checkPartnerTax({ ...base, tax_id_type: "NIK", is_pkp: false }, true).tax_id_type);
    assert.deepEqual(
      checkPartnerTax({ ...base, taxpayer_type: "OrangPribadi", tax_id_type: "NIK", is_pkp: false }, true),
      {}
    );
  });

  test("a PKP must use its NPWP", () => {
    const e = checkPartnerTax({ ...base, taxpayer_type: "OrangPribadi", tax_id_type: "NIK", is_pkp: true }, true);
    assert.ok(e.is_pkp);
  });

  test("a government PPN collector must be a government body", () => {
    assert.ok(checkPartnerTax({ ...base, vat_collector: "Government" }, true).vat_collector);
    assert.deepEqual(
      checkPartnerTax({ ...base, taxpayer_type: "InstansiPemerintah", vat_collector: "Government" }, true),
      {}
    );
  });
});

describe("the customer's tax behaviour belongs to customers", () => {
  const partner = ENTITIES.find((e) => e.key === "m_partner")!;
  const customerFields = partner.fields.filter((f) => f.visibleWhen === "partnerIsCustomer");
  const labelOf = (label: string) => (name: string) => (name === "category_id" ? label : undefined);

  test("PPh 23, PPh 22 and Pemungut PPN apply to a Customer", () => {
    assert.deepEqual(customerFields.map((f) => f.name).sort(), [
      "collects_pph22",
      "vat_collector",
      "withholds_pph23",
    ]);
    for (const f of customerFields) {
      assert.equal(fieldApplies(f, { category_id: 1 }, labelOf("Customer")), true);
    }
  });

  test("and not to a Supplier, nor before a category is chosen", () => {
    for (const f of customerFields) {
      assert.equal(fieldApplies(f, { category_id: 2 }, labelOf("Supplier")), false);
      assert.equal(fieldApplies(f, {}, () => undefined), false);
    }
  });

  test("every Pajak field sits in the Pajak tab", () => {
    const tax = partner.fields.filter((f) => f.tab === "tax").map((f) => f.name);
    for (const name of ["taxpayer_type", "tax_id_type", "tax_id", "tax_name", "is_pkp", ...customerFields.map((f) => f.name)]) {
      assert.ok(tax.includes(name), `${name} is on the Pajak tab`);
    }
    assert.deepEqual(partner.tabs?.map((t) => t.label), ["Alamat", "Contact Person", "Pajak"]);
  });
});

describe("Supplier starts switched off", () => {
  test("the seeded Supplier category is inactive, Customer active", async () => {
    const rows = await prisma.sysPartnerCategory.findMany({
      where: { category_label: { in: ["Customer", "Supplier"] } },
      select: { category_label: true, status: true },
    });
    const status = Object.fromEntries(rows.map((r) => [r.category_label, r.status]));
    assert.equal(status.Customer, "Active");
    assert.equal(status.Supplier, "Inactive");
  });
});
