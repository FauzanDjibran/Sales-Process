"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { JournalPreview } from "@/components/ui/journal-preview";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import {
  previewStockIssuePostingAction,
  transitionStockIssueAction,
} from "@/app/actions/stock-issue";
import {
  headerButtonClass,
  orderForHeader,
  type ActionTone,
} from "@/lib/erp/header-actions";
import {
  STOCK_ISSUE_TRANSITIONS,
  availableStockIssueActions,
  stockIssueIsEditable,
  type StockIssueAbilities,
  type StockIssueAction,
  type StockIssueStatus,
} from "@/lib/erp/stock-issue-workflow";
import { todayIso } from "@/lib/format";

/** Why a final issue offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<StockIssueStatus, string>> = {
  Posted: "Menunggu diterima Workstation",
  Received: "Diterima di Workstation",
  Rejected: "Ditolak — kembali ke gudang",
  Cancelled: "Stock Issue dibatalkan",
};

/**
 * A Stock Issue's lifecycle as buttons in the page header (P158; the Logistik
 * BSTB, M113): Ubah (Draft only), Batalkan and Posting; then, at the
 * workstation, Tolak and Terima, each on a day the user picks. Posting's and
 * Tolak's confirmations show the journal each will write — from the step itself
 * run as a dry run and rolled back (P103) — with the confirm button disabled
 * until it loads or while it refuses.
 */
export function StockIssueActions({
  id,
  subject,
  status,
  issueDate,
  can,
}: {
  id: number;
  subject: string;
  status: StockIssueStatus;
  /** Terima / Tolak may not be dated before it. */
  issueDate: string;
  can: StockIssueAbilities;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<StockIssueAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [date, setDate] = useState("");
  const [dateError, setDateError] = useState("");
  const [busy, setBusy] = useState(false);
  const [postable, setPostable] = useState(false);

  const run = async (action: StockIssueAction) => {
    const t = STOCK_ISSUE_TRANSITIONS[action];
    if (t.reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    if (t.dated && !date) {
      setDateError("Tanggal wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionStockIssueAction(
      id,
      action,
      reason,
      t.dated ? date : undefined,
    );
    setBusy(false);
    if (!result.ok) {
      if (result.errors.reason || result.errors.date) {
        setReasonError(result.errors.reason ?? "");
        setDateError(result.errors.date ?? "");
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
                <Link
                  key="edit"
                  className="btn"
                  href={`/inventory/stock-issue/${id}/edit`}
                >
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
                setDate(
                  t.dated
                    ? todayIso() < issueDate
                      ? issueDate
                      : todayIso()
                    : "",
                );
                setDateError("");
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
    (i) => i.tone,
  );

  const t = confirm ? STOCK_ISSUE_TRANSITIONS[confirm] : null;
  const previewOf = confirm === "post" || confirm === "reject" ? confirm : null;
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
          wide={Boolean(t.journal)}
          icon={t.icon}
          tone={t.tone === "danger" ? "danger" : "ok"}
          title={t.title}
          subject={subject}
          body={t.body}
          confirmLabel={t.confirmLabel}
          confirmTone={t.tone === "danger" ? "solid-danger" : "primary"}
          busy={busy}
          confirmDisabled={Boolean(t.journal) && !postable}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        >
          {t.dated && !t.reason && <HoldFocus />}
          {t.dated && (
            <Field
              label={confirm === "reject" ? "Tanggal Tolak" : "Tanggal Terima"}
              span={12}
              required
              error={dateError}
            >
              <DateInput
                value={date}
                invalid={Boolean(dateError)}
                onChange={(v) => {
                  setDate(v);
                  setDateError("");
                  setPostable(false);
                }}
              />
            </Field>
          )}
          {previewOf && (!t.dated || date) && (
            // A new date is a new dry run: the journal is dated by it and the period must be open.
            <JournalPreview
              key={date}
              load={() =>
                previewStockIssuePostingAction(
                  id,
                  previewOf,
                  t.dated ? date : undefined,
                )
              }
              onReady={setPostable}
            />
          )}
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

/**
 * Takes the dialog's first focus, so a dated step's `DateInput` — which opens
 * its calendar on focus — does not open over the consequences the dialog
 * states (P103). `useDialogFocus` keeps a focus a child already took; Tab
 * still reaches the date next. Tolak needs none: its reason box autofocuses.
 */
function HoldFocus() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return <div ref={ref} tabIndex={-1} aria-hidden="true" />;
}
