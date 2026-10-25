"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { HandoverActions } from "@/components/production/handover-actions";
import { createHandoverAction, updateHandoverAction } from "@/app/actions/production-handover";
import { HANDOVER_STATUS_BADGE, HANDOVER_STATUS_TEXT, handoverIsPosted, type HandoverAbilities } from "@/lib/erp/production-handover-workflow";
import type { HandoverHeaderInput, HandoverOptions, HandoverView } from "@/lib/erp/production-handover";
import { formatDate, formatMoney, formatNumber, todayIso } from "@/lib/format";

/**
 * A hand-over in all three modes: `new`, `edit` (Draft only) and `view`
 * (P167, M113, AD1).
 *
 * The user names the sending and the receiving workstation and the day, then the
 * goods — received goods the sender holds, by lot and Job. Goods of a Partai go
 * whole: *Isi seluruh Partai* puts every bucket of it on the page and the server
 * refuses a part. Goods that have no Partai yet start one: the user names the
 * Perintah and gives each line a **box**; a box becomes a Job, and one lot may be
 * split over several boxes by taking it on several lines. Goods already in a Job
 * keep it. No line carries a price: a hand-over changes where goods are, not what
 * they are worth.
 */

export type HandoverMode = "new" | "edit" | "view";

type LineState = { key: string; bucket_id: number | null; qty: string; box_no: string };

let seq = 0;
const newKey = () => `h${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const blankLine = (): LineState => ({ key: newKey(), bucket_id: null, qty: "", box_no: "" });

export function HandoverForm({
  mode,
  handover,
  options,
  can,
}: {
  mode: HandoverMode;
  handover: HandoverView | null;
  options: HandoverOptions;
  can: HandoverAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const bucketById = useMemo(() => new Map(options.buckets.map((b) => [b.id, b])), [options.buckets]);

  const [header, setHeader] = useState<HandoverHeaderInput>(() =>
    handover ? { ...handover.header } : { from_workstation_id: null, to_workstation_id: null, handover_date: todayIso(), order_id: null, note: "" }
  );
  const [lines, setLines] = useState<LineState[]>(() =>
    handover ? handover.lines.map((l) => ({ key: newKey(), bucket_id: Number(l.bucket_id), qty: String(l.qty), box_no: l.box_no == null ? "" : String(l.box_no) })) : []
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const posted = handover ? handoverIsPosted(handover.status) : false;
  const from = options.workstations.find((w) => w.id === header.from_workstation_id);
  const to = options.workstations.find((w) => w.id === header.to_workstation_id);
  /** What the sender holds, received: the only goods a hand-over can take. */
  const held = useMemo(
    () => options.buckets.filter((b) => !b.inTransit && b.qty > 0 && b.workstationId === header.from_workstation_id),
    [options.buckets, header.from_workstation_id]
  );
  const partaiHeld = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of held) if (b.partaiId != null && b.partaiNo) m.set(b.partaiId, b.partaiNo);
    return [...m.entries()];
  }, [held]);
  const picked = lines.map((l) => (l.bucket_id ? bucketById.get(l.bucket_id) : undefined));
  /** Goods with no Partai yet start one (O3): then a Perintah is named and every line without a Job is boxed. */
  const starts = picked.length > 0 && picked.every((b) => b && b.partaiId == null);
  const orderChoices = options.orders.filter(
    (o) => o.id === header.order_id || (o.open && !options.startedOrderIds.includes(o.id) && (!header.from_workstation_id || o.workstationIds.includes(header.from_workstation_id)))
  );

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof HandoverHeaderInput>(k: K, v: HandoverHeaderInput[K]) => {
    setHeader((x) => ({ ...x, [k]: v }));
    touch(k);
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };
  /** The goods are the sender's: another sender clears the page. */
  const pickFrom = (id: number | null) => {
    setHeader((x) => ({ ...x, from_workstation_id: id, order_id: null }));
    if (id !== header.from_workstation_id) setLines([]);
    touch("from_workstation_id", "_lines");
  };
  /** AD1: the whole Partai — every bucket of it at the station, every gram. */
  const fillPartai = (partaiId: number) => {
    const rest = lines.filter((l) => !(l.bucket_id && bucketById.get(l.bucket_id)?.partaiId === partaiId));
    const add = held
      .filter((b) => b.partaiId === partaiId)
      .map((b) => ({ key: newKey(), bucket_id: b.id, qty: String(b.qty), box_no: "" }));
    setLines([...rest, ...add]);
    touch("_lines");
  };

  async function onSave() {
    setSaving(true);
    const sent = lines;
    const payload = sent.map((l) => ({ bucket_id: l.bucket_id, qty: l.qty, box_no: l.box_no || null }));
    const result = mode === "edit" ? await updateHandoverAction(handover!.id, header, payload) : await createHandoverAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
        if (m) mapped[`lines.${sent[Number(m[1])]?.key}.${m[2]}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Hand-over disimpan", `${result.handoverNo} · Draft`, "ok");
    router.push(`/production/handover/${result.id}`);
  }

  const status = handover?.status ?? "Draft";
  const backHref = handover ? `/production/handover/${handover.id}` : "/production/handover";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const lineErr = (key: string, f: string) => errors[`lines.${key}.${f}`];
  const place = (p: { label: string; name: string } | undefined) =>
    p ? (
      ro(
        <>
          <span className="lab">{p.label}</span>
          <span>{p.name}</span>
        </>
      )
    ) : (
      nil()
    );

  // ======================================================= header card
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Penyerahan">
          <FormRow>
            <Field label="Dari Workstation" span={4} required={editing} help={editing ? "pengirim — memegang barangnya" : undefined} error={errors.from_workstation_id}>
              {editing ? (
                <Combobox
                  value={header.from_workstation_id}
                  options={options.workstations.filter((w) => w.active || w.id === header.from_workstation_id)}
                  placeholder="Pilih Workstation…"
                  invalid={Boolean(errors.from_workstation_id)}
                  onChange={pickFrom}
                />
              ) : (
                place(from)
              )}
            </Field>
            <Field label="Ke Workstation" span={4} required={editing} help={editing ? "penerima" : undefined} error={errors.to_workstation_id}>
              {editing ? (
                <Combobox
                  value={header.to_workstation_id}
                  options={options.workstations.filter((w) => (w.active || w.id === header.to_workstation_id) && w.id !== header.from_workstation_id)}
                  placeholder="Pilih Workstation…"
                  invalid={Boolean(errors.to_workstation_id)}
                  onChange={(v) => set("to_workstation_id", v)}
                />
              ) : (
                place(to)
              )}
            </Field>
            <Field label="Tanggal" span={4} required={editing} help={editing ? "hari barang diserahkan" : undefined} error={errors.handover_date}>
              {editing ? (
                <DateInput value={header.handover_date} invalid={Boolean(errors.handover_date)} onChange={(v) => set("handover_date", v)} />
              ) : (
                ro(formatDate(header.handover_date))
              )}
            </Field>
          </FormRow>
          <FormRow>
            <Field
              label="Perintah Produksi"
              span={6}
              required={editing && starts}
              help={editing ? (starts ? "barang belum punya Partai — hand-over ini memulainya" : "hanya untuk hand-over yang memulai Partai") : undefined}
              error={errors.order_id}
            >
              {editing ? (
                <Combobox
                  value={header.order_id ?? 0}
                  options={[
                    { id: 0, label: "", name: "Tanpa Perintah", active: true },
                    ...orderChoices.map((o) => ({ id: o.id, label: o.orderNo, name: `${o.targetLabel} · ${o.targetName}`, active: o.open })),
                  ]}
                  placeholder="Pilih Perintah Produksi…"
                  emptyText="Tidak ada Perintah Open yang rutenya melewati workstation ini."
                  invalid={Boolean(errors.order_id)}
                  onChange={(v) => set("order_id", v || null)}
                />
              ) : handover?.orderNo && header.order_id ? (
                ro(
                  <Link className="drl" href={`/production/order/${header.order_id}`}>
                    <span className="mono">{handover.orderNo}</span>
                  </Link>
                )
              ) : (
                nil("tidak memulai Partai")
              )}
            </Field>
            {posted && (
              <Field label="Partai" span={6}>
                {handover?.partaiNo ? ro(<span className="mono">{handover.partaiNo}</span>) : nil("belum ada")}
              </Field>
            )}
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={header.note} placeholder="Catatan penyerahan…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {handover?.cancelReason && status === "Cancelled" && (
          <p className="fnote">
            <b>Dibatalkan:</b> {handover.cancelReason}
          </p>
        )}
        {status === "Posted" && (
          <p className="fnote">
            <b>Dalam perjalanan</b> ke {to?.label ?? "Workstation tujuan"} — belum dapat dikerjakan sampai diterima.
          </p>
        )}
        {status === "Received" && handover?.receivedDate && (
          <p className="fnote">
            <b>Diterima</b> di {to?.label ?? "Workstation tujuan"} pada {formatDate(handover.receivedDate)}.
          </p>
        )}
        {status === "Rejected" && handover && (
          <p className="fnote">
            <b>Ditolak</b>
            {handover.receivedDate ? ` pada ${formatDate(handover.receivedDate)}` : ""}: {handover.rejectReason} — barang kembali ke {from?.label ?? "pengirim"}.
          </p>
        )}
      </FormBody>
    </div>
  );

  // ======================================================== lines card
  const addButton = (cta?: boolean) => (
    <button
      className={`btn sm primary${cta ? " cta" : ""}`}
      disabled={!header.from_workstation_id}
      title={header.from_workstation_id ? undefined : "Pilih Workstation pengirim dulu…"}
      onClick={() => {
        setLines((ls) => [...ls, blankLine()]);
        touch("_lines");
      }}
    >
      <Icon name="plus" size={14} /> Tambah Baris
    </button>
  );
  const viewLines = handover?.lines ?? [];
  const bucketOptions = held.map((b) => ({
    id: b.id,
    label: b.itemLabel,
    name: `lot ${b.lotNo}${b.jobNo ? ` · ${b.jobNo}` : ""}${b.partaiNo ? ` · ${b.partaiNo}` : ""} · ${qtyText(b.qty)}`,
    active: true,
  }));

  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang Diserahkan</h3>
          <p>
            {editing
              ? "Pilih barang yang diterima Workstation pengirim, per lot. Partai diserahkan utuh; barang yang belum punya Partai dibagi ke box (Job)."
              : "Barang per lot dan Job. Nilai ikut barang dan tidak berubah."}
          </p>
        </div>
        {editing && partaiHeld.map(([id, no]) => (
          <button key={id} className="btn sm" onClick={() => fillPartai(id)} title="Isi seluruh barang Partai ini di workstation pengirim">
            <Icon name="layers" size={14} /> Isi seluruh {no}
          </button>
        ))}
        {editing && lines.length > 0 && addButton()}
      </div>
      {errors._lines && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{errors._lines}</b>
          </div>
        </div>
      )}
      {lines.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="box" size={18} />
          </div>
          <h4>Belum ada barang</h4>
          <p>{header.from_workstation_id ? "Tambahkan baris, atau isi seluruh Partai yang dipegang pengirim." : "Pilih Workstation pengirim dulu…"}</p>
          {editing && addButton(true)}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: posted ? 980 : 880 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Barang</th>
                <th style={{ width: 170 }}>Qty</th>
                <th style={{ width: 150 }}>Job</th>
                {posted && <th style={{ width: 150 }}>Job Sekarang</th>}
                {posted && (
                  <th className="num" style={{ width: 140 }}>
                    Nilai
                  </th>
                )}
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const b = picked[i];
                const stored = viewLines[i];
                const lineError = lineErr(l.key, "bucket_id") ?? lineErr(l.key, "qty") ?? lineErr(l.key, "box_no");
                return (
                  <tr key={l.key} className={lineError ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {editing ? (
                        <Combobox
                          size="sm"
                          value={l.bucket_id}
                          options={bucketOptions}
                          placeholder="Pilih barang…"
                          emptyText="Workstation ini tidak memegang barang yang diterima."
                          invalid={Boolean(lineErr(l.key, "bucket_id"))}
                          onChange={(v) => {
                            const nb = v ? bucketById.get(v) : undefined;
                            setLine(l.key, { bucket_id: v, qty: nb ? String(nb.qty) : "", box_no: "" });
                          }}
                        />
                      ) : (
                        <span className="idc">
                          <span className="lab">{stored?.itemLabel}</span>
                          <span className="nm">
                            lot {stored?.lotNo}
                          </span>
                        </span>
                      )}
                      {lineError && <span className="overtag">{lineError}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <>
                          <div className="qcell">
                            <MoneyInput size="sm" decimals={6} value={l.qty} ariaLabel={`Qty baris ${i + 1}`} onChange={(v) => setLine(l.key, { qty: v })} />
                          </div>
                          {b && <span className="fulltag">saldo {qtyText(b.qty)}</span>}
                        </>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(Number(l.qty))}</span>
                        </span>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        b && b.jobId == null ? (
                          <div className="qcell">
                            <MoneyInput size="sm" decimals={0} value={l.box_no} ariaLabel={`Box baris ${i + 1}`} placeholder="Box" onChange={(v) => setLine(l.key, { box_no: v })} />
                          </div>
                        ) : b ? (
                          <span className="mono">{b.jobNo}</span>
                        ) : (
                          <span className="dash">—</span>
                        )
                      ) : stored?.box_no != null ? (
                        <span className="bdg s-mute">Box {stored.box_no}</span>
                      ) : stored?.fromJobNo ? (
                        <span className="mono">{stored.fromJobNo}</span>
                      ) : (
                        <span className="dash">—</span>
                      )}
                    </td>
                    {posted && <td>{stored?.jobNo ? <span className="mono">{stored.jobNo}</span> : <span className="dash">—</span>}</td>}
                    {posted && (
                      <td className="num">
                        <span className="mny">{formatMoney(stored?.cost ?? 0, "IDR")}</span>
                      </td>
                    )}
                    {editing && (
                      <td>
                        <button
                          className="iact del"
                          title="Hapus baris"
                          onClick={() => {
                            setLines((ls) => ls.filter((x) => x.key !== l.key));
                            touch("_lines");
                          }}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            {posted && (
              <tfoot>
                <tr className="totrow">
                  <td colSpan={5} style={{ textAlign: "right" }}>
                    Nilai yang berpindah
                  </td>
                  <td className="num">
                    <span className="mny">{formatMoney(handover?.cost ?? 0, "IDR")}</span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );

  // ============================================================ page
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <Link href="/production/handover">Hand-over (BSTB)</Link>
          <span>/</span>
          <span className="cur">{handover ? handover.handoverNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="truck" size={16} />
            </span>
            {handover ? (
              <>
                <span className="docno">{handover.handoverNo}</span>
                <span className={`bdg ${HANDOVER_STATUS_BADGE[status]}`}>{HANDOVER_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Hand-over Baru"
            )}
            {mode === "edit" && <span className="bdg t-warn">Mode Ubah</span>}
          </h1>
          <div className="ph-act">
            {editing ? (
              <>
                {dirty && (
                  <span className="ph-dirty">
                    <span className="pulse" /> Belum disimpan
                  </span>
                )}
                <CancelButton href={backHref} dirty={dirty} disabled={saving} />
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </>
            ) : (
              <HandoverActions id={handover!.id} subject={handover!.handoverNo} status={status} handoverDate={handover!.header.handover_date} can={can} />
            )}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>
          {headerCard}
          {linesCard}
        </div>
      </div>
    </>
  );
}
