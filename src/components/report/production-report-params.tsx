"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { MultiSelect } from "@/components/ui/multi-select";
import type { RefOption } from "@/lib/erp/records";
import { reportHref } from "@/lib/erp/reports";
import { useReportRun } from "./report-run";

/**
 * The filter of the production reports (P171), in the URL like every Report View:
 * `asof` — the one date production stands at, optionally a Partai and workstations
 * (Saldo Produksi); `period` — a date range and optionally workstations (Rekap
 * Produksi); `lot` — a lot, Job or Partai number to look up (Kartu Lot, Telusur).
 */
export function ProductionReportParams({
  slug,
  mode,
  stations,
  partais,
  stationIds,
  partaiId,
  asOf,
  from,
  to,
  query,
  queryLabel,
}: {
  slug: string;
  mode: "asof" | "period" | "lot";
  stations: RefOption[];
  partais: RefOption[];
  stationIds: number[];
  partaiId: number | null;
  asOf: string;
  from: string;
  to: string;
  query: string;
  /** What the number is called on this report: a lot, or a lot / Job / Partai. */
  queryLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [stationSet, setStationSet] = useState<number[]>(stationIds);
  const [partai, setPartai] = useState<number | null>(partaiId);
  const [day, setDay] = useState(asOf);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [text, setText] = useState(query);

  const invalidRange = mode === "period" && Boolean(start && end && start > end);
  const missing = mode === "lot" && !text.trim();

  const run = () => {
    if (invalidRange || missing) return;
    startTransition(() => {
      const where = mode === "lot" ? { q: text.trim() } : { stations: stationSet.join(","), ...(mode === "asof" ? { partai, asOf: day } : { from: start, to: end }) };
      router.push(reportHref(slug, where));
    });
  };
  useReportRun(run, {
    blocked: invalidRange || missing,
    hint: invalidRange ? "Tanggal akhir tidak boleh lebih awal dari tanggal mulai." : `Isi nomor ${queryLabel} terlebih dahulu.`,
    pending,
  });

  if (mode === "lot") {
    return (
      <div className="rrow">
        <span className="rl">{queryLabel}</span>
        <div className="rf wide">
          <input
            className="inp mono"
            value={text}
            placeholder={`Nomor ${queryLabel}…`}
            aria-label={`Nomor ${queryLabel}`}
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
        {mode === "asof" && (
          <>
            <span className="rl">Partai</span>
            <div className="rf wide">
              <Combobox value={partai} options={partais} placeholder="Semua Partai" emptyText="Belum ada Partai." onChange={setPartai} />
            </div>
          </>
        )}
      </div>
      <div className="rrow">
        {mode === "asof" ? (
          <>
            <span className="rl">Per Tanggal</span>
            <div className="rf date">
              <DateInput value={day} onChange={setDay} />
            </div>
          </>
        ) : (
          <>
            <span className="rl">Periode</span>
            <div className="rf date">
              <DateInput value={start} invalid={invalidRange} onChange={setStart} />
            </div>
            <span className="rl">s/d</span>
            <div className="rf date">
              <DateInput value={end} invalid={invalidRange} onChange={setEnd} />
            </div>
            {invalidRange && (
              <span className="err">
                <Icon name="warn" size={11} />
                Tanggal akhir lebih awal dari tanggal mulai.
              </span>
            )}
          </>
        )}
      </div>
    </>
  );
}
