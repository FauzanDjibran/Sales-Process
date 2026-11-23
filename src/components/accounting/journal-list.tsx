"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import { documentHref } from "@/lib/erp/document-links";
import { STATUS_CLASS, STATUS_TEXT } from "@/lib/erp/entities";
import type { JournalRow } from "@/lib/erp/journal";
import {
  JOURNAL_TRANSITIONS,
  availableJournalActions,
  journalIsEditable,
  type JournalAbilities,
  type JournalStatus,
} from "@/lib/erp/journal-workflow";
import type { Paged } from "@/lib/erp/register-query";

const STATUSES: JournalStatus[] = ["Draft", "Posted", "Cancelled"];
const cents = (n: number) => Math.round(n * 100);

/**
 * The Journal register — every journal, however it came to exist, paged by the
 * database (P224). Most are written by a document being posted and are never
 * edited; a manual journal is typed here, saved as a Draft and posted through
 * the same engine, so only it offers Ubah and a step. One Nilai: a posted
 * journal's two sides are equal, and a row where they are not says so.
 */
export function JournalList({ journals, can }: { journals: Paged<JournalRow>; can: JournalAbilities }) {
  return (
    <DocumentRegister
      module="Accounting"
      icon="book"
      title="Journal"
      sub="Journal dari posting dokumen, dan journal manual."
      base="/accounting/journal"
      newLabel="Buat Journal Manual"
      canCreate={can.create}
      searchHint="Cari nomor journal atau keterangan…"
      statuses={STATUSES}
      statusText={STATUS_TEXT}
      statusBadge={STATUS_CLASS}
      sourceLabel="Sumber"
      columns={[{ key: "description", label: "Keterangan" }]}
      valueLabel="Nilai"
      facets={[{ key: "origin", label: "Sumber", options: [{ value: "manual", label: "Manual" }, { value: "auto", label: "Otomatis" }] }]}
      empty="Journal terbentuk otomatis saat dokumen diposting, atau dibuat sendiri sebagai Journal Manual."
      paged={journals}
      rows={journals.rows.map((j) => ({
        id: j.id,
        no: j.journalNo,
        status: j.status,
        date: j.postingDate,
        source: { no: j.sourceDocLabel ?? (j.isManual ? "Manual" : "—"), href: documentHref(j.sourceDocTable, j.sourceDocId) ?? undefined },
        cells: { description: <b>{j.description}</b> },
        value: (
          <>
            <Amount value={j.debit} ledger />
            {cents(j.debit) !== cents(j.credit) && j.status === "Posted" && <span className="overtag">tidak seimbang</span>}
          </>
        ),
        editable: j.isManual && can.edit && journalIsEditable(j.status as JournalStatus),
        steps: j.isManual ? rowSteps(availableJournalActions(j.status as JournalStatus, can), JOURNAL_TRANSITIONS) : [],
      }))}
    />
  );
}
