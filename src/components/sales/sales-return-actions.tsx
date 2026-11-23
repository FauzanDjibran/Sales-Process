"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { transitionSalesReturnAction } from "@/app/actions/sales-return";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  SALES_RETURN_TRANSITIONS,
  availableSalesReturnActions,
  salesReturnIsEditable,
  type SalesReturnAbilities,
  type SalesReturnAction,
  type SalesReturnStatus,
} from "@/lib/erp/sales-return-workflow";
import { useInitialAction } from "@/components/ui/save-buttons";

/** Why a final or waiting order offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<SalesReturnStatus, string>> = {
  Closed: "Sales Return ditutup",
  Rejected: "Sales Return ditolak",
  Submitted: "Menunggu persetujuan",
  Cancelled: "Sales Return dibatalkan",
};

/**
 * A Sales Return's lifecycle as buttons in the page header: Ubah (Draft
 * only), Ajukan, Setujui, Tolak, Batalkan and Tutup (P287). What is
 * offered comes from the transition table, so this can never offer a step the
 * Server Action would refuse. Ordered danger → neutral → primary in the markup.
 */
export function SalesReturnActions({
  id,
  subject,
  status,
  can,
}: {
  id: number;
  subject: string;
  status: SalesReturnStatus;
  can: SalesReturnAbilities;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<SalesReturnAction | null>(useInitialAction<SalesReturnAction>(availableSalesReturnActions(status, can)));
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: SalesReturnAction) => {
    if (SALES_RETURN_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionSalesReturnAction(id, action, reason);
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

  const actions = availableSalesReturnActions(status, can);
  const buttons = orderForHeader(
    [
      ...(salesReturnIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/sales/return/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = SALES_RETURN_TRANSITIONS[a];
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

  const t = confirm ? SALES_RETURN_TRANSITIONS[confirm] : null;

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
          icon={t.icon}
          tone={t.tone === "danger" ? "danger" : "ok"}
          title={t.title}
          subject={subject}
          body={t.body}
          confirmLabel={t.confirmLabel}
          confirmTone={t.tone === "danger" ? "solid-danger" : "primary"}
          busy={busy}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        >
          {t.reason && (
            <div className="mbody">
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
            </div>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
