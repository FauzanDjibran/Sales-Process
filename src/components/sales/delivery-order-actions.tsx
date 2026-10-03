"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { transitionDeliveryOrderAction } from "@/app/actions/delivery-order";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  DELIVERY_ORDER_TRANSITIONS,
  availableDeliveryOrderActions,
  deliveryOrderIsEditable,
  type DeliveryOrderAbilities,
  type DeliveryOrderAction,
  type DeliveryOrderStatus,
} from "@/lib/erp/delivery-order-workflow";

/** Why a final or waiting order offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<DeliveryOrderStatus, string>> = {
  Closed: "Delivery Order ditutup",
  Cancelled: "Delivery Order dibatalkan",
};

/**
 * A Delivery Order's lifecycle as buttons in the page header: Ubah (Draft
 * only), Terbitkan, Batalkan and Tutup (P93). What is
 * offered comes from the transition table, so this can never offer a step the
 * Server Action would refuse. Ordered danger → neutral → primary in the markup.
 */
export function DeliveryOrderActions({
  id,
  subject,
  status,
  can,
}: {
  id: number;
  subject: string;
  status: DeliveryOrderStatus;
  can: DeliveryOrderAbilities;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<DeliveryOrderAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: DeliveryOrderAction) => {
    if (DELIVERY_ORDER_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionDeliveryOrderAction(id, action, reason);
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

  const actions = availableDeliveryOrderActions(status, can);
  const buttons = orderForHeader(
    [
      ...(deliveryOrderIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/sales/delivery-order/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = DELIVERY_ORDER_TRANSITIONS[a];
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

  const t = confirm ? DELIVERY_ORDER_TRANSITIONS[confirm] : null;

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
