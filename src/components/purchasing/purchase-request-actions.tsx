"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { transitionPurchaseRequestAction } from "@/app/actions/purchase-request";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  PURCHASE_REQUEST_TRANSITIONS,
  availablePurchaseRequestActions,
  purchaseRequestIsEditable,
  type PurchaseRequestAbilities,
  type PurchaseRequestAction,
  type PurchaseRequestStatus,
} from "@/lib/erp/purchase-request-workflow";

/** Why a final or waiting order offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<PurchaseRequestStatus, string>> = {
  Closed: "Purchase Request ditutup",
  Cancelled: "Purchase Request dibatalkan",
};

/**
 * A Purchase Request's lifecycle as buttons in the page header: Ubah (Draft
 * only), Ajukan, Batalkan and Tutup (P123). What is offered comes from the
 * transition table, so this never offers a step the Server Action refuses.
 */
export function PurchaseRequestActions({
  id,
  basePath,
  subject,
  status,
  can,
}: {
  id: number;
  /** `/purchasing/request/goods` or `/service`: where Ubah leads. */
  basePath: string;
  subject: string;
  status: PurchaseRequestStatus;
  can: PurchaseRequestAbilities;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<PurchaseRequestAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: PurchaseRequestAction) => {
    if (PURCHASE_REQUEST_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionPurchaseRequestAction(id, action, reason);
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

  const actions = availablePurchaseRequestActions(status, can);
  const buttons = orderForHeader(
    [
      ...(purchaseRequestIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`${basePath}/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = PURCHASE_REQUEST_TRANSITIONS[a];
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

  const t = confirm ? PURCHASE_REQUEST_TRANSITIONS[confirm] : null;

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
