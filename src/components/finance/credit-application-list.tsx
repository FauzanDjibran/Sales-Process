"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { CreditApplicationListRow } from "@/lib/erp/ar-credit-application";
import {
  CREDIT_APPLICATION_STATUS_BADGE,
  CREDIT_APPLICATION_STATUS_TEXT,
  CREDIT_APPLICATION_TRANSITIONS,
  availableCreditApplicationActions,
  creditApplicationIsEditable,
  type CreditApplicationAbilities,
  type CreditApplicationStatus,
} from "@/lib/erp/ar-credit-application-workflow";

const STATUSES: CreditApplicationStatus[] = ["Draft", "Posted", "Cancelled"];

/** The Penerapan Kredit register (P332). */
export function CreditApplicationList({ rows, can }: { rows: CreditApplicationListRow[]; can: CreditApplicationAbilities }) {
  return (
    <DocumentRegister
      module="Finance"
      icon="file"
      title="Penerapan Kredit"
      sub="Kredit customer dari Credit Note yang dipotongkan ke Invoice terbuka."
      base="/finance/invoice/credit-application"
      newLabel="Buat Penerapan Kredit"
      canCreate={can.create}
      searchHint="Cari nomor atau customer…"
      statuses={STATUSES}
      statusText={CREDIT_APPLICATION_STATUS_TEXT}
      statusBadge={CREDIT_APPLICATION_STATUS_BADGE}
      partnerLabel="Customer"
      columns={[{ key: "lines", label: "Baris", width: 54, num: true }]}
      valueLabel="Nilai"
      empty="Penerapan Kredit memotongkan kredit customer dari Credit Note ke Invoice yang masih terbuka."
      rows={rows.map((o) => ({
        id: o.id,
        no: o.applicationNo,
        status: o.status,
        date: o.date,
        partner: { label: o.customerLabel, name: o.customerName },
        cells: { lines: o.lines },
        value: <Amount value={o.total} currency={o.currency} />,
        editable: can.edit && creditApplicationIsEditable(o.status),
        steps: rowSteps(availableCreditApplicationActions(o.status, can), CREDIT_APPLICATION_TRANSITIONS),
      }))}
    />
  );
}
