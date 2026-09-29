/**
 * What a Partner's addresses and contacts look like on their way between the
 * form and the Server Action, and the rules both sides apply to them.
 *
 * Client-safe on purpose — no `server-only`, no database — so the dialog that
 * collects an address refuses exactly what the Server Action refuses, and the
 * table and the detail print an address in the one format (Claude-ERP.md P39).
 * The Server Action still runs every rule itself; the form only narrows.
 */

/** One address as the form holds it. */
export type AddressDraft = {
  /** The saved row, or absent for an address added in this edit. */
  id?: number;
  /** Stable within the form, so a row survives reordering and removal. */
  key: string;
  provinceId: number | null;
  cityId: number | null;
  districtId: number | null;
  villageId: number | null;
  /** Names of the chosen regions, for display only — the server re-reads them. */
  provinceName: string;
  cityName: string;
  districtName: string;
  villageName: string;
  postalCode: string;
  street: string;
  note: string;
  isBilling: boolean;
  isShipping: boolean;
};

/** One contact person as the form holds it. */
export type ContactDraft = {
  id?: number;
  key: string;
  name: string;
  position: string;
  phone: string;
  email: string;
};

/** The form value names the two collections travel under. */
export const ADDRESSES_KEY = "_addresses";
export const CONTACTS_KEY = "_contacts";

export const STREET_MAX = 500;
export const NOTE_MAX = 500;

/**
 * `Provinsi, Kota, Kecamatan, Kelurahan, Alamat, Kode Pos` — the one line an
 * address is shown as, in the order the user asked for, skipping what is blank.
 */
export function formatAddress(a: {
  provinceName: string;
  cityName: string;
  districtName: string;
  villageName: string;
  street: string;
  postalCode: string;
}): string {
  return [a.provinceName, a.cityName, a.districtName, a.villageName, a.street, a.postalCode]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/** Reads a submitted collection, or null when it is not a list of objects. */
export function parseList<T>(raw: unknown): T[] | null {
  if (raw == null || raw === "") return [];
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  if (!value.every((v) => v && typeof v === "object")) return null;
  return value as T[];
}

/** Field errors for one address, keyed by the dialog's field names. */
export function addressErrors(a: Partial<AddressDraft>): Record<string, string> {
  const e: Record<string, string> = {};
  if (!a.provinceId) e.province = "Provinsi wajib dipilih.";
  if (!a.cityId) e.city = "Kota / Kabupaten wajib dipilih.";
  if (!a.districtId) e.district = "Kecamatan wajib dipilih.";
  if (!a.villageId) e.village = "Kelurahan / Desa wajib dipilih.";
  const street = (a.street ?? "").trim();
  if (!street) e.street = "Alamat wajib diisi.";
  else if (street.length > STREET_MAX) e.street = `Alamat paling panjang ${STREET_MAX} karakter.`;
  if ((a.note ?? "").trim().length > NOTE_MAX) e.note = `Catatan paling panjang ${NOTE_MAX} karakter.`;
  return e;
}

// A pragmatic shape check: something before and after one @, and a dot in the
// domain. Deliverability is not this form's to prove.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Digits with the separators people actually type: spaces, dashes, dots,
// brackets and a leading +.
const PHONE = /^\+?[0-9][0-9 ().-]{5,}$/;

/** Field errors for one contact, keyed by the dialog's field names. */
export function contactErrors(c: Partial<ContactDraft>): Record<string, string> {
  const e: Record<string, string> = {};
  const name = (c.name ?? "").trim();
  const position = (c.position ?? "").trim();
  const phone = (c.phone ?? "").trim();
  const email = (c.email ?? "").trim();
  if (!name) e.name = "Nama wajib diisi.";
  if (!position) e.position = "Posisi wajib diisi.";
  if (!phone) e.phone = "Nomor Telepon wajib diisi.";
  else if (!PHONE.test(phone)) e.phone = "Nomor Telepon hanya berisi angka, spasi, tanda - atau +.";
  if (!email) e.email = "Email wajib diisi.";
  else if (!EMAIL.test(email)) e.email = "Format email tidak valid.";
  return e;
}

/** A 16-digit NPWP or NIK with its separators taken out. */
export function normalizeTaxId(raw: unknown): string {
  return String(raw ?? "").replace(/[\s.-]/g, "");
}

/** `0987654321098765` -> `0987 6543 2109 8765`, how the simulation prints one. */
export function formatTaxId(id: string | null | undefined): string {
  const digits = String(id ?? "");
  return digits.length === 16 ? digits.replace(/(\d{4})(?=\d)/g, "$1 ") : digits;
}
