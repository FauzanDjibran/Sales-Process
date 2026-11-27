"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { previewStockReceiptAction, transitionStockReceiptAction } from "@/app/actions/stock-receipt";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  availableStockReceiptActions,
  stockReceiptIsEditable,
  stockReceiptTransitions,
  type StockReceiptAbilities,
  type StockReceiptAction,
  type StockReceiptStatus,
} from "@/lib/erp/stock-receipt-workflow";
import { useInitialAction } from "@/components/ui/save-buttons";

/** Why a final note offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<StockReceiptStatus, string>> = {
  Received: "Sudah diterima",
  Posted: "Sudah diposting",
  Cancelled: "Stock Receipt dibatalkan",
};

/**
 * A Stock Receipt's lifecycle as header buttons (P339): Ubah (Draft only),
 * Batalkan and Terima — Posting for Penerimaan Lain-lain. Its confirmation
 * shows the journal the posting writes, from the posting itself run as a dry
 * run (P103); a receipt that cannot come in says why there.
 */
export function StockReceiptActions({
  id,
  subject,
  purpose,
  status,
  can,
}: {
  id: number;
  subject: string;
  purpose: string;
  status: StockReceiptStatus;
  can: StockReceiptAbilities;
}) {
  const toast = useToast();
  const transitions = stockReceiptTransitions(purpose);
  const [confirm, setConfirm] = useState<StockReceiptAction | null>(useInitialAction<StockReceiptAction>(availableStockReceiptActions(status, can)));
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);
  const [postable, setPostable] = useState(false);

  const run = async (action: StockReceiptAction) => {
    if (transitions[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionStockReceiptAction(id, action, reason);
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
    toast(transitions[action].done, subject, "ok");
  };

  const actions = availableStockReceiptActions(status, can);
  const buttons = orderForHeader(
    [
      ...(stockReceiptIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/inventory/stock-receipt/${id}/edit`}>
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
                setPostable(false);
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
          <Icon name="lock" size={13} /> {LOCK_TEXT[status] ?? "Terkunci"}
        </span>
      )}

      {confirm && t && (
        <ConfirmDialog
          open
          wide={confirm === "receive"}
          icon={t.icon}
          tone={t.tone === "danger" ? "danger" : "ok"}
          title={t.title}
          subject={subject}
          body={t.body}
          confirmLabel={t.confirmLabel}
          confirmTone={t.tone === "danger" ? "solid-danger" : "primary"}
          busy={busy}
          confirmDisabled={confirm === "receive" && !postable}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        >
          {confirm === "receive" && <JournalPreview load={() => previewStockReceiptAction(id)} onReady={setPostable} />}
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
