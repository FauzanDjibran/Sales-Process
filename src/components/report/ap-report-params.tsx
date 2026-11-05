"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import type { RefOption } from "@/lib/erp/records";
import { reportHref } from "@/lib/erp/reports";
import { useReportRun } from "./report-run";

/**
 * The filter for the reports read at one date: an optional supplier, and the date
 * the figures stand at. Parameters live in the URL, like every Report View.
 */
export function ApReportParams({
  slug,
  suppliers,
  supplierId,
  asOf,
  subjectRequired,
}: {
  slug: string;
  suppliers: RefOption[];
  supplierId: number | null;
  asOf: string;
  subjectRequired: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [supplier, setSupplier] = useState<number | null>(supplierId);
  const [day, setDay] = useState(asOf);

  const missing = subjectRequired && !supplier;

  useReportRun(
    () => {
      if (missing) return;
      startTransition(() => {
        router.push(reportHref(slug, { supplier, asOf: day }));
      });
    },
    {
      blocked: missing,
      hint: "Pilih Supplier terlebih dahulu.",
      pending,
    }
  );

  return (
    <>
      <div className="rrow">
        <span className="rl">Supplier</span>
        <div className="rf wide">
          <Combobox
            value={supplier}
            options={suppliers}
            placeholder={subjectRequired ? "Pilih Supplier…" : "Semua supplier"}
            onChange={setSupplier}
          />
        </div>
      </div>
      <div className="rrow">
        <span className="rl">Per Tanggal</span>
        <div className="rf date">
          <DateInput value={day} onChange={setDay} />
        </div>
      </div>
    </>
  );
}
