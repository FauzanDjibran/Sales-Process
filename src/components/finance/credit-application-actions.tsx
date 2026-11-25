"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { JournalPreview } from "@/components/ui/journal-preview";
import { useToast } from "@/components/ui/toast";
import { previewCreditApplicationPostingAction, transitionCreditApplicationAction } from "@/app/actions/ar-credit-application";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  CREDIT_APPLICATION_TRANSITIONS,
  availableCreditApplicationActions,
  creditApplicationIsEditable,
  type CreditApplicationAbilities,
  type CreditApplicationAction,
  type CreditApplicationStatus,
} from "@/lib/erp/ar-credit-application-workflow";
import { useInitialAction } from "@/components/ui/save-buttons";

const LOCK_TEXT: Partial<Record<CreditApplicationStatus, string>> = { Posted: "Penerapan Kredit diposting", Cancelled: "Penerapan Kredit dibatalkan" };

/**
 * A Penerapan Kredit's lifecycle as header buttons: Ubah and Batalkan on a Draft,
 * Posting with its journal by dry run (P103). Ordered danger → neutral → primary.
 */
export function CreditApplicationActions({ id, subject, status, can }: { id: number; subject: string; status: CreditApplicationStatus; can: CreditApplicationAbilities }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<CreditApplicationAction | null>(useInitialAction<CreditApplicationAction>(availableCreditApplicationActions(status, can)));
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);
  const [postable, setPostable] = useState(false);

  const run = async (action: CreditApplicationAction) => {
    if (CREDIT_APPLICATION_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionCreditApplicationAction(id, action, reason);
    setBusy(false);
    if (!result.ok) {
      if (result.errors.reason) {
        setReasonError(result.errors.reason);
        return;
      }
      setConfirm(null);
      toast("Tidak dapat diproses", result.errors._form ?? Object.values(result.errors)[0], "err");
      return;
    }
    setConfirm(null);
    setReason("");
    toast(result.message, subject, "ok");
  };

  const buttons = orderForHeader(
    [
      ...(creditApplicationIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/finance/invoice/credit-application/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...availableCreditApplicationActions(status, can).map((a) => {
        const t = CREDIT_APPLICATION_TRANSITIONS[a];
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

  const t = confirm ? CREDIT_APPLICATION_TRANSITIONS[confirm] : null;

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
          {confirm === "post" && <JournalPreview load={() => previewCreditApplicationPostingAction(id)} onReady={setPostable} />}
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
