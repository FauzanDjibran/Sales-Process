"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { reportHref } from "@/lib/erp/reports";
import { PeriodPick, type FiscalYearChoice, type Pick } from "./fiscal-period-params";
import { useReportRun } from "./report-run";

/**
 * The filter for the `production-cost-period` parameter set (P154, M90): a
 * month — a fiscal period — and optionally one Cost Center.
 *
 *   Tahun Buku · Periode · Cost Center
 *
 * A month rather than a free range, because the close spreads one fiscal
 * period's pool: the report shows what that close will read.
 */
export function ProductionCostParams({
  slug,
  years,
  value,
  costCenters,
  costCenterId,
}: {
  slug: string;
  years: FiscalYearChoice[];
  value: Pick;
  costCenters: { id: number; label: string; name: string }[];
  costCenterId: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pick, setPick] = useState<Pick>(value);
  const [center, setCenter] = useState(costCenterId ? String(costCenterId) : "");
  const blocked = !pick.yearId || !pick.periodId;

  useReportRun(
    () => {
      if (blocked) return;
      startTransition(() => {
        router.push(reportHref(slug, { year: pick.yearId, period: pick.periodId, center: center || null }));
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
          value={center}
          set={Boolean(center)}
          onChange={setCenter}
          options={[{ value: "", label: "Cost Center: semua" }, ...costCenters.map((c) => ({ value: String(c.id), label: `${c.label} — ${c.name}` }))]}
          ariaLabel="Cost Center"
        />
      </div>
    </div>
  );
}
