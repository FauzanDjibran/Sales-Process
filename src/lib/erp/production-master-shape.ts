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

/** The kinds of work an engine in code knows (W33); a Unit does one of them (W73). */
export const PROCESS_KINDS = ["PassThrough", "Grading", "Assembly"] as const;
export const PROCESS_KIND_LABEL: Record<string, string> = {
  PassThrough: "Pass Through",
  Grading: "Grading",
  Assembly: "Assembly",
};

export const JOB_POLICIES = ["Issued", "Carried", "Released", "ReleasedWithOrder", "None"] as const;
export const JOB_POLICY_LABEL: Record<string, string> = {
  Issued: "Terbit saat keluar",
  Carried: "Dibawa",
  Released: "Dilepas, terbit baru saat keluar",
  ReleasedWithOrder: "Dilepas, terbit dengan Job Order",
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

export type RouteUnit = { id: number; process: string; workstation_id: number | null };

/** Inside a Workstation always Push, across always BSTB (W64). */
export type ExitRoute = "Push" | "BSTB";
export const EXIT_ROUTE_LABEL: Record<ExitRoute, string> = { Push: "Dokumen Push", BSTB: "BSTB" };

/**
 * How goods leave each step, worked out and never typed (W64). The last step of
 * the segment before the partai leaves by the BSTB that forms the partai; a
 * line's last step has no next Unit, so it says nothing.
 */
export function exitRoutes(workstations: (number | null)[], hasLine: boolean): (ExitRoute | null)[] {
  return workstations.map((ws, i) => {
    if (i === workstations.length - 1) return hasLine ? null : "BSTB";
    return ws != null && ws === workstations[i + 1] ? "Push" : "BSTB";
  });
}

/**
 * The rules that need the Units themselves, shared by the Server Action and the
 * seed. The segment before the partai ends at a Grading Unit, Penyebaran on the
 * Reguler line, and the partai is born on the BSTB leaving it (W73). So a line's
 * routing starts in another Workstation and never holds that Unit.
 */
export function stepRuleErrors(
  steps: Pick<StepDraft, "unit_id" | "is_checkpoint">[],
  hasLine: boolean,
  unitOf: (unitId: number) => RouteUnit | undefined,
  segmentEnd: RouteUnit | null
): string[] {
  const out: string[] = [];
  if (steps.length === 0) return ["Routing butuh minimal satu langkah."];
  const units = steps.map((s) => unitOf(s.unit_id!));
  if (!hasLine && units[units.length - 1]?.process !== "Grading") {
    out.push("Routing tanpa line harus berakhir di unit Grading, tempat BSTB keluarnya melahirkan partai.");
  }
  if (hasLine && segmentEnd) {
    if (units.some((u) => u?.id === segmentEnd.id)) out.push("Routing milik line dimulai sesudah partai lahir. Akhir segmen sebelum partai tidak boleh ada di sini.");
    else if (units[0]?.workstation_id === segmentEnd.workstation_id) out.push("Langkah pertama harus di Workstation lain, karena partai lahir pada BSTB.");
  }
  const cps = steps.map((s, i) => (s.is_checkpoint ? i : -1)).filter((i) => i >= 0);
  if (cps.length > 1) out.push("Checkpoint hanya boleh satu per routing.");
  if (cps[0] === 0) out.push("Langkah pertama tidak bisa menjadi checkpoint.");
  return out;
}
