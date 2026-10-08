"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { transitionPermitRequestAction } from "@/app/actions/permit-request";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  PERMIT_REQUEST_TRANSITIONS,
  availablePermitRequestActions,
  permitRequestIsEditable,
  type PermitRequestAbilities,
  type PermitRequestAction,
  type PermitRequestStatus,
} from "@/lib/erp/permit-request-workflow";

const LOCK_TEXT: Partial<Record<PermitRequestStatus, string>> = {
  Submitted: "Menunggu persetujuan",
  Done: "Realisasi sudah ditagih",
  Cancelled: "Pengajuan dibatalkan",
  Rejected: "Pengajuan ditolak",
};

/**
 * A Pengajuan's lifecycle as header buttons: Ubah (Draft), Input / Ubah
 * Realisasi, Ajukan, Setujui / Tolak, Realisasikan and Batalkan. Ordered danger
 * → neutral → primary. Realisasikan is offered only once the realisation has
 * been entered; a realisation is correctable until it is billed or its cost paid.
 */
export function PermitRequestActions({
  id,
  subject,
  status,
  can,
  realizationEntered,
  realizationLocked,
}: {
  id: number;
  subject: string;
  status: PermitRequestStatus;
  can: PermitRequestAbilities;
  realizationEntered: boolean;
  /** An Invoice or a cost payment names the realisation (Z8). */
  realizationLocked: boolean;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<PermitRequestAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: PermitRequestAction) => {
    if (PERMIT_REQUEST_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionPermitRequestAction(id, action, reason);
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

  const actions = availablePermitRequestActions(status, can).filter((a) => a !== "realize" || realizationEntered);
  const canRealize =
    can.realize && (status === "Open" || (status === "Realized" && !realizationLocked));
  const link = (key: string, href: string, icon: "pen" | "check", text: string, tone: ActionTone = "neutral") => ({
    key,
    tone,
    node: (
      <Link key={key} className={headerButtonClass(tone)} href={href}>
        <Icon name={icon} size={15} /> {text}
      </Link>
    ),
  });
  const buttons = orderForHeader(
    [
      ...(permitRequestIsEditable(status) && can.edit ? [link("edit", `/sales/permit/${id}/edit`, "pen", "Ubah")] : []),
      ...(canRealize
        ? [
            link(
              "realization",
              `/sales/permit/${id}/realization`,
              "pen",
              status === "Open" && !realizationEntered ? "Input Realisasi" : "Ubah Realisasi",
              status === "Open" && !realizationEntered ? "primary" : "neutral"
            ),
          ]
        : []),
      ...actions.map((a) => {
        const t = PERMIT_REQUEST_TRANSITIONS[a];
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

  const t = confirm ? PERMIT_REQUEST_TRANSITIONS[confirm] : null;

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
