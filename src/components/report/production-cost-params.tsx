"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { reportHref } from "@/lib/erp/reports";
import { PeriodPick, type FiscalYearChoice, type Pick } from "./fiscal-period-params";
import { useReportRun } from "./report-run";

/**
 * The filter for the `production-cost-period` parameter set (P150 M66): a
 * month — a fiscal period — and optionally one Elemen Biaya Produksi.
 *
 *   Tahun Buku · Periode · Elemen
 *
 * A month rather than a free range, because the close spreads one fiscal
 * period's cost: these reports show what that close will read.
 */
export function ProductionCostParams({
  slug,
  years,
  value,
  elements,
  elementId,
}: {
  slug: string;
  years: FiscalYearChoice[];
  value: Pick;
  elements: { id: number; label: string; name: string }[];
  elementId: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pick, setPick] = useState<Pick>(value);
  const [element, setElement] = useState(elementId ? String(elementId) : "");
  const blocked = !pick.yearId || !pick.periodId;

  useReportRun(
    () => {
      if (blocked) return;
      startTransition(() => {
        router.push(reportHref(slug, { year: pick.yearId, period: pick.periodId, element: element || null }));
      });
    },
    { blocked, hint: "Pilih tahun buku dan periode terlebih dahulu.", pending }
  );

  return (
    <div className="rrow">
      <PeriodPick years={years} value={pick} onChange={setPick} label="Tahun Buku" />
      <span className="rsep" />
      <div className="rf">
        <Select
          variant="toolbar"
          value={element}
          set={Boolean(element)}
          onChange={setElement}
          options={[{ value: "", label: "Elemen: semua" }, ...elements.map((e) => ({ value: String(e.id), label: `${e.label} — ${e.name}` }))]}
          ariaLabel="Elemen Biaya Produksi"
        />
      </div>
    </div>
  );
}
