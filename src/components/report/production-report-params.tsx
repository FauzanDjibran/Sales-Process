"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { findProductionLot } from "@/app/actions/book-entries";
import { Icon } from "@/components/icon";
import { DateInput } from "@/components/ui/date-input";
import { ChosenChips, MultiSelect } from "@/components/ui/multi-select";
import type { RefOption } from "@/lib/erp/records";
import { reportHref } from "@/lib/erp/reports";
import type { CardGroupBy, WipGroupBy } from "./production-card-reports";
import { INVALID_RANGE_HINT, PeriodRow, invalidRange } from "./period-row";
import { RunToggle } from "./report-blocks";
import { useReportRun } from "./report-run";

/**
 * The filters of the production reports, in the URL like every Report View.
 * Kelompok moves at once; the rest waits for Tampilkan. The page keys each on
 * its run, so a toggle always starts from what was applied.
 */

function Chips({ label, value, options, all, onChange }: { label: string; value: number[]; options: RefOption[]; all: string; onChange: (ids: number[]) => void }) {
  return (
    <div className="rrow">
      <span className="rl">{label}</span>
      <div className="rf wide">
        <MultiSelect value={value} options={options} placeholder={`Tambah ${label}…`} emptyPlaceholder={all} removeTitle="Keluarkan dari laporan" onChange={onChange} />
      </div>
    </div>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="rrow">
      <label className="chk sm">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <span className="ct">{label}</span>
        </span>
      </label>
    </div>
  );
}

export function WipBalanceParams({
  groupBy,
  groupHrefs,
  units,
  items,
  partai,
  initial,
  asOf,
}: {
  groupBy: WipGroupBy;
  groupHrefs: Record<WipGroupBy, string>;
  units: RefOption[];
  items: RefOption[];
  partai: RefOption[];
  initial: { unitIds: number[]; itemIds: number[]; partaiIds: number[]; auxiliary: boolean };
  asOf: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [f, setF] = useState(initial);
  const [day, setDay] = useState(asOf);
  useReportRun(
    () =>
      startTransition(() => {
        router.push(
          reportHref("wip-balance", { group: groupBy, units: f.unitIds.join(","), items: f.itemIds.join(","), partai: f.partaiIds.join(","), aux: f.auxiliary ? 1 : null, asOf: day })
        );
      }),
    { blocked: false, pending }
  );
  return (
    <>
      <div className="rrow">
        <RunToggle
          label="Kelompok"
          value={groupBy}
          options={[
            { value: "unit", label: "Per Unit", href: groupHrefs.unit },
            { value: "item", label: "Per Barang", href: groupHrefs.item },
            { value: "partai", label: "Per Partai", href: groupHrefs.partai },
          ]}
        />
      </div>
      <Chips label="Unit" value={f.unitIds} options={units} all="Semua unit" onChange={(unitIds) => setF({ ...f, unitIds })} />
      <Chips label="Barang" value={f.itemIds} options={items} all="Semua barang" onChange={(itemIds) => setF({ ...f, itemIds })} />
      <Chips label="Partai" value={f.partaiIds} options={partai} all="Semua partai" onChange={(partaiIds) => setF({ ...f, partaiIds })} />
      <div className="rrow">
        <span className="rl">Per Tanggal</span>
        <div className="rf date">
          <DateInput value={day} onChange={setDay} ariaLabel="Per tanggal" />
        </div>
      </div>
      <Check label="Sertakan Bahan Penolong" value={f.auxiliary} onChange={(auxiliary) => setF({ ...f, auxiliary })} />
    </>
  );
}

export function ProductionCardParams({
  groupBy,
  groupHrefs,
  units,
  items,
  initial,
  lots: initialLots,
  from,
  to,
  stages: initialStages,
}: {
  groupBy: CardGroupBy;
  groupHrefs: Record<CardGroupBy, string>;
  units: RefOption[];
  items: RefOption[];
  initial: { unitIds: number[]; itemIds: number[] };
  lots: string[];
  from: string;
  to: string;
  stages: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [f, setF] = useState(initial);
  const [lots, setLots] = useState(initialLots);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [stages, setStages] = useState(initialStages);
  // What the user set themself; the first No. Stok otherwise moves grouping, period and stages (the page's defaults).
  const [touched, setTouched] = useState({ period: false, stages: false });

  const invalid = invalidRange(start, end);
  const run = (chosen = lots) => {
    if (invalid) return;
    const first = chosen.length > 0 && initialLots.length === 0;
    startTransition(() => {
      router.push(
        reportHref("production-card", {
          group: first ? null : groupBy === "lot" && !chosen.length && !f.unitIds.length && !f.itemIds.length ? "unit" : groupBy,
          units: f.unitIds.join(","),
          items: f.itemIds.join(","),
          lots: chosen.join(","),
          from: first && !touched.period ? null : start,
          to: first && !touched.period ? null : end,
          stages: first && !touched.stages ? null : stages ? 1 : 0,
        })
      );
    });
  };
  useReportRun(() => run(), { blocked: invalid, hint: INVALID_RANGE_HINT, pending });

  /** A scanned number goes straight in and runs; one that does not exist is refused here. */
  const add = async () => {
    const typed = text.trim();
    if (!typed) return run();
    const found = await findProductionLot(typed);
    if (!found.ok) return setError(found.error);
    const next = lots.includes(found.no) ? lots : [...lots, found.no];
    setLots(next);
    setText("");
    setError(null);
    run(next);
  };

  return (
    <>
      <div className="rrow">
        <RunToggle
          label="Kelompok"
          value={groupBy}
          options={[
            { value: "unit", label: "Per Unit", href: groupHrefs.unit },
            { value: "item", label: "Per Barang", href: groupHrefs.item },
            { value: "lot", label: "Per No. Stok", href: groupHrefs.lot },
          ]}
        />
      </div>
      <Chips label="Unit" value={f.unitIds} options={units} all="Semua unit" onChange={(unitIds) => setF({ ...f, unitIds })} />
      <Chips label="Barang" value={f.itemIds} options={items} all="Semua barang" onChange={(itemIds) => setF({ ...f, itemIds })} />
      <div className="rrow">
        <span className="rl">No. Stok</span>
        <div className="rf wide">
          <input
            className={`inp mono${error ? " err" : ""}`}
            value={text}
            placeholder="Scan atau ketik"
            title="Tekan Enter untuk menambahkan"
            aria-label="No. Stok"
            aria-invalid={Boolean(error)}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
          />
          {lots.length > 0 && (
            <ChosenChips chips={lots.map((no) => ({ key: no, label: no }))} title="Keluarkan dari laporan" onRemove={(no) => setLots(lots.filter((l) => l !== no))} />
          )}
        </div>
        {error && (
          <span className="err">
            <Icon name="warn" size={11} />
            {error}
          </span>
        )}
      </div>
      <PeriodRow
        start={start}
        end={end}
        onStart={(v) => {
          setStart(v);
          setTouched((t) => ({ ...t, period: true }));
        }}
        onEnd={(v) => {
          setEnd(v);
          setTouched((t) => ({ ...t, period: true }));
        }}
      />
      <Check
        label="Tampilkan perpindahan tahap"
        value={stages}
        onChange={(v) => {
          setStages(v);
          setTouched((t) => ({ ...t, stages: true }));
        }}
      />
    </>
  );
}

/** One No. Stok to look up (Telusur Produksi). */
export function TraceParams({ query }: { query: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query);
  const missing = !text.trim();
  const run = () => {
    if (missing) return;
    startTransition(() => {
      router.push(reportHref("trace", { q: text.trim() }));
    });
  };
  useReportRun(run, { blocked: missing, hint: "Isi No. Stok terlebih dahulu.", pending });
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
