"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import type { RefOption } from "@/lib/erp/records";
import { reportHref } from "@/lib/erp/reports";
import { useReportRun } from "./report-run";

/**
 * The filter for the reports read at one date: an optional customer, and the date
 * the figures stand at. Parameters live in the URL, like every Report View.
 */
export function ArReportParams({
  slug,
  customers,
  customerId,
  asOf,
  subjectRequired,
}: {
  slug: string;
  customers: RefOption[];
  customerId: number | null;
  asOf: string;
  subjectRequired: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [customer, setCustomer] = useState<number | null>(customerId);
  const [day, setDay] = useState(asOf);

  const missing = subjectRequired && !customer;

  useReportRun(
    () => {
      if (missing) return;
      startTransition(() => {
        router.push(reportHref(slug, { customer, asOf: day }));
      });
    },
    {
      blocked: missing,
      hint: "Pilih Customer terlebih dahulu.",
      pending,
    }
  );

  return (
    <>
      <div className="rrow">
        <span className="rl">Customer</span>
        <div className="rf wide">
          <Combobox
            value={customer}
            options={customers}
            placeholder={subjectRequired ? "Pilih Customer…" : "Semua customer"}
            onChange={setCustomer}
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
