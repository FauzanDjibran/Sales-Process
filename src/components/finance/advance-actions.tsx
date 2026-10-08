"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { transitionSalesAdvanceAction } from "@/app/actions/ar-advance";
import { transitionPermitAdvanceAction } from "@/app/actions/permit-advance";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  ADVANCE_TRANSITIONS_OF,
  type AdvanceVariant,
  advanceIsEditable,
  availableAdvanceActions,
  type AdvanceAbilities,
  type AdvanceAction,
  type AdvanceStatus,
} from "@/lib/erp/ar-advance-workflow";
import { formatMoney } from "@/lib/format";

/**
 * An advance bill's lifecycle as header buttons: Ubah (Draft only),
 * Terbitkan and Batalkan, from the transition table so nothing is offered
 * that the Server Action would refuse. Terbitkan states what the bill asks
 * for and that no journal is written — the consequence before the commitment.
 */
export function AdvanceActions({
  id,
  subject,
  status,
  can,
  figures,
  variant = "sales",
}: {
  id: number;
  subject: string;
  status: AdvanceStatus;
  can: AdvanceAbilities;
  figures: { dpp: number; ppn: number; total: number };
  /** Uang Muka Penjualan or Uang Muka Perizinan (P137). */
  variant?: AdvanceVariant;
}) {
  const TRANSITIONS = ADVANCE_TRANSITIONS_OF[variant];
  const base = variant === "permit" ? "/finance/advance/permit" : "/finance/advance/sales";
  const toast = useToast();
  const [confirm, setConfirm] = useState<AdvanceAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: AdvanceAction) => {
    if (TRANSITIONS[action].needsReason && !reason.trim()) {
      setReasonError("Alasan pembatalan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await (variant === "permit" ? transitionPermitAdvanceAction : transitionSalesAdvanceAction)(id, action, reason);
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
      ...(advanceIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`${base}/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...availableAdvanceActions(status, can).map((a) => {
        const t = TRANSITIONS[a];
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

  const t = confirm ? TRANSITIONS[confirm] : null;
  const money = (n: number) => formatMoney(n, "IDR");

  return (
    <>
      {buttons.length ? (
        buttons.map((b) => b.node)
      ) : (
        <span className="lockchip">
          <Icon name="lock" size={13} /> {status === "Cancelled" ? "Tagihan dibatalkan" : "Terkunci"}
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
          {confirm === "issue" && (
            <div className="mbody">
              <div className="apsum">
                <div>
                  <span>DPP</span>
                  <b className="mono">{money(figures.dpp)}</b>
                </div>
                <div>
                  <span>PPN</span>
                  <b className="mono">{money(figures.ppn)}</b>
                </div>
                <div className="full amt">
                  <span>Total Tagihan</span>
                  <b>{money(figures.total)}</b>
                </div>
              </div>
            </div>
          )}
          {t.needsReason && (
            <div className="mbody">
              <Field label="Alasan" span={12} required error={reasonError}>
                <textarea
                  className={`ta${reasonError ? " bad" : ""}`}
                  rows={2}
                  value={reason}
                  autoFocus
                  placeholder="Mengapa tagihan ini dibatalkan…"
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
