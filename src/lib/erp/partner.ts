import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  ADDRESSES_KEY,
  CONTACTS_KEY,
  addressErrors,
  contactErrors,
  normalizeTaxId,
  parseList,
  type AddressDraft,
  type ContactDraft,
} from "./partner-shape";

/**
 * A Partner's own collections — its addresses and contact persons — and the
 * tax identity rules that belong to it.
 *
 * These are part of the Partner record, not records of their own: they are
 * edited on the Partner's form, saved with it in one transaction, and a change
 * to them is the Partner's own audit entry (Claude-ERP.md P39). The generic
 * master action calls in here for the one entity that has them.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type RegionOption = { id: number; name: string; postalCode?: string | null };
export type RegionLevel = "province" | "city" | "district" | "village";

// ------------------------------------------------------------------ regions

/** The regions one level down from `parentId`, by name. Provinces take none. */
export async function regionOptions(
  level: RegionLevel,
  parentId: number | null
): Promise<RegionOption[]> {
  switch (level) {
    case "province":
      return (
        await prisma.sysRegionProvince.findMany({ orderBy: { name: "asc" } })
      ).map((r) => ({ id: r.id, name: r.name }));
    case "city":
      if (!parentId) return [];
      return (
        await prisma.sysRegionCity.findMany({
          where: { province_id: parentId },
          orderBy: { name: "asc" },
        })
      ).map((r) => ({ id: r.id, name: r.name }));
    case "district":
      if (!parentId) return [];
      return (
        await prisma.sysRegionDistrict.findMany({
          where: { city_id: parentId },
          orderBy: { name: "asc" },
        })
      ).map((r) => ({ id: r.id, name: r.name }));
    case "village":
      if (!parentId) return [];
      return (
        await prisma.sysRegionVillage.findMany({
          where: { district_id: parentId },
          orderBy: { name: "asc" },
        })
      ).map((r) => ({ id: r.id, name: r.name, postalCode: r.postal_code }));
  }
}

/** A kelurahan with everything above it, or null for an id that is not one. */
async function villagePath(db: Db, villageId: number) {
  return db.sysRegionVillage.findUnique({
    where: { id: villageId },
    include: { district: { include: { city: { include: { province: true } } } } },
  });
}

// -------------------------------------------------------------------- reads

/** A Partner's addresses and contacts in the shape the form edits them. */
export async function partnerCollections(
  partnerId: number
): Promise<{ addresses: AddressDraft[]; contacts: ContactDraft[] }> {
  const [addresses, contacts] = await Promise.all([
    prisma.mPartnerAddress.findMany({
      where: { partner_id: partnerId },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
      include: {
        village: { include: { district: { include: { city: { include: { province: true } } } } } },
      },
    }),
    prisma.mPartnerContact.findMany({
      where: { partner_id: partnerId },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    }),
  ]);

  return {
    addresses: addresses.map((a) => {
      const district = a.village.district;
      const city = district.city;
      return {
        id: a.id,
        key: `a${a.id}`,
        provinceId: city.province.id,
        cityId: city.id,
        districtId: district.id,
        villageId: a.village.id,
        provinceName: city.province.name,
        cityName: city.name,
        districtName: district.name,
        villageName: a.village.name,
        postalCode: a.village.postal_code ?? "",
        street: a.street,
        note: a.note ?? "",
        isBilling: a.is_billing,
        isShipping: a.is_shipping,
      };
    }),
    contacts: contacts.map((c) => ({
      id: c.id,
      key: `c${c.id}`,
      name: c.contact_name,
      position: c.position,
      phone: c.phone,
      email: c.email,
    })),
  };
}

// --------------------------------------------------------------- validation

type CleanAddress = {
  id: number | null;
  villageId: number;
  street: string;
  note: string | null;
  isBilling: boolean;
  isShipping: boolean;
};

type CleanContact = {
  id: number | null;
  name: string;
  position: string;
  phone: string;
  email: string;
};

export type PartnerCollections = { addresses: CleanAddress[]; contacts: CleanContact[] };

/** A row id the form sent back, which must be one of this Partner's own. */
function ownId(raw: unknown, own: Set<number>): number | null | false {
  if (raw == null || raw === "") return null;
  const id = Number(raw);
  return Number.isInteger(id) && own.has(id) ? id : false;
}

/**
 * Reads and checks the two collections a Partner form submits.
 *
 * Every rule the dialogs apply is applied again here, and three the dialogs
 * cannot: the kelurahan must exist and sit under the kecamatan, kota and
 * provinsi the form claims (a crafted request cannot pair a street with a
 * region it made up), a row id must be one of this Partner's own, and there is
 * at least one address.
 */
export async function checkPartnerCollections(
  values: Record<string, unknown>,
  partnerId: number | null
): Promise<{ errors: Record<string, string>; clean: PartnerCollections }> {
  const errors: Record<string, string> = {};
  const clean: PartnerCollections = { addresses: [], contacts: [] };

  const [ownAddresses, ownContacts] = partnerId
    ? await Promise.all([
        prisma.mPartnerAddress.findMany({ where: { partner_id: partnerId }, select: { id: true } }),
        prisma.mPartnerContact.findMany({ where: { partner_id: partnerId }, select: { id: true } }),
      ])
    : [[], []];
  const addressIds = new Set(ownAddresses.map((a) => a.id));

  // An address a document names is part of that document's record (P53): it
  // stays, however the Partner's list is edited. Asked through the address's
  // own relation, so this module never reads another module's table.
  const inUse = partnerId
    ? new Set(
        (
          await prisma.mPartnerAddress.findMany({
            where: {
              partner_id: partnerId,
              OR: [
                { customer_orders: { some: {} } },
                { sales_orders: { some: {} } },
                { delivery_orders: { some: {} } },
                { delivery_notes: { some: {} } },
                { invoices: { some: {} } },
              ],
            },
            select: { id: true },
          })
        ).map((a) => a.id)
      )
    : new Set<number>();
  const contactIds = new Set(ownContacts.map((c) => c.id));

  // ---- addresses
  const addresses = parseList<Partial<AddressDraft>>(values[ADDRESSES_KEY]);
  if (addresses === null) {
    errors[ADDRESSES_KEY] = "Data alamat tidak terbaca.";
  } else if (addresses.length === 0) {
    errors[ADDRESSES_KEY] = "Partner wajib memiliki minimal satu alamat.";
  } else {
    const problems: string[] = [];
    for (const [i, a] of addresses.entries()) {
      const n = i + 1;
      const rowErrors = addressErrors(a);
      if (Object.keys(rowErrors).length) {
        problems.push(`Alamat ${n}: ${Object.values(rowErrors)[0]}`);
        continue;
      }
      const id = ownId(a.id, addressIds);
      if (id === false) {
        problems.push(`Alamat ${n}: bukan alamat milik Partner ini.`);
        continue;
      }
      const village = await villagePath(prisma, Number(a.villageId));
      const consistent =
        village &&
        village.district.id === Number(a.districtId) &&
        village.district.city.id === Number(a.cityId) &&
        village.district.city.province.id === Number(a.provinceId);
      if (!consistent) {
        problems.push(`Alamat ${n}: wilayah yang dipilih tidak saling cocok.`);
        continue;
      }
      clean.addresses.push({
        id,
        villageId: village.id,
        street: String(a.street).trim(),
        note: String(a.note ?? "").trim() || null,
        isBilling: a.isBilling === true,
        isShipping: a.isShipping === true,
      });
    }
    // A removed address that a Customer Order names is refused.
    const kept = new Set(addresses.map((x) => Number(x.id)).filter(Boolean));
    const removedInUse = [...inUse].filter((id) => !kept.has(id));
    if (removedInUse.length) {
      problems.push(
        `${removedInUse.length} alamat yang dihapus sudah dipakai Customer Order dan tidak dapat dihapus.`
      );
    }
    if (problems.length) errors[ADDRESSES_KEY] = problems.join(" ");
  }

  // ---- contacts: none is fine, but each one given is complete.
  const contacts = parseList<Partial<ContactDraft>>(values[CONTACTS_KEY]);
  if (contacts === null) {
    errors[CONTACTS_KEY] = "Data contact person tidak terbaca.";
  } else {
    const problems: string[] = [];
    for (const [i, c] of contacts.entries()) {
      const n = i + 1;
      const rowErrors = contactErrors(c);
      if (Object.keys(rowErrors).length) {
        problems.push(`Contact ${n}: ${Object.values(rowErrors)[0]}`);
        continue;
      }
      const id = ownId(c.id, contactIds);
      if (id === false) {
        problems.push(`Contact ${n}: bukan contact milik Partner ini.`);
        continue;
      }
      clean.contacts.push({
        id,
        name: String(c.name).trim(),
        position: String(c.position).trim(),
        phone: String(c.phone).trim(),
        email: String(c.email).trim(),
      });
    }
    if (problems.length) errors[CONTACTS_KEY] = problems.join(" ");
  }

  return { errors, clean };
}

/**
 * The tax identity rules, beyond each field being filled in.
 *
 * `values` are the submitted form values; `tax_id` is judged with its
 * separators removed, which is also how it is stored.
 */
export function checkPartnerTax(
  values: Record<string, unknown>,
  appliesCustomerFields: boolean
): Record<string, string> {
  const errors: Record<string, string> = {};
  const type = String(values.taxpayer_type ?? "");
  const idType = String(values.tax_id_type ?? "");
  const taxId = normalizeTaxId(values.tax_id);
  const pkp = values.is_pkp === true || values.is_pkp === "true";

  if (taxId && !/^\d{16}$/.test(taxId)) {
    errors.tax_id = "Nomor identitas harus 16 digit angka.";
  }
  // Only an individual may be known by a NIK; a company or a government body
  // is registered by its NPWP.
  if (idType === "NIK" && type && type !== "OrangPribadi") {
    errors.tax_id_type = "NIK hanya dapat dipakai Wajib Pajak Orang Pribadi.";
  }
  // A PKP issues and receives faktur under its NPWP.
  if (pkp && idType === "NIK") {
    errors.is_pkp = "PKP wajib memakai NPWP, bukan NIK.";
  }
  // Kode transaksi 02 is for a government treasurer; anyone else who collects
  // PPN is outside what this application models yet.
  if (
    appliesCustomerFields &&
    values.vat_collector === "Government" &&
    type &&
    type !== "InstansiPemerintah"
  ) {
    errors.vat_collector = "Pemungut PPN Instansi Pemerintah hanya untuk Tipe Wajib Pajak Instansi Pemerintah.";
  }
  return errors;
}

/**
 * The default Termin must exist and be active, unless it is the one the
 * Partner already carries — an old default stays readable, a new pick must be
 * one the picker offers.
 */
export async function checkPartnerSalesDefaults(
  values: Record<string, unknown>,
  partnerId: number | null
): Promise<Record<string, string>> {
  // The sales term (P51) and the purchase term (P122) follow one rule: an
  // inactive term may stay where it already was, never be chosen anew.
  const errors: Record<string, string> = {};
  const current = partnerId
    ? await prisma.mPartner.findUnique({ where: { id: partnerId }, select: { default_term_id: true, purchase_term_id: true } })
    : null;
  for (const field of ["default_term_id", "purchase_term_id"] as const) {
    const termId = Number(values[field]) || null;
    if (!termId) continue;
    const term = await prisma.refPaymentTerm.findUnique({ where: { id: termId }, select: { status: true } });
    if (!term) errors[field] = "Termin tidak ditemukan.";
    else if (term.status !== "Active" && current?.[field] !== termId) errors[field] = "Termin tersebut sudah nonaktif.";
  }
  return errors;
}

// ------------------------------------------------------------------- writes

/**
 * Makes the Partner's addresses and contacts exactly what was submitted:
 * updates the rows it kept, adds the new ones, removes the ones taken out.
 *
 * Removing is a real delete. Nothing refers to an address or a contact yet;
 * when a document does, it keeps its own copy of what it printed, so the
 * Partner's list can stay what the Partner is today (Claude-ERP.md §17).
 */
export async function writePartnerCollections(
  tx: Prisma.TransactionClient,
  partnerId: number,
  clean: PartnerCollections,
  actorId: number
): Promise<void> {
  const keepAddresses = clean.addresses.flatMap((a) => (a.id ? [a.id] : []));
  await tx.mPartnerAddress.deleteMany({
    where: { partner_id: partnerId, id: { notIn: keepAddresses } },
  });
  for (const [order, a] of clean.addresses.entries()) {
    const data = {
      village_id: a.villageId,
      street: a.street,
      note: a.note,
      is_billing: a.isBilling,
      is_shipping: a.isShipping,
      sort_order: order,
    };
    if (a.id) {
      await tx.mPartnerAddress.update({
        where: { id: a.id },
        data: { ...data, updated_by: actorId },
      });
    } else {
      await tx.mPartnerAddress.create({
        data: { ...data, partner_id: partnerId, created_by: actorId },
      });
    }
  }

  const keepContacts = clean.contacts.flatMap((c) => (c.id ? [c.id] : []));
  await tx.mPartnerContact.deleteMany({
    where: { partner_id: partnerId, id: { notIn: keepContacts } },
  });
  for (const [order, c] of clean.contacts.entries()) {
    const data = {
      contact_name: c.name,
      position: c.position,
      phone: c.phone,
      email: c.email,
      sort_order: order,
    };
    if (c.id) {
      await tx.mPartnerContact.update({
        where: { id: c.id },
        data: { ...data, updated_by: actorId },
      });
    } else {
      await tx.mPartnerContact.create({
        data: { ...data, partner_id: partnerId, created_by: actorId },
      });
    }
  }
}
