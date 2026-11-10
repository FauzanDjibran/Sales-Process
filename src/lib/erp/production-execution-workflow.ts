/**
 * The three documents of work at a Unit (W29, W65): each runs the lifecycle
 * production documents share, in its own words. Client-safe.
 */
import { prodDocWorkflow } from "./production-doc-workflow";

export const GRADING_PATH = "/production/grading";
export const WORK_PATH = "/production/work";
export const QC_CHECK_PATH = "/production/qc-check";

export const GRADING_WORKFLOW = prodDocWorkflow({
  noun: "No. Grading",
  prefix: "PRODUCTION_GRADING",
  path: GRADING_PATH,
  journal: true,
  postIcon: "layers",
  postBody: "Input keluar dari Persiapan, biaya unit masuk, dan tiap output menjadi No. Stok baru.",
});

export const WORK_WORKFLOW = prodDocWorkflow({
  noun: "Pengerjaan Unit",
  prefix: "PRODUCTION_WORK",
  path: WORK_PATH,
  journal: true,
  postIcon: "check",
  postBody: "Barang keluar dari Persiapan dengan gram yang sama, dan biaya unit menambah nilainya.",
});

export const QC_CHECK_WORKFLOW = prodDocWorkflow({
  noun: "QC Check",
  prefix: "PRODUCTION_QC",
  path: QC_CHECK_PATH,
  journal: false,
  postIcon: "check",
  postBody: "Baris Lulus masuk Stand By; baris Balik kembali ke Persiapan unit ini sebagai baris sendiri. Tidak ada journal.",
});

export const QC_DECISION_TEXT = { Pass: "Lulus", Return: "Balik" } as const;
export type QcDecision = keyof typeof QC_DECISION_TEXT;
