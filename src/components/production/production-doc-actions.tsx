"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import type { JournalPreviewResult } from "@/lib/erp/journal";
import {
  availableProdDocActions,
  prodDocIsEditable,
  type ProdDocAbilities,
  type ProdDocAction,
  type ProdDocStatus,
  type ProdDocWorkflow,
} from "@/lib/erp/production-doc-workflow";

export type ProdDocRunResult = { ok: true; message: string } | { ok: false; errors: Record<string, string> };

/**
 * A production document's lifecycle as buttons in the page header (R5, R7,
 * R8): Ubah (Draft only), Batalkan and Posting. Where Posting writes a
 * journal, its confirmation shows it from the posting run as a dry run and
 * rolled back (P103); a document that cannot post says why there, with *Ya,
 * Posting* disabled.
 */
export function ProdDocActions({
  workflow,
  id,
  subject,
  status,
  can,
  run,
  preview,
}: {
  workflow: ProdDocWorkflow;
  id: number;
  subject: string;
  status: ProdDocStatus;
  can: ProdDocAbilities;
  run: (action: ProdDocAction, reason: string) => Promise<ProdDocRunResult>;
  preview?: () => Promise<JournalPreviewResult>;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<ProdDocAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);
  const [postable, setPostable] = useState(false);
  const T = workflow.transitions;

  const go = async (action: ProdDocAction) => {
    if (T[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await run(action, reason);
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
      ...(prodDocIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`${workflow.path}/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...availableProdDocActions(workflow, status, can).map((a) => ({
        key: a,
        tone: T[a].tone,
        node: (
          <button
            key={a}
            className={headerButtonClass(T[a].tone)}
            disabled={busy}
            onClick={() => {
              setReason("");
              setReasonError("");
              setPostable(!(a === "post" && workflow.journal && preview));
              setConfirm(a);
            }}
          >
            <Icon name={T[a].icon} size={15} /> {T[a].label}
          </button>
        ),
      })),
    ],
    (i) => i.tone
  );

  const t = confirm ? T[confirm] : null;
  const showJournal = confirm === "post" && workflow.journal && preview;
  return (
    <>
      {buttons.length ? (
        buttons.map((b) => b.node)
      ) : (
        <span className="lockchip">
          <Icon name="lock" size={13} /> {`${workflow.noun} ${status === "Posted" ? "diposting" : "dibatalkan"}`}
        </span>
      )}

      {confirm && t && (
        <ConfirmDialog
          open
          wide={Boolean(showJournal)}
          icon={t.icon}
          tone={t.tone === "danger" ? "danger" : "ok"}
          title={t.title}
          subject={subject}
          body={t.body}
          confirmLabel={t.confirmLabel}
          confirmTone={t.tone === "danger" ? "solid-danger" : "primary"}
          busy={busy}
          confirmDisabled={confirm === "post" && !postable}
          onConfirm={() => go(confirm)}
          onCancel={() => setConfirm(null)}
        >
          {showJournal && preview && <JournalPreview load={preview} onReady={setPostable} />}
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
