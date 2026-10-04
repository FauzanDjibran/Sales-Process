"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import type { JournalPreviewResult } from "@/lib/erp/journal";
import { formatMoney } from "@/lib/format";

/**
 * The journal a Posting is about to write, inside its confirmation —
 * consequences before commitment (P103, shared design convention §9.1).
 *
 * `load` runs the document's own posting path as a dry run on the server, so
 * what is shown is the journal Posting writes rather than a second calculation
 * of it. A posting that would be refused says why here, in Posting's own words,
 * and `onReady` tells the dialog whether there is anything to confirm, so
 * *Ya, Posting* stays disabled until the journal has loaded.
 *
 * Carried from SIBA's `JournalPreview`. Figures use the app's money format;
 * the accountant's ledger form (`(Rp …)`, `—`) arrives with SIBA's ledger
 * figures (Knowledge-Base SYNC-PLAN 2A.2).
 */
export function JournalPreview({
  load,
  onReady,
}: {
  load: () => Promise<JournalPreviewResult>;
  onReady: (postable: boolean) => void;
}) {
  const [result, setResult] = useState<JournalPreviewResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void load().then((r) => {
      if (cancelled) return;
      setResult(r);
      onReady(r.ok);
    });
    return () => {
      cancelled = true;
    };
    // Loaded once per confirmation: the dialog mounts this when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result) {
    return <div className="apmap">Menyiapkan journal yang akan ditulis…</div>;
  }
  if (!result.ok) {
    return (
      <div className="apmap warn">
        <Icon name="warn" size={13} />
        {result.errors._form ?? Object.values(result.errors)[0]}
      </div>
    );
  }

  const money = (n: number) => (n ? formatMoney(n, "IDR") : "");
  const debit = result.lines.reduce((t, l) => t + l.debit, 0);
  const credit = result.lines.reduce((t, l) => t + l.credit, 0);
  return (
    <div className="tw boxed">
      <table className="grid">
        <thead>
          <tr>
            <th>Account</th>
            <th className="num" style={{ width: 136 }}>
              Debit
            </th>
            <th className="num" style={{ width: 136 }}>
              Kredit
            </th>
          </tr>
        </thead>
        <tbody>
          {result.lines.map((l, i) => (
            <tr key={i}>
              <td className="wrapok">
                <span className="dstack">
                  <span className="d1">
                    <span className="lab">{l.accountLabel}</span> {l.accountName}
                  </span>
                  <span className="d2">
                    {l.partnerLabel ? `${l.partnerLabel} – ${l.partnerName} · ` : ""}
                    {l.description}
                  </span>
                </span>
              </td>
              <td className="num">
                <span className="mny">{money(l.debit)}</span>
              </td>
              <td className="num">
                <span className="mny">{money(l.credit)}</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="totrow">
            <td style={{ textAlign: "right" }}>Total</td>
            <td className="num">
              <span className="mny">{formatMoney(debit, "IDR")}</span>
            </td>
            <td className="num">
              <span className="mny">{formatMoney(credit, "IDR")}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
