"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateInput } from "@/components/ui/date-input";
import { MultiSelect } from "@/components/ui/multi-select";
import type { RefOption } from "@/lib/erp/records";
import { reportHref } from "@/lib/erp/reports";
import { useReportRun } from "./report-run";

/**
 * The filter of the production reports (R18), in the URL like every Report
 * View: `asof` — the one date production stands at, optionally units
 * (Saldo Produksi); `lot` — a lot number to look up (Kartu Lot, Telusur Produksi).
 */
export function ProductionReportParams({
  slug,
  mode,
  stations,
  stationIds,
  asOf,
  query,
}: {
  slug: string;
  mode: "asof" | "lot";
  stations: RefOption[];
  stationIds: number[];
  asOf: string;
  query: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [stationSet, setStationSet] = useState<number[]>(stationIds);
  const [day, setDay] = useState(asOf);
  const [text, setText] = useState(query);

  const missing = mode === "lot" && !text.trim();

  const run = () => {
    if (missing) return;
    startTransition(() => {
      const where = mode === "lot" ? { q: text.trim() } : { stations: stationSet.join(","), asOf: day };
      router.push(reportHref(slug, where));
    });
  };
  useReportRun(run, { blocked: missing, hint: "Isi No. Stok terlebih dahulu.", pending });

  if (mode === "lot") {
    return (
      <div className="rrow">
        <span className="rl">No. Stok</span>
        <div className="rf wide">
          <input
            className="inp mono"
            value={text}
            placeholder="No. Stok…"
            aria-label="No. Stok"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
            }}
          />
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="rrow">
        <span className="rl">Unit</span>
        <div className="rf wide">
          <MultiSelect value={stationSet} options={stations} placeholder="Tambah Unit…" emptyPlaceholder="Semua unit" removeTitle="Keluarkan dari laporan" onChange={setStationSet} />
        </div>
      </div>
      <div className="rrow">
        <span className="rl">Per Tanggal</span>
        <div className="rf date">
          <DateInput value={day} onChange={setDay} ariaLabel="Per tanggal" />
        </div>
      </div>
    </>
  );
}
