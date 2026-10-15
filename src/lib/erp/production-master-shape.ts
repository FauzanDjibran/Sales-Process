/**
 * A Bill of Materials' lines and a Routing's steps on their way between the
 * form and the Server Action, and the rules both sides apply (Walet build
 * step 1; `walet/build-plan.md`).
 *
 * - A **BoM** lists, per its base quantity of the output item, the components
 *   that go in — a suggestion an execution starts from, never a limit. A line
 *   may name the routing step that consumes it.
 * - A **Routing** lists the workstations a Partai passes on its way to its
 *   target item, in order, each with how it works.
 *
 * Client-safe on purpose — no `server-only`, no database — so the dialogs
 * refuse exactly what the Server Action refuses.
 */

export type RoutingStepModeValue = "MixTransform" | "Transform" | "PassThrough";

export const ROUTING_MODE_TEXT: Record<RoutingStepModeValue, string> = {
  MixTransform: "Mix + Transformasi",
  Transform: "Transformasi",
  PassThrough: "Pass-through",
};

/** One BoM line as the form holds it. */
export type BomLineDraft = {
  id?: number;
  key: string;
  itemId: number | null;
  /** Unformatted with a `.` decimal point. */
  qty: string;
  /** The routing step that consumes it; null = the step that makes the output. */
  stepNo: number | null;
};

/** One Routing step as the form holds it; its number is its place in the list. */
export type RoutingStepDraft = {
  id?: number;
  key: string;
  workstationId: number | null;
  mode: RoutingStepModeValue;
  bomId: number | null;
};

/** The form values the collections travel under. */
export const BOM_LINES_KEY = "_lines";
export const ROUTING_STEPS_KEY = "_steps";

/** The option sets the tabs pick from (the tabs are not fields). */
export const BOM_COMPONENT_OPTIONS = "_bom_components";
export const ROUTING_WORKSTATION_OPTIONS = "_routing_workstations";
export const ROUTING_BOM_OPTIONS = "_routing_boms";

const positive = (raw: string) => {
  const s = String(raw ?? "").trim();
  const n = Number(s);
  return s !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

/** Field errors for one BoM line. `taken` are the items the other lines name; `outputItemId` is the BoM's own item. */
export function bomLineErrors(line: Partial<BomLineDraft>, taken: number[], outputItemId: number | null): Record<string, string> {
  const e: Record<string, string> = {};
  if (!line.itemId) e.itemId = "Pilih komponen.";
  else if (line.itemId === outputItemId) e.itemId = "Komponen tidak boleh barang hasilnya sendiri.";
  else if (taken.includes(line.itemId)) e.itemId = "Komponen ini sudah ada di BoM.";
  if (positive(String(line.qty ?? "")) == null) e.qty = "Isi jumlah lebih dari 0.";
  if (line.stepNo != null && !(Number.isInteger(line.stepNo) && line.stepNo > 0)) e.stepNo = "Langkah harus bilangan bulat lebih dari 0.";
  return e;
}

/** Field errors for one Routing step. */
export function routingStepErrors(step: Partial<RoutingStepDraft>): Record<string, string> {
  const e: Record<string, string> = {};
  if (!step.workstationId) e.workstationId = "Pilih workstation.";
  if (!step.mode || !(step.mode in ROUTING_MODE_TEXT)) e.mode = "Pilih cara kerja.";
  return e;
}
