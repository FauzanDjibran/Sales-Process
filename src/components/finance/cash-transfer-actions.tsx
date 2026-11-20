"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { previewCashTransferPostingAction, transitionCashTransferAction } from "@/app/actions/cash-transfer";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  CASH_TRANSFER_PATH,
  CASH_TRANSFER_TRANSITIONS,
  availableCashTransferActions,
  cashTransferIsEditable,
  type CashTransferAbilities,
  type CashTransferAction,
  type CashTransferStatus,
} from "@/lib/erp/cash-transfer-workflow";

const LOCK_TEXT: Partial<Record<CashTransferStatus, string>> = {
  Posted: "Transfer diposting",
  Cancelled: "Transfer dibatalkan",
};

/**
 * A Transfer Kas & Bank lifecycle as header buttons: Ubah (Draft only),
 * Batalkan and Posting, whose confirmation shows the journal from a dry run of
 * the posting (P103) — or why it cannot post.
 */
export function CashTransferActions({ id, subject, status, can }: { id: number; subject: string; status: CashTransferStatus; can: CashTransferAbilities }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<CashTransferAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);
  const [postable, setPostable] = useState(false);

  const run = async (action: CashTransferAction) => {
    if (CASH_TRANSFER_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionCashTransferAction(id, action, reason);
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

  const actions = availableCashTransferActions(status, can);
  const buttons = orderForHeader(
    [
      ...(cashTransferIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`${CASH_TRANSFER_PATH}/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = CASH_TRANSFER_TRANSITIONS[a];
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

  const t = confirm ? CASH_TRANSFER_TRANSITIONS[confirm] : null;

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
          {confirm === "post" && <JournalPreview load={() => previewCashTransferPostingAction(id)} onReady={setPostable} />}
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
