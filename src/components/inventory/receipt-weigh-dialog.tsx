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

const BADGE = { Within: "s-ok", Above: "s-info", Below: "s-warn" } as const;

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
  const fig = (n: number | null | undefined, unit: string) => (n == null ? "—" : `${formatQty(n)} ${unit}`);

  return (
    <Dialog
      open
      icon="scale"
      title="Penimbangan"
      subtitle={`${line.itemLabel} · ${line.itemName}`}
      width={720}
      onClose={onClose}
      foot={
        <>
          <span className="fnote">
            {w && w.bonus > 0
              ? "Bonus masuk stok bernilai 0 lewat Stock Receipt saat Posting."
              : w?.result === "Below"
                ? "Yang diterima mengikuti timbangan; kekurangannya tetap terbuka di Purchase Order."
                : "Qty Terima dihitung dari Qty SJ dan Qty Timbangan."}
          </span>
          <button className="btn" onClick={onClose}>
            {editing ? "Batal" : "Tutup"}
          </button>
          {editing && (
            <button className="btn primary" disabled={!w || over || !(w.receivedBase > 0)} onClick={() => onApply(sj, scale)}>
              <Icon name="check" size={15} /> Terapkan
            </button>
          )}
        </>
      }
    >
      <FormRow>
        <Field
          label="Qty SJ"
          required={editing}
          help={editing ? `sisa PO ${formatQty(left)} ${line.uomLabel}` : undefined}
          error={over ? `Melebihi sisa Purchase Order (${formatQty(left)} ${line.uomLabel}).` : undefined}
        >
          {editing ? (
            <MoneyInput value={sj} currencyLabel={line.uomLabel} decimals={6} invalid={over} onChange={setSj} />
          ) : (
            <div className="ro">
              <span className="mny">{fig(qty, line.uomLabel)}</span>
            </div>
          )}
        </Field>
        <Field label="Qty Timbangan" required={editing} help={range ? `toleransi ${formatQty(range.lower)} – ${formatQty(range.upper)} Kg` : undefined}>
          {editing ? (
            <MoneyInput value={scale} currencyLabel="Kg" decimals={4} onChange={setScale} />
          ) : (
            <div className="ro">
              <span className="mny">{fig(Number(scale), "Kg")}</span>
            </div>
          )}
        </Field>
      </FormRow>
      <div className="uw-pair">
        <div className="impact">
          <div className="ttl">Pembanding</div>
          <Row label="Qty PO" value={fig(line.qty, line.uomLabel)} />
          <Row label={`Berat satuan per ${line.baseUomLabel}`} value={fig(rule.itemWeight, "Kg")} />
          <Row label="Toleransi" value={`± ${formatPct(rule.tolerance)}`} />
          <Row label="Qty pembanding" value={fig(range?.calculated, "Kg")} total />
        </div>
        <div className="impact" aria-live="polite">
          <div className="ttl">
            Hasil Timbangan
            {w ? <span className={`bdg ${BADGE[w.result]}`}>{WEIGHING_RESULT_TEXT[w.result]}</span> : <span className="bdg t-slate">Belum ditimbang</span>}
          </div>
          <Row label="Selisih dari pembanding" value={w ? fig(+(Number(scale) - w.calculated).toFixed(6), "Kg") : "—"} />
          <Row label="Qty terima" value={fig(w?.received, line.uomLabel)} />
          <Row label="Qty bonus" value={fig(w?.bonus, line.baseUomLabel)} />
          <Row label="Qty stock" value={fig(w?.receivedBase, line.baseUomLabel)} total />
        </div>
      </div>
    </Dialog>
  );
}

function Row({ label, value, total }: { label: string; value: string; total?: boolean }) {
  return (
    <div className={`ir${total ? " tot" : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
