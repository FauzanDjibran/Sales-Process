"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { previewCashPaymentPostingAction, transitionCashPaymentAction } from "@/app/actions/cash-payment";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  CASH_PAYMENT_TRANSITIONS,
  availableCashReceiptActions,
  cashBankTxIsEditable,
  type CashBankTxAction,
  type CashBankTxStatus,
  type CashReceiptAbilities,
} from "@/lib/erp/cash-bank-tx-workflow";

/**
 * A payment's lifecycle as header buttons: Ubah (Draft only), Posting and
 * Batalkan. **Posting shows the journal it will write before writing it**: the
 * posting itself run as a dry run and rolled back (P103), so what the dialog
 * shows is what the book gets, and a payment that cannot post says why there
 * with *Ya, Posting* disabled (design convention: consequences before
 * commitment).
 */
export function CashPaymentActions({
  id,
  subject,
  status,
  can,
}: {
  id: number;
  subject: string;
  status: CashBankTxStatus;
  can: CashReceiptAbilities;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<CashBankTxAction | null>(null);
  const [postable, setPostable] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  const open = (action: CashBankTxAction) => {
    setReason("");
    setReasonError("");
    setPostable(false);
    setConfirm(action);
  };

  const run = async (action: CashBankTxAction) => {
    if (CASH_PAYMENT_TRANSITIONS[action].needsReason && !reason.trim()) {
      setReasonError("Alasan pembatalan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionCashPaymentAction(id, action, reason);
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
    toast(result.message, subject, "ok");
  };

  const buttons = orderForHeader(
    [
      ...(cashBankTxIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/finance/cash-bank/payment/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...availableCashReceiptActions(status, can).map((a) => {
        const t = CASH_PAYMENT_TRANSITIONS[a];
        return {
          key: a,
          tone: t.tone,
          node: (
            <button key={a} className={headerButtonClass(t.tone)} disabled={busy} onClick={() => open(a)}>
              <Icon name={t.icon} size={15} /> {t.label}
            </button>
          ),
        };
      }),
    ],
    (i) => i.tone
  );

  const t = confirm ? CASH_PAYMENT_TRANSITIONS[confirm] : null;

  return (
    <>
      {buttons.length ? (
        buttons.map((b) => b.node)
      ) : (
        <span className="lockchip">
          <Icon name="lock" size={13} />{" "}
          {status === "Cancelled" ? "Pengeluaran dibatalkan" : status === "Posted" ? "Terkunci setelah Posting" : "Terkunci"}
        </span>
      )}

      {confirm && t && (
        <ConfirmDialog
          open
          wide={confirm === "post"}
          icon={t.icon}
          tone={t.tone === "danger" ? "danger" : "ok"}
          title={t.title}
          subject={subject}
          body={
            confirm === "post"
              ? "Dana dicatat di Buku Kas & Bank dan journal di bawah ini dibentuk pada tanggal bayar. Pengeluaran yang sudah diposting tidak dapat diubah atau dibatalkan."
              : "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Tidak ada journal atau saldo yang terpengaruh."
          }
          confirmLabel={t.confirmLabel}
          confirmTone={t.tone === "danger" ? "solid-danger" : "primary"}
          busy={busy}
          confirmDisabled={confirm === "post" && !postable}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        >
          {confirm === "post" && <JournalPreview load={() => previewCashPaymentPostingAction(id)} onReady={setPostable} />}
          {t.needsReason && (
            <Field label="Alasan" span={12} required error={reasonError}>
              <textarea
                className={`ta${reasonError ? " bad" : ""}`}
                rows={2}
                value={reason}
                autoFocus
                placeholder="Mengapa penerimaan ini dibatalkan…"
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
