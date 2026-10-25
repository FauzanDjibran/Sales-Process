"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { transitionProductionPlanAction } from "@/app/actions/production-plan";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  PRODUCTION_PLAN_TRANSITIONS,
  availableProductionPlanActions,
  productionPlanIsEditable,
  type ProductionPlanAbilities,
  type ProductionPlanAction,
  type ProductionPlanStatus,
} from "@/lib/erp/production-plan-workflow";

/** Why a final rencana offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<ProductionPlanStatus, string>> = {
  Rejected: "Rencana ditolak",
  Closed: "Rencana ditutup",
  Cancelled: "Rencana dibatalkan",
};

/**
 * A Rencana Produksi's lifecycle as buttons in the page header (P168): Ubah (Draft
 * only), Ajukan, Setujui, Tolak, Batalkan and Tutup Rencana. What is offered comes from the
 * transition table, so this never offers a step the Server Action refuses.
 */
export function ProductionPlanActions({
  id,
  subject,
  status,
  can,
}: {
  id: number;
  subject: string;
  status: ProductionPlanStatus;
  can: ProductionPlanAbilities;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<ProductionPlanAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: ProductionPlanAction) => {
    if (PRODUCTION_PLAN_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionProductionPlanAction(id, action, reason);
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

  const actions = availableProductionPlanActions(status, can);
  const buttons = orderForHeader(
    [
      ...(productionPlanIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/production/plan/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = PRODUCTION_PLAN_TRANSITIONS[a];
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

  const t = confirm ? PRODUCTION_PLAN_TRANSITIONS[confirm] : null;

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
