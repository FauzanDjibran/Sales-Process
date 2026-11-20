"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import type { IconName } from "@/components/icon";

type Transition = { label: string; icon: IconName; tone: ActionTone; title: string; body: string; confirmLabel: string; reason?: string };

/**
 * The lifecycle buttons of Transfer Kirim and Transfer Terima (P300): Ubah
 * while Draft, Batalkan with a reason, and the one step that moves stock —
 * Kirim or Terima. Neither writes a journal (OD-6), so the confirmation says
 * what moves rather than showing a journal preview.
 */
export function TransferActions<A extends string>({
  subject,
  actions,
  transitions,
  editHref,
  lockText,
  run: runAction,
}: {
  subject: string;
  /** The actions this user may run in this status, already filtered. */
  actions: A[];
  transitions: Record<A, Transition>;
  editHref: string | null;
  lockText: string;
  run: (action: A, reason?: string) => Promise<{ ok: true; message: string } | { ok: false; errors: Record<string, string> }>;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<A | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: A) => {
    if (transitions[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await runAction(action, reason);
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
      ...(editHref
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={editHref}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = transitions[a];
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

  const t = confirm ? transitions[confirm] : null;
  return (
    <>
      {buttons.length ? (
        buttons.map((b) => b.node)
      ) : (
        <span className="lockchip">
          <Icon name="lock" size={13} /> {lockText}
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
