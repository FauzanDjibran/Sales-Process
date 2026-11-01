"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateInput } from "@/components/ui/date-input";
import { MultiSelect } from "@/components/ui/multi-select";
import type { RefOption } from "@/lib/erp/records";
import { reportHref } from "@/lib/erp/reports";
import { INVALID_RANGE_HINT, PeriodRow, invalidRange } from "./period-row";
import { useReportRun } from "./report-run";

/**
 * The filter of the production reports (R18), in the URL like every Report
 * View: `asof` — the one date production stands at, optionally workstations
 * (Saldo Produksi); `period` — a date range and optionally workstations (Rekap
 * Produksi); `lot` — a lot number to look up (Kartu Lot, Telusur Produksi).
 */
export function ProductionReportParams({
  slug,
  mode,
  stations,
  stationIds,
  asOf,
  from,
  to,
  query,
}: {
  slug: string;
  mode: "asof" | "period" | "lot";
  stations: RefOption[];
  stationIds: number[];
  asOf: string;
  from: string;
  to: string;
  query: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [stationSet, setStationSet] = useState<number[]>(stationIds);
  const [day, setDay] = useState(asOf);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [text, setText] = useState(query);

  const badRange = mode === "period" && invalidRange(start, end);
  const missing = mode === "lot" && !text.trim();

  const run = () => {
    if (badRange || missing) return;
    startTransition(() => {
      const where = mode === "lot" ? { q: text.trim() } : { stations: stationSet.join(","), ...(mode === "asof" ? { asOf: day } : { from: start, to: end }) };
      router.push(reportHref(slug, where));
    });
  };
  useReportRun(run, { blocked: badRange || missing, hint: badRange ? INVALID_RANGE_HINT : "Isi nomor lot terlebih dahulu.", pending });

  if (mode === "lot") {
    return (
      <div className="rrow">
        <span className="rl">Lot</span>
        <div className="rf wide">
          <input
            className="inp mono"
            value={text}
            placeholder="Nomor lot…"
            aria-label="Nomor lot"
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
        <span className="rl">Workstation</span>
        <div className="rf wide">
          <MultiSelect value={stationSet} options={stations} placeholder="Tambah Workstation…" emptyPlaceholder="Semua workstation" removeTitle="Keluarkan dari laporan" onChange={setStationSet} />
        </div>
      </div>
      {mode === "asof" ? (
        <div className="rrow">
          <span className="rl">Per Tanggal</span>
          <div className="rf date">
            <DateInput value={day} onChange={setDay} ariaLabel="Per tanggal" />
          </div>
        </div>
      ) : (
        <PeriodRow start={start} end={end} onStart={setStart} onEnd={setEnd} />
      )}
    </>
  );
}
