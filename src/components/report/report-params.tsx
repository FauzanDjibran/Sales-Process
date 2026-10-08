"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@/components/ui/combobox";
import type { RefOption } from "@/lib/erp/records";
import { reportHref } from "@/lib/erp/reports";
import { useReportRun } from "./report-run";
import { INVALID_RANGE_HINT, PeriodRow, invalidRange } from "./period-row";

/**
 * The filter for the `cash-bank-period` parameter set: a Cash & Bank subject
 * plus an inclusive date range.
 *
 * **Parameters live in the URL**, which is the part of the Report View
 * convention that matters most here. Running a report is a navigation, so a run
 * can be linked to a colleague, bookmarked, and stepped through with the back
 * button — and the page stays a Server Component that queries the database
 * directly, with no client-side fetching (CLAUDE.md §3).
 *
 * The controls are the application's own `Combobox` and `DateInput`, never a
 * native `<select>` or `<input type="date">` — those are drawn by the operating
 * system in its own locale, and a report whose dates read differently on two
 * machines is a data hazard (§12). Compact, because this sits in the sticky
 * page header and every pixel it takes is a pixel the report does not get.
 *
 * Two rows, in the order they are filled in — the resource, then the period — with *Tampilkan* in the header's action slot, top right,
 * like Simpan on a form.
 */
export function ReportParams({
  slug,
  resources,
  cashBankId,
  from,
  to,
  subjectRequired,
  subjectLabel,
  allLabel,
  lead,
}: {
  slug: string;
  resources: RefOption[];
  cashBankId: number | null;
  from: string;
  to: string;
  subjectRequired: boolean;
  subjectLabel: string;
  /** Copy for "no subject chosen", where the report allows it. */
  allLabel?: string;
  /** What comes before the resource on the first row, where a report has one. */
  lead?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [subject, setSubject] = useState<number | null>(cashBankId);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);

  const invalid = invalidRange(start, end);
  const missingSubject = subjectRequired && !subject;

  useReportRun(
    () => {
      if (invalid || missingSubject) return;
      startTransition(() => {
        router.push(
          reportHref(slug, {
            cashBank: subject,
            from: start,
            to: end,
          })
        );
      });
    },
    {
      blocked: invalid || missingSubject,
      hint: invalid
        ? INVALID_RANGE_HINT
        : "Pilih Cash & Bank terlebih dahulu.",
      pending,
    }
  );

  return (
    <>
      <div className="rrow">
        {lead}
        <span className="rl">{subjectLabel}</span>
        <div className="rf wide">
          <Combobox
            value={subject}
            options={resources}
            placeholder={allLabel ?? "Pilih Cash & Bank…"}
            onChange={setSubject}
          />
        </div>
      </div>

      <PeriodRow start={start} end={end} onStart={setStart} onEnd={setEnd} />
    </>
  );
}
