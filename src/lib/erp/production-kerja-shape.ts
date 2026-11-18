/** Kerja's words, client-safe (P282). */
export type KerjaStatus = "Running" | "Finished" | "Cancelled";
export const KERJA_STATUS_TEXT: Record<KerjaStatus, string> = { Running: "Berjalan", Finished: "Selesai", Cancelled: "Dibatalkan" };
export const KERJA_BADGE: Record<KerjaStatus, string> = { Running: "s-warn", Finished: "s-ok", Cancelled: "s-mute" };
