"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormRow } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { receivedBaseQty } from "@/lib/erp/receipt-note-workflow";
import { WEIGHING_RESULT_TEXT, weigh, type WeighingRule } from "@/lib/erp/receipt-weighting";
import type { RnSourceLine } from "@/lib/erp/receipt-note";
import { formatPct, formatQty } from "@/lib/format";

const TONE = { Within: "ok", Above: "bad", Below: "warn" } as const;

/**
 * Penimbangan (P321): the supplier's quantity and the scale's weight on one
 * screen, with what is received worked out as they are typed — by the module
 * the save and Posting use.
 */
export function ReceiptWeighDialog({
  line,
  rule,
  left,
  sj: initialSj,
  scale: initialScale,
  editing,
  onApply,
  onClose,
}: {
  line: RnSourceLine;
  rule: WeighingRule;
  /** What the PO line has left, in its unit. */
  left: number;
  sj: string;
  scale: string;
  editing: boolean;
  onApply: (sj: string, scale: string) => void;
  onClose: () => void;
}) {
  const [sj, setSj] = useState(initialSj);
  const [scale, setScale] = useState(initialScale);
  const qty = Number(sj) || 0;
  const over = editing && qty > left + 0.0000005;
  const sjBase = receivedBaseQty(qty, line);
  const w = qty > 0 && Number(scale) > 0 ? weigh({ sj: qty, sjBase, factor: line.uomFactor, scale: Number(scale), rule }) : null;
  // The range does not wait for the scale.
  const range = qty > 0 ? weigh({ sj: qty, sjBase, factor: line.uomFactor, scale: 0, rule }) : null;
  const read = (n: number | null, unit: string) => (
    <div className={`ro${n == null ? " nil" : ""}`}>{n == null ? "menunggu" : <><span className="mny">{formatQty(n)}</span> <span className="lab">{unit}</span></>}</div>
  );

  return (
    <Dialog
      open
      icon="scale"
      title="Penimbangan"
      subtitle={`${line.itemLabel} · ${line.itemName}`}
      width={820}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">{over ? `Qty SJ melebihi sisa Purchase Order (${formatQty(left)} ${line.uomLabel}).` : "Qty Terima mengikuti hasil timbangan."}</span>
          <button className="btn" onClick={onClose}>
            {editing ? "Batal" : "Tutup"}
          </button>
          {editing && (
            <button className="btn primary" disabled={!w || over || !(w.receivedBase > 0)} onClick={() => onApply(sj, scale)}>
              <Icon name="check" size={15} /> Simpan
            </button>
          )}
        </>
      }
    >
      <div className="wgh">
        <div>
          <FormRow>
            <Field label="Qty PO" span={12}>
              {read(line.qty, line.uomLabel)}
            </Field>
            <Field label="Qty SJ" span={12} required={editing} help={editing ? `sisa ${formatQty(left)}` : undefined}>
              {editing ? <MoneyInput value={sj} currencyLabel={line.uomLabel} decimals={6} invalid={over} onChange={setSj} /> : read(qty, line.uomLabel)}
            </Field>
            <Field label="Berat Satuan" span={6}>
              {read(rule.itemWeight, "Kg")}
            </Field>
            <Field label="Toleransi" span={6}>
              <div className="ro">{formatPct(rule.tolerance)}</div>
            </Field>
            <Field label="Qty Pembanding" span={12}>
              {read(range?.calculated ?? null, "Kg")}
            </Field>
          </FormRow>
        </div>
        <div>
          <FormRow>
            <Field label="Qty Timbangan" span={12} required={editing}>
              <div className="wgh-n">
                {editing ? <MoneyInput value={scale} decimals={4} ariaLabel="Qty Timbangan" onChange={setScale} /> : <span className="mny">{formatQty(scale)}</span>}
                <span>Kg</span>
              </div>
            </Field>
            <Field label="Range Toleransi" span={12}>
              <div className={`ro${range ? "" : " nil"}`}>
                {range ? (
                  <>
                    <span className="mny">
                      {formatQty(range.lower)} – {formatQty(range.upper)}
                    </span>{" "}
                    <span className="lab">Kg</span>
                  </>
                ) : (
                  "menunggu Qty SJ"
                )}
              </div>
            </Field>
            <div style={{ gridColumn: "span 12" }} className={`wgh-r ${w ? TONE[w.result] : ""}`} role="status">
              {w ? WEIGHING_RESULT_TEXT[w.result] : "Isi Qty Timbangan"}
            </div>
            <Field label="Qty Terima" span={6} help={w && line.uomFactor !== 1 ? `= ${formatQty(w.receivedBase)} ${line.baseUomLabel}` : undefined}>
              {read(w?.received ?? null, line.uomLabel)}
            </Field>
            {w && w.bonus > 0 && (
              <Field label="Qty Bonus" span={6} help="masuk stok bernilai 0">
                {read(w.bonus, line.baseUomLabel)}
              </Field>
            )}
          </FormRow>
        </div>
      </div>
    </Dialog>
  );
}
