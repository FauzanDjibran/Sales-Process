"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { transitionSalesOrderAction } from "@/app/actions/sales-order";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  SALES_ORDER_TRANSITIONS,
  availableSalesOrderActions,
  salesOrderIsEditable,
  type SalesOrderAbilities,
  type SalesOrderAction,
  type SalesOrderStatus,
} from "@/lib/erp/sales-order-workflow";

/**
 * A Sales Order's lifecycle as buttons in the page header: Salin, Ubah (Draft
 * only), Konfirmasi and Batalkan. What is offered comes from the transition
 * table, so this can never offer a step the Server Action would refuse.
 * Ordered danger → neutral → primary in the markup.
 */
export function SalesOrderActions({
  id,
  subject,
  status,
  can,
}: {
  id: number;
  subject: string;
  status: SalesOrderStatus;
  can: SalesOrderAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState<SalesOrderAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: SalesOrderAction) => {
    if (SALES_ORDER_TRANSITIONS[action].needsReason && !reason.trim()) {
      setReasonError("Alasan pembatalan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionSalesOrderAction(id, action, reason);
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
    router.refresh();
  };

  const actions = availableSalesOrderActions(status, can);
  const buttons = orderForHeader(
    [
      ...(can.create
        ? [
            {
              key: "copy",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="copy" className="btn" href={`/sales/order/new?from=${id}`}>
                  <Icon name="copy" size={15} /> Salin
                </Link>
              ),
            },
          ]
        : []),
      ...(salesOrderIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/sales/order/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = SALES_ORDER_TRANSITIONS[a];
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

  const t = confirm ? SALES_ORDER_TRANSITIONS[confirm] : null;

  return (
    <>
      {buttons.length ? (
        buttons.map((b) => b.node)
      ) : (
        <span className="lockchip">
          <Icon name="lock" size={13} /> {status === "Cancelled" ? "Sales Order dibatalkan" : "Terkunci"}
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
          {t.needsReason && (
            <div className="mbody">
              <Field label="Alasan" span={12} required error={reasonError}>
                <textarea
                  className={`ta${reasonError ? " bad" : ""}`}
                  rows={2}
                  value={reason}
                  autoFocus
                  placeholder="Mengapa pesanan ini dibatalkan…"
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
