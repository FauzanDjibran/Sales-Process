"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { transitionCustomerOrderAction } from "@/app/actions/customer-order";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  CUSTOMER_ORDER_TRANSITIONS,
  availableCustomerOrderActions,
  customerOrderIsEditable,
  type CustomerOrderAbilities,
  type CustomerOrderAction,
  type CustomerOrderStatus,
} from "@/lib/erp/customer-order-workflow";

/** Why a final or waiting order offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<CustomerOrderStatus, string>> = {
  Submitted: "Menunggu persetujuan",
  Closed: "Customer Order ditutup",
  Cancelled: "Customer Order dibatalkan",
  Rejected: "Customer Order ditolak",
};

/**
 * A Customer Order's lifecycle as buttons in the page header: Salin, Ubah (Draft
 * only), Ajukan, Setujui / Tolak, Batalkan and Tutup Pesanan (P63). What is offered comes from the transition
 * table, so this can never offer a step the Server Action would refuse.
 * Ordered danger → neutral → primary in the markup.
 */
export function CustomerOrderActions({
  id,
  subject,
  status,
  can,
}: {
  id: number;
  subject: string;
  status: CustomerOrderStatus;
  can: CustomerOrderAbilities;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<CustomerOrderAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: CustomerOrderAction) => {
    if (CUSTOMER_ORDER_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionCustomerOrderAction(id, action, reason);
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

  const actions = availableCustomerOrderActions(status, can);
  const buttons = orderForHeader(
    [
      ...(can.create
        ? [
            {
              key: "copy",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="copy" className="btn" href={`/sales/customer-order/new?from=${id}`}>
                  <Icon name="copy" size={15} /> Salin
                </Link>
              ),
            },
          ]
        : []),
      ...(customerOrderIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/sales/customer-order/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = CUSTOMER_ORDER_TRANSITIONS[a];
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

  const t = confirm ? CUSTOMER_ORDER_TRANSITIONS[confirm] : null;

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
