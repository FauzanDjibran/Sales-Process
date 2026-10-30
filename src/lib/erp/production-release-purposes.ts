/**
 * The purposes of a Production Release (R8) — a catalogue in code, like the
 * Stock Issue's. Each has its own number series.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */

export type ReleasePurposeKey = "to_stock" | "scrap";

export type ReleasePurpose = { key: ReleasePurposeKey; name: string; short: string; prefix: string; toStock: boolean; desc: string };

export const RELEASE_PURPOSES: readonly ReleasePurpose[] = [
  {
    key: "to_stock",
    name: "Penerimaan Hasil Produksi",
    short: "Ke Gudang",
    prefix: "PHP",
    toStock: true,
    desc: "Barang keluar dari Workstation ke gudang dengan lot yang sama, senilai yang dikandungnya: Dr Persediaan / Cr WIP.",
  },
  {
    key: "scrap",
    name: "Pemusnahan Produksi",
    short: "Pemusnahan",
    prefix: "PMS",
    toStock: false,
    desc: "Barang di Workstation dimusnahkan dengan alasan; nilainya menjadi beban: Dr Beban Pemusnahan Produksi / Cr WIP.",
  },
];

export function releasePurpose(key: string): ReleasePurpose | undefined {
  return RELEASE_PURPOSES.find((p) => p.key === key);
}
