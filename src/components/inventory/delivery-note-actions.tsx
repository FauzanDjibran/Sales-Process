"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { previewDeliveryNotePostingAction, transitionDeliveryNoteAction } from "@/app/actions/delivery-note";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  DELIVERY_NOTE_TRANSITIONS,
  availableDeliveryNoteActions,
  deliveryNoteIsEditable,
  type DeliveryNoteAbilities,
  type DeliveryNoteAction,
  type DeliveryNoteStatus,
} from "@/lib/erp/delivery-note-workflow";

/** Why a final note offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<DeliveryNoteStatus, string>> = {
  Posted: "Delivery Note diposting",
  Cancelled: "Delivery Note dibatalkan",
};

/**
 * A Delivery Note's lifecycle as buttons in the page header: Ubah (Draft only),
 * Batalkan and Posting. Posting's confirmation shows the journal it will write
 * — HPP debited, Persediaan credited, per item at the cost the inventory module
 * returns — from the posting itself run as a dry run and rolled back (P103). A
 * note that cannot post (short stock, lots not picked in full, Account
 * Mapping incomplete) says why there, with *Ya, Posting* disabled.
 */
export function DeliveryNoteActions({
  id,
  subject,
  status,
  can,
}: {
  id: number;
  subject: string;
  status: DeliveryNoteStatus;
  can: DeliveryNoteAbilities;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<DeliveryNoteAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);
  const [postable, setPostable] = useState(false);

  const run = async (action: DeliveryNoteAction) => {
    if (DELIVERY_NOTE_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionDeliveryNoteAction(id, action, reason);
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

  const actions = availableDeliveryNoteActions(status, can);
  const buttons = orderForHeader(
    [
      ...(deliveryNoteIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/inventory/delivery-note/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = DELIVERY_NOTE_TRANSITIONS[a];
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

  const t = confirm ? DELIVERY_NOTE_TRANSITIONS[confirm] : null;
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
          {confirm === "post" && <JournalPreview load={() => previewDeliveryNotePostingAction(id)} onReady={setPostable} />}
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
