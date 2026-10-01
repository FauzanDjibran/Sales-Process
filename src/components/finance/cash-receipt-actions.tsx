"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { previewCashReceiptPostingAction, transitionCashReceiptAction } from "@/app/actions/cash-receipt";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  CASH_RECEIPT_TRANSITIONS,
  availableCashReceiptActions,
  cashBankTxIsEditable,
  type CashBankTxAction,
  type CashBankTxStatus,
  type CashReceiptAbilities,
} from "@/lib/erp/cash-bank-tx-workflow";
import type { PostingLine } from "@/lib/erp/cash-bank-tx";
import { formatMoney } from "@/lib/format";

/**
 * A receipt's lifecycle as header buttons: Ubah (Draft only), Posting and
 * Batalkan. **Posting shows the journal it will write before writing it** —
 * the lines come from the same function the posting runs, so what the dialog
 * shows is what the book gets (design convention: consequences before
 * commitment). A receipt that cannot post says why instead of offering the
 * button's dialog.
 */
export function CashReceiptActions({
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
  const [preview, setPreview] = useState<PostingLine[] | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  const open = async (action: CashBankTxAction) => {
    setReason("");
    setReasonError("");
    if (action === "post") {
      setBusy(true);
      const p = await previewCashReceiptPostingAction(id);
      setBusy(false);
      if (!p.ok) {
        toast("Belum bisa diposting", p.errors._form, "err");
        return;
      }
      setPreview(p.lines);
    }
    setConfirm(action);
  };

  const run = async (action: CashBankTxAction) => {
    if (CASH_RECEIPT_TRANSITIONS[action].needsReason && !reason.trim()) {
      setReasonError("Alasan pembatalan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionCashReceiptAction(id, action, reason);
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
                <Link key="edit" className="btn" href={`/finance/cash-bank/receipt/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...availableCashReceiptActions(status, can).map((a) => {
        const t = CASH_RECEIPT_TRANSITIONS[a];
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

  const t = confirm ? CASH_RECEIPT_TRANSITIONS[confirm] : null;
  const money = (n: number) => (n ? formatMoney(n, "IDR") : "");
  const totalDebit = (preview ?? []).reduce((a, l) => a + l.debit, 0);

  return (
    <>
      {buttons.length ? (
        buttons.map((b) => b.node)
      ) : (
        <span className="lockchip">
          <Icon name="lock" size={13} />{" "}
          {status === "Cancelled" ? "Penerimaan dibatalkan" : status === "Posted" ? "Terkunci setelah Posting" : "Terkunci"}
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
              ? "Dana dicatat di Buku Kas & Bank dan journal di bawah ini dibentuk pada tanggal terima. Penerimaan yang sudah diposting tidak dapat diubah atau dibatalkan."
              : "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Tidak ada journal atau saldo yang terpengaruh."
          }
          confirmLabel={t.confirmLabel}
          confirmTone={t.tone === "danger" ? "solid-danger" : "primary"}
          busy={busy}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        >
          {confirm === "post" && preview && (
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="num" style={{ width: 130 }}>Debit</th>
                    <th className="num" style={{ width: 130 }}>Kredit</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <span className="dstack">
                          <span className="d1">
                            <span className="lab">{l.accountNo}</span> {l.accountName}
                          </span>
                          <span className="d2">{l.description}</span>
                        </span>
                      </td>
                      <td className="num">
                        <span className="mny">{money(l.debit)}</span>
                      </td>
                      <td className="num">
                        <span className="mny">{money(l.credit)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="totrow">
                    <td style={{ textAlign: "right" }}>Total</td>
                    <td className="num">
                      <span className="mny">{formatMoney(totalDebit, "IDR")}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{formatMoney(totalDebit, "IDR")}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
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
