/**
 * A Routing's steps and a Standard Cost's rates on their way between the form
 * and the Server Action (P225), and the rules both sides apply to them.
 *
 * Client-safe on purpose — no `server-only`, no database — so the dialog
 * refuses exactly what the Server Action refuses.
 */

/** The form values the two collections travel under (`_<tab key>`). */
export const STEPS_KEY = "_steps";
export const RATES_KEY = "_rates";

export const EXIT_MODES = ["Direct", "NoQc", "WithQc", "PerCarton"] as const;
export const EXIT_MODE_LABEL: Record<string, string> = {
  Direct: "Langsung",
  NoQc: "Tanpa QC",
  WithQc: "Dengan QC",
  PerCarton: "Per Kotak",
};

export const JOB_POLICIES = ["Issued", "Carried", "Released", "None"] as const;
export const JOB_POLICY_LABEL: Record<string, string> = {
  Issued: "Terbit",
  Carried: "Dibawa",
  Released: "Dilepas",
  None: "Tidak ada",
};

export type StepDraft = {
  id?: number;
  key: string;
  unit_id: number | null;
  is_checkpoint: boolean;
  is_skippable: boolean;
};

export type RateDraft = {
  id?: number;
  key: string;
  unit_id: number | null;
  /** Unformatted, `.` decimal point; empty is refused (leave the unit out for 0). */
  rate: string;
};

/** Field errors for one step; `takenUnits` are the routing's other steps' units. */
export function stepErrors(s: Partial<StepDraft>, takenUnits: number[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (!s.unit_id) e.unit_id = "Pilih unit.";
  else if (takenUnits.includes(s.unit_id)) e.unit_id = "Unit ini sudah ada di routing.";
  return e;
}

export function rateErrors(r: Partial<RateDraft>, takenUnits: number[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (!r.unit_id) e.unit_id = "Pilih unit.";
  else if (takenUnits.includes(r.unit_id)) e.unit_id = "Unit ini sudah punya rate di versi ini.";
  const text = String(r.rate ?? "").trim();
  const n = Number(text);
  if (!text || !Number.isFinite(n) || n < 0) e.rate = "Isi rate 0 atau lebih.";
  else if (!/^\d+(\.\d{1,6})?$/.test(text)) e.rate = "Rate paling banyak 6 angka desimal.";
  else if (n >= 1e12) e.rate = "Rate terlalu besar.";
  return e;
}

/**
 * The rules that need the Units' own kinds of work, shared by the Server
 * Action. A routing without a line is the segment before the partai: it ends
 * at the one Unit that forms the partai. A line's routing starts after it.
 */
export function stepRuleErrors(
  steps: Pick<StepDraft, "unit_id" | "is_checkpoint">[],
  hasLine: boolean,
  processesOf: (unitId: number) => string[]
): string[] {
  const out: string[] = [];
  if (steps.length === 0) return ["Routing butuh minimal satu langkah."];
  const former = (i: number) => processesOf(steps[i].unit_id!).includes("PartaiFormer");
  const formers = steps.map((_, i) => i).filter(former);
  if (hasLine && formers.length) out.push("Routing milik line dimulai sesudah partai terbentuk. Keluarkan unit Pembentuk Partai dari sini: tempatnya di routing tanpa line.");
  if (!hasLine) {
    if (formers.length !== 1 || formers[0] !== steps.length - 1) {
      out.push("Routing tanpa line harus berakhir di satu unit Pembentuk Partai, tempat line dipilih. Unit sesudahnya masuk routing milik line.");
    }
  }
  const cps = steps.map((s, i) => (s.is_checkpoint ? i : -1)).filter((i) => i >= 0);
  if (cps.length > 1) out.push("Checkpoint hanya boleh satu per routing.");
  if (cps[0] === 0) out.push("Langkah pertama tidak bisa menjadi checkpoint.");
  return out;
}

/** A Unit's own rule: only Assembly makes kotak, so only it sends per kotak. */
export function unitExitError(exitMode: string, processes: string[]): string | null {
  return exitMode === "PerCarton" && !processes.includes("Assembly") ? "Per Kotak hanya untuk unit dengan pekerjaan Assembly." : null;
}
