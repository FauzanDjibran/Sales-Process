"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { previewReceiptNotePostingAction, transitionReceiptNoteAction } from "@/app/actions/receipt-note";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  RECEIPT_NOTE_TRANSITIONS,
  availableReceiptNoteActions,
  receiptNoteIsEditable,
  type ReceiptNoteAbilities,
  type ReceiptNoteAction,
  type ReceiptNoteStatus,
} from "@/lib/erp/receipt-note-workflow";

/** Why a final note offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<ReceiptNoteStatus, string>> = {
  Posted: "Receipt Note diposting",
  Cancelled: "Receipt Note dibatalkan",
};

/**
 * A Receipt Note's lifecycle as buttons in the page header: Ubah (Draft only),
 * Batalkan and Posting. Posting's confirmation shows the journal it will write
 * — Persediaan or Beban debited, Barang Diterima Belum Ditagih credited — from
 * the posting itself run as a dry run and rolled back (P103).
 */
export function ReceiptNoteActions({
  id,
  subject,
  status,
  can,
}: {
  id: number;
  subject: string;
  status: ReceiptNoteStatus;
  can: ReceiptNoteAbilities;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<ReceiptNoteAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);
  const [postable, setPostable] = useState(false);

  const run = async (action: ReceiptNoteAction) => {
    if (RECEIPT_NOTE_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionReceiptNoteAction(id, action, reason);
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
    toast(result.message, result.closed.length ? `${subject} · selesai: ${result.closed.join(", ")}` : subject, "ok");
  };

  const actions = availableReceiptNoteActions(status, can);
  const buttons = orderForHeader(
    [
      ...(receiptNoteIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/logistics/receipt-note/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = RECEIPT_NOTE_TRANSITIONS[a];
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

  const t = confirm ? RECEIPT_NOTE_TRANSITIONS[confirm] : null;
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
          {confirm === "post" && <JournalPreview load={() => previewReceiptNotePostingAction(id)} onReady={setPostable} />}
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
