"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { JournalPreview } from "@/components/ui/journal-preview";
import { useToast } from "@/components/ui/toast";
import { previewReleasePostingAction, transitionReleaseAction } from "@/app/actions/production-release";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  RELEASE_PURPOSES,
  RELEASE_TRANSITIONS,
  availableReleaseActions,
  releaseIsEditable,
  type ReleaseAbilities,
  type ReleaseAction,
  type ReleasePurpose,
  type ReleaseStatus,
} from "@/lib/erp/production-release-workflow";

/** Why a final document offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<ReleaseStatus, string>> = { Posted: "Dokumen sudah diposting", Cancelled: "Dokumen dibatalkan" };

/**
 * A Penerimaan Hasil Produksi or Pemusnahan Produksi's lifecycle as buttons in the
 * page header (P170): Ubah (Draft only), Batalkan and Posting. Posting's
 * confirmation shows the journal it will write — from the posting itself run as a
 * dry run and rolled back (P103) — with the confirm button disabled until it loads
 * or while it refuses.
 */
export function ReleaseActions({ purpose, id, subject, status, can }: { purpose: ReleasePurpose; id: number; subject: string; status: ReleaseStatus; can: ReleaseAbilities }) {
  const toast = useToast();
  const def = RELEASE_PURPOSES[purpose];
  const [confirm, setConfirm] = useState<ReleaseAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);
  const [postable, setPostable] = useState(false);

  const run = async (action: ReleaseAction) => {
    if (RELEASE_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionReleaseAction(id, action, reason);
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

  const buttons = orderForHeader(
    [
      ...(releaseIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`${def.path}/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...availableReleaseActions(status, can).map((a) => {
        const t = RELEASE_TRANSITIONS[a];
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

  const t = confirm ? RELEASE_TRANSITIONS[confirm] : null;
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
          wide={Boolean(t.journal)}
          icon={t.icon}
          tone={t.tone === "danger" ? "danger" : "ok"}
          title={t.title(def)}
          subject={subject}
          body={t.body(def)}
          confirmLabel={t.confirmLabel}
          confirmTone={t.tone === "danger" ? "solid-danger" : "primary"}
          busy={busy}
          confirmDisabled={Boolean(t.journal) && !postable}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        >
          {t.journal && <JournalPreview load={() => previewReleasePostingAction(id)} onReady={setPostable} />}
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
