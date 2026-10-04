"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { transitionInvoiceAction } from "@/app/actions/sales-invoice";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  INVOICE_TRANSITIONS,
  availableInvoiceActions,
  invoiceIsEditable,
  type InvoiceAbilities,
  type InvoiceAction,
  type InvoiceStatus,
} from "@/lib/erp/sales-invoice-workflow";
import type { InvoicePreview } from "@/lib/erp/sales-invoice";
import { formatMoney } from "@/lib/format";

/** Why a final note offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<InvoiceStatus, string>> = {
  Posted: "Invoice diposting",
  Cancelled: "Invoice dibatalkan",
};

const money = (n: number) => formatMoney(n, "IDR");

/**
 * An Invoice's lifecycle as buttons in the page header: Ubah (Draft only),
 * Batalkan and Posting. Posting's confirmation states the journal it will
 * write — Piutang and the Uang Muka used debited, Penjualan and PPN Keluaran
 * credited — and refuses up front when the Invoice cannot post (a line billed
 * since, an Uang Muka used since, a missing mapping or a closed period).
 */
export function InvoiceActions({
  id,
  subject,
  status,
  can,
  preview,
}: {
  id: number;
  subject: string;
  status: InvoiceStatus;
  can: InvoiceAbilities;
  /** What Posting would write; null once the Invoice is final. */
  preview: InvoicePreview | null;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<InvoiceAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: InvoiceAction) => {
    if (INVOICE_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionInvoiceAction(id, action, reason);
    setBusy(false);
    if (!result.ok) {
      if (result.errors.reason) {
        setReasonError(result.errors.reason);
        return;
      }
      setConfirm(null);
      toast("Tidak dapat diproses", result.errors._form, "err");
      return;
    }
    setConfirm(null);
    setReason("");
    toast(result.message, subject, "ok");
  };

  const actions = availableInvoiceActions(status, can);
  const buttons = orderForHeader(
    [
      ...(invoiceIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/sales/invoice/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = INVOICE_TRANSITIONS[a];
        return {
          key: a,
          tone: t.tone,
          node: (
            <button
              key={a}
              className={headerButtonClass(t.tone)}
              disabled={busy}
              onClick={() => {
                setReason("");
                setReasonError("");
                setConfirm(a);
              }}
            >
              <Icon name={t.icon} size={15} /> {t.label}
            </button>
          ),
        };
      }),
    ],
    (i) => i.tone
  );

  const t = confirm ? INVOICE_TRANSITIONS[confirm] : null;
  // Posting cannot succeed while the preview found a reason; say so before the button.
  const blocked = confirm === "post" && preview ? preview.blocked : [];
  const journal = preview?.lines ?? [];
  const total = journal.reduce((a, l) => a + l.debit, 0);

  return (
    <>
      {buttons.length ? (
        buttons.map((b) => b.node)
      ) : (
        <span className="lockchip">
          <Icon name="lock" size={13} /> {LOCK_TEXT[status] ?? "Terkunci"}
        </span>
      )}

      {confirm && t && (
        <ConfirmDialog
          open
          wide={confirm === "post"}
          icon={t.icon}
          tone={t.tone === "danger" ? "danger" : "ok"}
          title={t.title}
          subject={subject}
          body={t.body}
          confirmLabel={t.confirmLabel}
          confirmTone={t.tone === "danger" ? "solid-danger" : "primary"}
          busy={busy}
          confirmDisabled={blocked.length > 0}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        >
          {confirm === "post" && blocked.length > 0 && (
            <div className="nbox bad slim">
              <Icon name="warn" size={15} className="ni" />
              <div>
                {blocked.map((b) => (
                  <b key={b} style={{ display: "block" }}>
                    {b}
                  </b>
                ))}
              </div>
            </div>
          )}
          {confirm === "post" && journal.length > 0 && (
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="num" style={{ width: 130 }}>
                      Debit
                    </th>
                    <th className="num" style={{ width: 130 }}>
                      Kredit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {journal.map((l, i) => (
                    <tr key={i}>
                      <td className="wrapok">
                        <span className="dstack">
                          <span className="d1">
                            <span className="lab">{l.accountNo}</span> {l.accountName}
                          </span>
                          <span className="d2">{l.description}</span>
                        </span>
                      </td>
                      <td className="num">
                        <span className="mny">{l.debit ? money(l.debit) : ""}</span>
                      </td>
                      <td className="num">
                        <span className="mny">{l.credit ? money(l.credit) : ""}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="totrow">
                    <td style={{ textAlign: "right" }}>Total</td>
                    <td className="num">
                      <span className="mny">{money(total)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(total)}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {t.reason && (
            <Field label="Alasan" span={12} required error={reasonError}>
              <textarea
                className={`ta${reasonError ? " bad" : ""}`}
                rows={2}
                value={reason}
                autoFocus
                placeholder={t.reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setReasonError("");
                }}
              />
            </Field>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
