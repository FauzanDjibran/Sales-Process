"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { transitionHandoverAction } from "@/app/actions/production-handover";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  HANDOVER_TRANSITIONS,
  availableHandoverActions,
  handoverIsEditable,
  type HandoverAbilities,
  type HandoverAction,
  type HandoverStatus,
} from "@/lib/erp/production-handover-workflow";
import { todayIso } from "@/lib/format";

/** Why a final hand-over offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<HandoverStatus, string>> = {
  Posted: "Menunggu diterima Workstation tujuan",
  Received: "Diterima di Workstation tujuan",
  Rejected: "Ditolak — kembali ke pengirim",
  Cancelled: "Hand-over dibatalkan",
};

/**
 * A hand-over's lifecycle as buttons in the page header (P167, M113): Ubah
 * (Draft only), Batalkan and Posting; then, at the receiving workstation, Tolak
 * and Terima, each on a day the user picks. No step writes a journal, so no
 * confirmation shows one.
 */
export function HandoverActions({
  id,
  subject,
  status,
  handoverDate,
  can,
}: {
  id: number;
  subject: string;
  status: HandoverStatus;
  /** Terima / Tolak may not be dated before it. */
  handoverDate: string;
  can: HandoverAbilities;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<HandoverAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [date, setDate] = useState("");
  const [dateError, setDateError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: HandoverAction) => {
    const t = HANDOVER_TRANSITIONS[action];
    if (t.reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    if (t.dated && !date) {
      setDateError("Tanggal wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionHandoverAction(id, action, reason, t.dated ? date : undefined);
    setBusy(false);
    if (!result.ok) {
      if (result.errors.reason || result.errors.date) {
        setReasonError(result.errors.reason ?? "");
        setDateError(result.errors.date ?? "");
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
      ...(handoverIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/production/handover/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...availableHandoverActions(status, can).map((a) => {
        const t = HANDOVER_TRANSITIONS[a];
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
                setDate(t.dated ? (todayIso() < handoverDate ? handoverDate : todayIso()) : "");
                setDateError("");
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

  const t = confirm ? HANDOVER_TRANSITIONS[confirm] : null;
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
          {t.dated && !t.reason && <HoldFocus />}
          {t.dated && (
            <Field label={confirm === "reject" ? "Tanggal Tolak" : "Tanggal Terima"} span={12} required error={dateError}>
              <DateInput
                value={date}
                invalid={Boolean(dateError)}
                onChange={(v) => {
                  setDate(v);
                  setDateError("");
                }}
              />
            </Field>
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

/** Takes the dialog's first focus so Terima's `DateInput` does not open its calendar over the consequences. */
function HoldFocus() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return <div ref={ref} tabIndex={-1} aria-hidden="true" />;
}
