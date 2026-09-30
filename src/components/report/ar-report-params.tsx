"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import type { RefOption } from "@/lib/erp/records";
import { reportHref } from "@/lib/erp/reports";
import { useReportRun } from "./report-run";

/**
 * The filter for the AR reports (P75): a customer, then either one date the
 * figures stand at (`ar-asof`) or a period (`ar-period`). Parameters live in
 * the URL, like every Report View, so a run can be linked and bookmarked.
 * Buku Piutang adds the *Sertakan Uang Muka* switch, off by default (P77).
 */
export function ArReportParams({
  slug,
  customers,
  customerId,
  mode,
  asOf,
  from,
  to,
  subjectRequired,
  advance = null,
}: {
  slug: string;
  customers: RefOption[];
  customerId: number | null;
  mode: "asof" | "period";
  asOf: string;
  from: string;
  to: string;
  subjectRequired: boolean;
  /** Buku Piutang only: whether Uang Muka entries are in the book (P77); null hides the switch. */
  advance?: boolean | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [customer, setCustomer] = useState<number | null>(customerId);
  const [day, setDay] = useState(asOf);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [withAdvance, setWithAdvance] = useState(Boolean(advance));

  const invalidRange = mode === "period" && Boolean(start && end && start > end);
  const missing = subjectRequired && !customer;

  useReportRun(
    () => {
      if (invalidRange || missing) return;
      startTransition(() => {
        router.push(
          reportHref(
            slug,
            mode === "asof"
              ? { customer, asOf: day }
              : { customer, from: start, to: end, advance: advance !== null && withAdvance ? 1 : null }
          )
        );
      });
    },
    {
      blocked: invalidRange || missing,
      hint: invalidRange ? "Tanggal akhir tidak boleh lebih awal dari tanggal mulai." : "Pilih Customer terlebih dahulu.",
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
            {advance !== null && (
              <>
                <span className="rsep" />
                <label className="chk sm" title="Masukkan uang muka customer ke dalam buku, sehingga posisinya bersih setelah uang muka.">
                  <input type="checkbox" checked={withAdvance} onChange={(e) => setWithAdvance(e.target.checked)} />
                  <span>
                    <span className="ct">Sertakan Uang Muka</span>
                  </span>
                </label>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
