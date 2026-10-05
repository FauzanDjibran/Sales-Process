"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { previewInvoicePostingAction, transitionInvoiceAction } from "@/app/actions/ar-invoice";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  INVOICE_TRANSITIONS,
  availableInvoiceActions,
  invoiceIsEditable,
  type InvoiceAbilities,
  type InvoiceAction,
  type InvoiceStatus,
} from "@/lib/erp/ar-invoice-workflow";

/** Why a final note offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<InvoiceStatus, string>> = {
  Posted: "Invoice diposting",
  Cancelled: "Invoice dibatalkan",
};

/**
 * An Invoice's lifecycle as buttons in the page header: Ubah (Draft only),
 * Batalkan and Posting. Posting's confirmation shows the journal it will write
 * — Piutang and the Uang Muka used debited, Penjualan and PPN Keluaran credited
 * — from the posting itself run as a dry run and rolled back (P103). An Invoice
 * that cannot post (a line billed since, an Uang Muka used since, a missing
 * mapping, a closed period) says why there, with *Ya, Posting* disabled.
 */
export function InvoiceActions({
  id,
  subject,
  status,
  can,
}: {
  id: number;
  subject: string;
  status: InvoiceStatus;
  can: InvoiceAbilities;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<InvoiceAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);
  const [postable, setPostable] = useState(false);

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
                <Link key="edit" className="btn" href={`/finance/invoice/sales/${id}/edit`}>
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
                setPostable(false);
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
          confirmDisabled={confirm === "post" && !postable}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        >
          {confirm === "post" && <JournalPreview load={() => previewInvoicePostingAction(id)} onReady={setPostable} />}
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
