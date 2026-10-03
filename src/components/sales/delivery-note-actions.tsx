"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { transitionDeliveryNoteAction } from "@/app/actions/delivery-note";
import { headerButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import {
  DELIVERY_NOTE_TRANSITIONS,
  availableDeliveryNoteActions,
  deliveryNoteIsEditable,
  type DeliveryNoteAbilities,
  type DeliveryNoteAction,
  type DeliveryNoteStatus,
} from "@/lib/erp/delivery-note-workflow";
import type { DeliveryNotePreview } from "@/lib/erp/delivery-note";
import { formatMoney, formatNumber } from "@/lib/format";

/** Why a final note offers no button, for the lock chip. */
const LOCK_TEXT: Partial<Record<DeliveryNoteStatus, string>> = {
  Posted: "Delivery Note diposting",
  Cancelled: "Delivery Note dibatalkan",
};

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const money = (n: number) => formatMoney(n, "IDR");

/**
 * A Delivery Note's lifecycle as buttons in the page header: Ubah (Draft only),
 * Batalkan and Posting. Posting's confirmation states the journal it will write
 * — HPP debited, Persediaan credited, per item at its Harga Pokok — and refuses
 * up front when an item has no Harga Pokok or Account Mapping is incomplete.
 */
export function DeliveryNoteActions({
  id,
  subject,
  status,
  can,
  preview,
}: {
  id: number;
  subject: string;
  status: DeliveryNoteStatus;
  can: DeliveryNoteAbilities;
  /** What Posting would write; null once the note is final. */
  preview: DeliveryNotePreview | null;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<DeliveryNoteAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: DeliveryNoteAction) => {
    if (DELIVERY_NOTE_TRANSITIONS[action].reason && !reason.trim()) {
      setReasonError("Alasan wajib diisi.");
      return;
    }
    setBusy(true);
    const result = await transitionDeliveryNoteAction(id, action, reason);
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
    toast(result.message, result.closed.length ? `${subject} · selesai: ${result.closed.join(", ")}` : subject, "ok");
  };

  const actions = availableDeliveryNoteActions(status, can);
  const buttons = orderForHeader(
    [
      ...(deliveryNoteIsEditable(status) && can.edit
        ? [
            {
              key: "edit",
              tone: "neutral" as ActionTone,
              node: (
                <Link key="edit" className="btn" href={`/sales/delivery-note/${id}/edit`}>
                  <Icon name="pen" size={15} /> Ubah
                </Link>
              ),
            },
          ]
        : []),
      ...actions.map((a) => {
        const t = DELIVERY_NOTE_TRANSITIONS[a];
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

  const t = confirm ? DELIVERY_NOTE_TRANSITIONS[confirm] : null;
  // Posting cannot succeed without a Harga Pokok for every item and both
  // accounts mapped; say so before the button, not after it.
  const blocked =
    confirm === "post" && preview
      ? [
          ...(preview.missingCost.length
            ? [`Harga Pokok belum diisi untuk ${preview.missingCost.join(", ")} (Master › Harga Pokok (Sementara)).`]
            : []),
          ...(preview.accounts.missing.length ? [`Account Mapping belum lengkap: ${preview.accounts.missing.join(", ")}.`] : []),
        ]
      : [];

  // The journal Posting writes, in the order the posting writes it: per item,
  // HPP debited and Persediaan credited at its Harga Pokok.
  const journal = (preview?.lines ?? []).flatMap((l) => {
    const what = `${l.itemLabel} · ${qtyText(l.qty)} ${l.uomLabel}`;
    const amount = l.unitCost === null ? "—" : money(l.cost);
    const at = l.unitCost === null ? "Harga Pokok belum diisi" : `× ${money(l.unitCost)} per satuan dasar`;
    return [
      { side: "debit" as const, account: preview!.accounts.cogs, description: `HPP ${what} ${at}`, amount },
      { side: "credit" as const, account: preview!.accounts.inventory, description: `Keluar gudang · ${what}`, amount },
    ];
  });

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
          confirmDisabled={blocked.length > 0}
          onConfirm={() => run(confirm)}
          onCancel={() => setConfirm(null)}
        >
          {confirm === "post" && blocked.length > 0 && (
            <div className="nbox bad slim">
              <Icon name="warn" size={15} className="ni" />
              <div>
                {blocked.map((b) => (
                  <b key={b} style={{ display: "block" }}>
                    {b}
                  </b>
                ))}
              </div>
            </div>
          )}
          {confirm === "post" && preview && (
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="num" style={{ width: 130 }}>
                      Debit
                    </th>
                    <th className="num" style={{ width: 130 }}>
                      Kredit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {journal.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <span className="dstack">
                          <span className="d1">
                            {l.account ? (
                              <>
                                <span className="lab">{l.account.code}</span> {l.account.name}
                              </>
                            ) : (
                              <span className="dash">{l.side === "debit" ? "Account HPP" : "Account Persediaan"} belum dipetakan</span>
                            )}
                          </span>
                          <span className="d2">{l.description}</span>
                        </span>
                      </td>
                      <td className="num">
                        <span className="mny">{l.side === "debit" ? l.amount : ""}</span>
                      </td>
                      <td className="num">
                        <span className="mny">{l.side === "credit" ? l.amount : ""}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="totrow">
                    <td style={{ textAlign: "right" }}>Total</td>
                    <td className="num">
                      <span className="mny">{money(preview.total)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(preview.total)}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
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
