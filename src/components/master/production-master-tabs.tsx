"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormRow } from "@/components/ui/form";
import { RateInput } from "@/components/ui/rate-input";
import { CollectionCard, RowActions, newKey, type CollectionTabProps } from "@/components/master/collection-tab";
import { Select } from "@/components/ui/select";
import {
  EXIT_ROUTE_LABEL,
  STEP_PROCESSES,
  STEP_PROCESS_LABEL,
  exitRoutes,
  stepErrors,
  unitStepRuleErrors,
  type BomComponentDraft,
  type RateDraft,
  type StepDraft,
  type StepProcess,
  type UnitStepDraft,
} from "@/lib/erp/production-master-shape";
import { formatPrice } from "@/lib/format";
import type { RefOption } from "@/lib/erp/records";

/**
 * The Routing form's Langkah tab and the Standard Cost form's Rate per Unit
 * tab (P225). Rows are saved with the record; the order of the steps is the
 * order of the routing.
 */

function UnitCell({ units, id }: { units: RefOption[]; id: number | null }) {
  const u = units.find((x) => x.id === id);
  return u ? (
    <>
      <span className="lab">{u.label}</span> {u.name}
    </>
  ) : (
    <span className="mut">—</span>
  );
}

const offered = (units: RefOption[], keep: number | null) => units.filter((u) => u.active || u.id === keep);

// ------------------------------------------------------------- routing steps

export function RoutingStepsTab({ editing, locked, items, error, onChange, context }: CollectionTabProps<StepDraft>) {
  const [open, setOpen] = useState<StepDraft | null>(null);
  const units = context?.refs._units ?? [];
  const routes = exitRoutes(
    items.map((s) => units.find((u) => u.id === s.unit_id)?.workstationId ?? null),
    Number(context?.values.line_id) > 0
  );

  const blank = (): StepDraft => ({ key: newKey("s"), unit_id: null, is_checkpoint: false, is_skippable: false });
  const apply = (s: StepDraft) => {
    onChange(items.some((x) => x.key === s.key) ? items.map((x) => (x.key === s.key ? s : x)) : [...items, s]);
    setOpen(null);
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };

  return (
    <CollectionCard
      icon="tree"
      title="Langkah"
      desc="Unit berurutan yang dilalui barang. Keluar Lewat dihitung dari Workstation: satu Workstation Dokumen Push, lintas Workstation BSTB."
      editing={editing}
      locked={locked}
      addLabel="Tambah Langkah"
      onAdd={() => setOpen(blank())}
      error={error}
    >
      {items.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="tree" size={18} />
          </div>
          <h4>Belum ada langkah</h4>
          <p>Tambahkan unit pertama yang dilalui barang.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid coll" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>Unit</th>
                <th style={{ width: 130 }}>Keluar Lewat</th>
                <th style={{ width: 110 }}>Checkpoint</th>
                <th style={{ width: 110 }}>Boleh Dilewati</th>
                {editing && <th style={{ width: 130 }} />}
              </tr>
            </thead>
            <tbody>
              {items.map((s, i) => (
                <tr key={s.key} className={editing ? "ed" : undefined} onClick={editing ? () => setOpen(s) : undefined}>
                  <td className="no">{i + 1}</td>
                  <td>
                    <UnitCell units={units} id={s.unit_id} />
                  </td>
                  <td>{routes[i] ? EXIT_ROUTE_LABEL[routes[i]] : "—"}</td>
                  <td>{s.is_checkpoint ? "Ya" : "—"}</td>
                  <td>{s.is_skippable ? "Ya" : "—"}</td>
                  {editing && (
                    <td>
                      <div className="ract">
                        <button
                          className="iact"
                          title="Naik"
                          disabled={i === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            move(i, -1);
                          }}
                        >
                          <Icon name="collapse" size={14} />
                        </button>
                        <button
                          className="iact"
                          title="Turun"
                          disabled={i === items.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            move(i, 1);
                          }}
                        >
                          <Icon name="expand" size={14} />
                        </button>
                        <RowActions onEdit={() => setOpen(s)} onRemove={() => onChange(items.filter((x) => x.key !== s.key))} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <StepDialog
          initial={open}
          isNew={!items.some((x) => x.key === open.key)}
          units={units}
          takenUnits={items.filter((x) => x.key !== open.key).flatMap((x) => (x.unit_id ? [x.unit_id] : []))}
          onCancel={() => setOpen(null)}
          onApply={apply}
        />
      )}
    </CollectionCard>
  );
}

function StepDialog({
  initial,
  isNew,
  units,
  takenUnits,
  onCancel,
  onApply,
}: {
  initial: StepDraft;
  isNew: boolean;
  units: RefOption[];
  takenUnits: number[];
  onCancel: () => void;
  onApply: (s: StepDraft) => void;
}) {
  const [s, setS] = useState<StepDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = () => {
    const found = stepErrors(s, takenUnits);
    if (Object.keys(found).length) setErrors(found);
    else onApply(s);
  };
  return (
    <Dialog
      open
      icon="tree"
      title={isNew ? "Tambah Langkah" : "Ubah Langkah"}
      subtitle="Satu unit dalam urutan routing."
      width={620}
      onClose={onCancel}
      foot={
        <>
          <span className="fnote">Tersimpan ke database saat Routing disimpan.</span>
          <button className="btn" onClick={onCancel}>
            Batal
          </button>
          <button className="btn primary" onClick={submit}>
            <Icon name="check" size={15} /> {isNew ? "Tambahkan" : "Perbarui"}
          </button>
        </>
      }
    >
      <FormRow>
        <Field label="Unit" span={12} required error={errors.unit_id}>
          <Combobox
            value={s.unit_id}
            options={offered(units, initial.unit_id)}
            placeholder="Pilih Unit…"
            invalid={Boolean(errors.unit_id)}
            onChange={(v) => {
              setS((x) => ({ ...x, unit_id: v == null ? null : Number(v) }));
              setErrors((e) => ({ ...e, unit_id: "" }));
            }}
          />
        </Field>
        <Field label="Checkpoint" span={6} help="keluar langkah ini seluruh isi partai harus lengkap">
          <label className="chk sm">
            <input type="checkbox" checked={s.is_checkpoint} onChange={(e) => setS((x) => ({ ...x, is_checkpoint: e.target.checked }))} />
            <span>
              <span className="ct">Checkpoint partai</span>
            </span>
          </label>
        </Field>
        <Field label="Dilewati" span={6}>
          <label className="chk sm">
            <input type="checkbox" checked={s.is_skippable} onChange={(e) => setS((x) => ({ ...x, is_skippable: e.target.checked }))} />
            <span>
              <span className="ct">Boleh dilewati</span>
            </span>
          </label>
        </Field>
      </FormRow>
    </Dialog>
  );
}

// ---------------------------------------------------------------- unit steps

/**
 * The Unit's Proses tab: its ordered steps (T1). Rules as the Server Action
 * applies them: each process once, QC last, Assembly alone.
 */
export function UnitStepsTab({ editing, locked, items, error, onChange }: CollectionTabProps<UnitStepDraft>) {
  const [open, setOpen] = useState<UnitStepDraft | null>(null);
  const blank = (): UnitStepDraft => ({ key: newKey("u"), process: null });
  const apply = (s: UnitStepDraft) => {
    onChange(items.some((x) => x.key === s.key) ? items.map((x) => (x.key === s.key ? s : x)) : [...items, s]);
    setOpen(null);
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  const problems = items.length ? unitStepRuleErrors(items) : [];

  return (
    <CollectionCard
      icon="tree"
      title="Proses"
      desc="Pekerjaan di unit ini, berurutan. Barang masuk ke proses pertama, pindah ke berikutnya tanpa Push, dan menunggu di Stand By sesudah proses terakhir."
      editing={editing}
      locked={locked}
      addLabel="Tambah Proses"
      onAdd={() => setOpen(blank())}
      error={error ?? (editing && problems.length ? problems.join(" ") : undefined)}
    >
      {items.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="tree" size={18} />
          </div>
          <h4>Belum ada proses</h4>
          <p>Tambahkan proses pertama yang dikerjakan di unit ini.</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid coll" style={{ minWidth: 460 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>Proses</th>
                {editing && <th style={{ width: 130 }} />}
              </tr>
            </thead>
            <tbody>
              {items.map((s, i) => (
                <tr key={s.key} className={editing ? "ed" : undefined} onClick={editing ? () => setOpen(s) : undefined}>
                  <td className="no">{i + 1}</td>
                  <td>{s.process ? STEP_PROCESS_LABEL[s.process] : <span className="mut">—</span>}</td>
                  {editing && (
                    <td>
                      <div className="ract">
                        <button
                          className="iact"
                          title="Naik"
                          disabled={i === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            move(i, -1);
                          }}
                        >
                          <Icon name="collapse" size={14} />
                        </button>
                        <button
                          className="iact"
                          title="Turun"
                          disabled={i === items.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            move(i, 1);
                          }}
                        >
                          <Icon name="expand" size={14} />
                        </button>
                        <RowActions onEdit={() => setOpen(s)} onRemove={() => onChange(items.filter((x) => x.key !== s.key))} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <UnitStepDialog
          initial={open}
          isNew={!items.some((x) => x.key === open.key)}
          taken={items.filter((x) => x.key !== open.key).flatMap((x) => (x.process ? [x.process] : []))}
          onCancel={() => setOpen(null)}
          onApply={apply}
        />
      )}
    </CollectionCard>
  );
}

function UnitStepDialog({
  initial,
  isNew,
  taken,
  onCancel,
  onApply,
}: {
  initial: UnitStepDraft;
  isNew: boolean;
  taken: StepProcess[];
  onCancel: () => void;
  onApply: (s: UnitStepDraft) => void;
}) {
  const [process, setProcess] = useState<StepProcess | null>(initial.process);
  const [error, setError] = useState("");
  const options = STEP_PROCESSES.filter((p) => !taken.includes(p)).map((p) => ({ value: p, label: STEP_PROCESS_LABEL[p] }));
  const submit = () => {
    if (!process) setError("Pilih proses.");
    else onApply({ ...initial, process });
  };
  return (
    <Dialog
      open
      icon="tree"
      title={isNew ? "Tambah Proses" : "Ubah Proses"}
      subtitle="Satu proses dalam urutan unit."
      width={520}
      onClose={onCancel}
      foot={
        <>
          <span className="fnote">Tersimpan ke database saat Unit disimpan.</span>
          <button className="btn" onClick={onCancel}>
            Batal
          </button>
          <button className="btn primary" onClick={submit}>
            <Icon name="check" size={15} /> {isNew ? "Tambahkan" : "Perbarui"}
          </button>
        </>
      }
    >
      <FormRow>
        <Field label="Proses" span={12} required error={error} help="Assembly berdiri sendiri; QC diatur di header Unit">
          <Select
            value={process ?? ""}
            options={options}
            placeholder="Pilih proses…"
            onChange={(v) => {
              setProcess(v as StepProcess);
              setError("");
            }}
          />
        </Field>
      </FormRow>
    </Dialog>
  );
}

// -------------------------------------------------------------------- rates

/**
 * One row per active Unit in routing order, typed in place: the version is written
 * once, so the whole of it is on one screen. A Unit left empty has no row and costs 0;
 * the rate is charged once, at the Unit's last process (P281).
 */
export function RateLinesTab({ editing, items, error, onChange, context }: CollectionTabProps<RateDraft>) {
  const units = context?.refs._steps ?? [];
  const rateOf = (stepId: number) => items.find((r) => r.unit_id === stepId)?.rate ?? "";
  const rows = units.filter((u) => (editing ? u.active : rateOf(u.id) !== ""));

  const type = (stepId: number, rate: string) =>
    onChange(
      rate === ""
        ? items.filter((r) => r.unit_id !== stepId)
        : items.some((r) => r.unit_id === stepId)
          ? items.map((r) => (r.unit_id === stepId ? { ...r, rate } : r))
          : [...items, { key: newKey("r"), unit_id: stepId, rate }]
    );

  return (
    <CollectionCard
      icon="calc"
      title="Rate per Unit"
      desc="Rate biaya per gram per Unit, urut routing, dibebankan sekali saat proses terakhir Unit selesai. Yang kosong berarti rate 0. Versi tidak dapat diubah setelah disimpan."
      editing={editing}
      error={error}
    >
      {rows.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="calc" size={18} />
          </div>
          <h4>{editing ? "Belum ada Unit aktif" : "Semua Unit berate 0"}</h4>
          <p>{editing ? "Buat Unit di Master › Unit lebih dulu." : "Versi ini tidak mengisi rate untuk Unit mana pun."}</p>
        </div>
      ) : (
        <div className="tw">
          <table className="grid coll" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>Unit</th>
                <th className="num" style={{ width: 220 }}>
                  Rate per Gram
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u, i) => (
                <tr key={u.id}>
                  <td className="no">{i + 1}</td>
                  <td>
                    <span className="lab">{u.label}</span> {u.name}
                  </td>
                  <td className="num mono">
                    {editing ? <RateInput value={rateOf(u.id)} pairLabel="Rp/g" onChange={(v) => type(u.id, v)} /> : formatPrice(rateOf(u.id))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CollectionCard>
  );
}

// --------------------------------------------------------------- BoM Packing

/**
 * BoM Packing's bahan penolong per kotak (P284), typed in place: a row per
 * Barang and its quantity in the item's base unit, used up at Tutup Kotak.
 */
export function BomComponentsTab({ editing, items, error, onChange, context }: CollectionTabProps<BomComponentDraft>) {
  const options = context?.refs._components ?? [];
  const set = (key: string, patchRow: Partial<BomComponentDraft>) => onChange(items.map((r) => (r.key === key ? { ...r, ...patchRow } : r)));
  return (
    <CollectionCard icon="box" title="Bahan Penolong per Kotak" desc="Dipakai dari saldo bahan penolong Unit saat Tutup Kotak. Jumlah dalam satuan dasar bahan." editing={editing} error={error}>
      {items.length ? (
        <div className="tw">
          <table className="grid coll" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>No</th>
                <th>Bahan Penolong</th>
                <th className="num" style={{ width: 160 }}>
                  Jumlah per Kotak
                </th>
                {editing && <th style={{ width: 44 }} />}
              </tr>
            </thead>
            <tbody>
              {items.map((r, i) => (
                <tr key={r.key}>
                  <td className="no">{i + 1}</td>
                  <td>
                    {editing ? (
                      <Combobox size="sm" value={r.item_id} options={options.filter((o) => o.id === r.item_id || !items.some((x) => x.item_id === o.id))} placeholder="Pilih bahan…" onChange={(v) => set(r.key, { item_id: v })} />
                    ) : (
                      <UnitCell units={options} id={r.item_id} />
                    )}
                  </td>
                  <td className="num mono">
                    {editing ? <input className="inp sm" style={{ textAlign: "right" }} inputMode="decimal" value={r.qty} aria-label={`Jumlah bahan ${i + 1}`} onChange={(e) => set(r.key, { qty: e.target.value })} /> : r.qty}
                  </td>
                  {editing && (
                    <td>
                      <button type="button" className="iact del" title="Hapus" onClick={() => onChange(items.filter((x) => x.key !== r.key))}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty sm">
          <div className="ic">
            <Icon name="box" size={18} />
          </div>
          <h4>Tanpa bahan penolong</h4>
          <p>{editing ? "Tambahkan Gramasi, Stiker Daun, atau bahan lain yang dipakai tiap kotak." : "Kotak ini tidak memakai bahan penolong."}</p>
        </div>
      )}
      {editing && (
        <div className="card-b">
          <button type="button" className="btn sm" onClick={() => onChange([...items, { key: newKey("c"), item_id: null, qty: "1" }])}>
            <Icon name="plus" size={14} /> Tambah Bahan
          </button>
        </div>
      )}
    </CollectionCard>
  );
}
