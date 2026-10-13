"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { previewStockIssuePostingAction, transitionStockIssueAction } from "@/app/actions/stock-issue";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  STOCK_ISSUE_TRANSITIONS,
  availableStockIssueActions,
  stockIssueIsEditable,
  type StockIssueAbilities,
  type StockIssueAction,
  type StockIssueStatus,
} from "@/lib/erp/stock-issue-workflow";

/** Why a final note offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<StockIssueStatus, string>> = {
  Posted: "Stock Issue diposting",
  Cancelled: "Stock Issue dibatalkan",
};

/**
 * A Stock Issue's lifecycle as buttons in the page header (P158): Ubah (Draft
 * only), Batalkan and Posting. Posting's confirmation shows the journal it will
 * write — WIP debited, Persediaan credited, per item at the cost the stock books
 * release — from the posting itself run as a dry run and rolled back (P103). An
 * issue that cannot post (short stock, lots not picked in full, no WIP account)
 * says why there, with *Ya, Posting* disabled.
 */
export function StockIssueActions({
  id,
  subject,
  status,
  can,
}: {
  id: number;
  subject: string;
  status: StockIssueStatus;
  can: StockIssueAbilities;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<StockIssueAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);
  const [postable, setPostable] = useState(false);

  const run = async (action: StockIssueAction) => {
    if (STOCK_ISSUE_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionStockIssueAction(id, action, reason);
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

  const actions = availableStockIssueActions(status, can);
  const buttons = orderForHeader(
    [
      ...(stockIssueIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/inventory/stock-issue/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = STOCK_ISSUE_TRANSITIONS[a];
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

  const t = confirm ? STOCK_ISSUE_TRANSITIONS[confirm] : null;
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
          wide={confirm === "post"}
          icon={t.icon}
          tone={t.tone === "danger" ? "danger" : "ok"}
          title={t.title}
          subject={subject}
          body={t.body}
          confirmLabel={t.confirmLabel}
          confirmTone={t.tone === "danger" ? "solid-danger" : "primary"}
          busy={busy}
          confirmDisabled={confirm === "post" && !postable}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        >
          {confirm === "post" && <JournalPreview load={() => previewStockIssuePostingAction(id)} onReady={setPostable} />}
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
