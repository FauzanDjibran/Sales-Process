"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ErrorBox, qtyText, ro } from "@/components/production/execution-parts";
import { closeBoxAction } from "@/app/actions/production-box";
import { boxRuleErrors, recommend } from "@/lib/erp/production-box-shape";
import type { BoxOptions } from "@/lib/erp/production-box";
import { todayIso } from "@/lib/format";

/**
 * Kotak at Packing 95 (P284; W112–W116). Pick a Nama Jual; the system
 * recommends the pieces from everything in Persiapan that bring the kotak
 * nearest its target. Scan a No. Stok (Enter) to put it in, or press Masukkan /
 * Masukkan Semua — a piece put in without a scan is marked Manual (P249, W116).
 * Each piece gets a unique CAIQ; Tutup Kotak once gram, count and CAIQ are
 * complete, and the next kotak starts at once. No prices (P275).
 */

type InBox = { id: number; caiq: string; manual: boolean };

export function BoxForm({ options }: { options: BoxOptions }) {
  const toast = useToast();
  const [bomId, setBomId] = useState<number | null>(options.boms.length === 1 ? options.boms[0].id : null);
  const [partai, setPartai] = useState("");
  const [inBox, setInBox] = useState<InBox[]>([]);
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const [scan, setScan] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const bom = options.boms.find((b) => b.id === bomId) ?? null;
  const byId = new Map(options.pieces.map((p) => [p.id, p]));
  const taken = new Set(inBox.map((x) => x.id));
  const free = options.pieces.filter((p) => !taken.has(p.id) && !closed.has(p.id) && (!partai || String(p.partaiId) === partai));
  const got = inBox.map((x) => byId.get(x.id)!);
  const grams = got.reduce((a, p) => a + p.grams, 0);
  // The search is a knapsack over every free piece: worked out again only when the kotak or the pool changes.
  const freeKey = free.map((p) => p.id).join(",");
  const boxKey = inBox.map((x) => x.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rec = useMemo(() => (bom ? recommend(bom, got, free) : []), [bom, freeKey, boxKey]);
  const problems = bom ? boxRuleErrors(bom, inBox.map((x) => ({ grams: byId.get(x.id)!.grams, caiq: x.caiq }))) : ["Pilih Nama Jual."];
  const short = bom?.components.filter((c) => (options.aux.find((a) => a.itemId === c.itemId)?.qty ?? 0) < c.qty) ?? [];
  const partais = [...new Map(options.pieces.filter((p) => p.partaiNo).map((p) => [p.partaiId, p.partaiNo!])).entries()];
  const back = `/production/workspace/${encodeURIComponent(options.unit.label)}`;

  const put = (ids: number[], manual: boolean) => setInBox((b) => [...b, ...ids.filter((id) => !b.some((x) => x.id === id)).map((id) => ({ id, caiq: "", manual }))]);

  function onScan() {
    const code = scan.trim().toUpperCase();
    if (!code) return;
    const p = free.find((x) => x.lotNo.toUpperCase() === code);
    setScan("");
    if (!p) return toast("Tidak ditemukan", `${code} tidak ada di Persiapan ${options.unit.label}${partai ? " untuk partai ini" : ""}.`, "err");
    put([p.id], false);
  }

  async function submit() {
    setBusy(true);
    const result = await closeBoxAction({ unit_id: options.unit.id, box_date: todayIso(), bom_id: bomId, pieces: inBox.map((x) => ({ bucket_id: x.id, caiq: x.caiq, manual: x.manual })) });
    setBusy(false);
    setAsking(false);
    if (!result.ok) {
      setErrors(result.errors);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa ditutup", result.errors._form ?? result.errors._pieces ?? Object.values(result.errors)[0] ?? "Periksa kembali isian.", "err");
      return;
    }
    toast("Kotak jadi", `${result.trackingNo} masuk Stand By. Kotak berikutnya siap.`, "ok");
    setClosed((c) => new Set([...c, ...inBox.map((x) => x.id)]));
    setInBox([]);
    setErrors({});
  }

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Dokumen</span>
          <span>/</span>
          <Link href="/production/box">Kotak</Link>
          <span>/</span>
          <span className="cur">Baru</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="box" size={16} />
            </span>
            Kotak di {options.unit.label}
          </h1>
          <div className="ph-act">
            <CancelButton href={back} dirty={inBox.length > 0} />
            <button className="btn primary" disabled={busy || problems.length > 0 || short.length > 0} onClick={() => setAsking(true)}>
              <Icon name="check" size={15} /> Tutup Kotak
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <FormBody>
          <FormSection>
            <FormRow>
              <Field label="Nama Jual" span={5} required error={errors.bom_id}>
                <Combobox
                  value={bomId}
                  options={options.boms.map((b) => ({ id: b.id, label: b.itemLabel, name: `${b.itemName} · ${b.label}`, active: true }))}
                  placeholder="Pilih Nama Jual…"
                  emptyText="Belum ada BoM Packing aktif."
                  onChange={(v) => {
                    setBomId(v);
                    setInBox([]);
                  }}
                />
              </Field>
              <Field label="Partai Sumber" span={4} help="dari Persiapan">
                <Select value={partai} onChange={setPartai} options={[{ value: "", label: "Lintas partai" }, ...partais.map(([id, no]) => ({ value: String(id), label: no }))]} />
              </Field>
              <Field label="BoM" span={3}>
                {bom ? ro(`${qtyText(bom.target)} g ± ${qtyText(bom.tolerance)} g · ${bom.minPieces}–${bom.maxPieces} keping`) : <div className="ro nil">pilih Nama Jual dulu</div>}
              </Field>
              {bom && (
                <Field label="Bahan Penolong per Kotak" span={12}>
                  {bom.components.length
                    ? ro(
                        <>
                          {bom.components.map((c) => (
                            <span key={c.itemId} style={{ marginRight: 12 }}>
                              {c.itemName} × {qtyText(c.qty)} <span className={`uw-hint${short.includes(c) ? " bad" : ""}`}>saldo {qtyText(options.aux.find((a) => a.itemId === c.itemId)?.qty ?? 0)}</span>
                            </span>
                          ))}
                        </>
                      )
                    : <div className="ro nil">tanpa bahan penolong</div>}
                </Field>
              )}
            </FormRow>
          </FormSection>
        </FormBody>
      </div>

      {bom && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <span className="ci">
              <Icon name="box" size={15} />
            </span>
            <div className="ct">
              <h3>Isi Kotak</h3>
              <p>Scan keping yang ditunjuk, atau Masukkan (ditandai Manual), lalu isi CAIQ tiap keping.</p>
            </div>
          </div>
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              onScan();
            }}
          >
            <div style={{ width: 260 }}>
              <input className="inp sm mono" value={scan} placeholder="Scan No. Stok lalu Enter…" aria-label="Scan No. Stok" onChange={(e) => setScan(e.target.value)} />
            </div>
            <span className="uw-hint">
              Rekomendasi: {rec.length ? `${rec.length} keping · ${qtyText(rec.reduce((a, p) => a + p.grams, 0))} g` : "tidak ada yang cocok lagi"}
            </span>
            <span className="tspace" />
            <button type="button" className="btn sm" disabled={!rec.length} onClick={() => put(rec.map((p) => p.id), true)}>
              Masukkan Semua
            </button>
          </form>
          {rec.length > 0 && (
            <div className="tw">
              <table className="grid ltab" style={{ minWidth: 560 }}>
                <thead>
                  <tr>
                    <th>Keping Direkomendasikan</th>
                    <th style={{ width: 220 }}>Partai</th>
                    <th className="num" style={{ width: 90 }}>Gram</th>
                    <th style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {rec.map((p) => {
                    const x = byId.get(p.id)!;
                    return (
                      <tr key={p.id}>
                        <td className="mono">{x.lotNo}</td>
                        <td>{x.partaiNo ? <span className="mono">{x.partaiNo}</span> : <span className="dash">—</span>}</td>
                        <td className="num">{qtyText(x.grams)}</td>
                        <td>
                          <button type="button" className="btn sm ghost" onClick={() => put([p.id], true)}>
                            Masukkan
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <ErrorBox text={errors._pieces} />
          {inBox.length ? (
            <div className="tw" style={{ marginTop: 12 }}>
              <table className="grid ltab" style={{ minWidth: 660 }}>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>No</th>
                    <th style={{ width: 200 }}>No. Stok</th>
                    <th>Partai</th>
                    <th className="num" style={{ width: 90 }}>Gram</th>
                    <th style={{ width: 200 }}>No. CAIQ</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {inBox.map((x, i) => {
                    const p = byId.get(x.id)!;
                    return (
                      <tr key={x.id}>
                        <td className="no">{i + 1}</td>
                        <td>
                          <span className="mono">{p.lotNo}</span> {x.manual && <span className="bdg t-warn">Manual</span>}
                        </td>
                        <td>{p.partaiNo ? <span className="mono">{p.partaiNo}</span> : <span className="dash">—</span>}</td>
                        <td className="num">{qtyText(p.grams)}</td>
                        <td>
                          <input className="inp sm mono" value={x.caiq} placeholder="CAIQ…" aria-label={`CAIQ ${p.lotNo}`} onChange={(e) => setInBox((b) => b.map((y) => (y.id === x.id ? { ...y, caiq: e.target.value } : y)))} />
                        </td>
                        <td>
                          <button type="button" className="iact del" title="Keluarkan keping" onClick={() => setInBox((b) => b.filter((y) => y.id !== x.id))}>
                            <Icon name="trash" size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty sm">
              <h4>Kotak masih kosong</h4>
              <p>{free.length ? "Scan atau Masukkan keping dari rekomendasi." : `Tidak ada keping di Persiapan ${options.unit.label}.`}</p>
            </div>
          )}
          <div className="card-b">
            <span className="uw-hint">
              Terisi <b>{qtyText(grams)} g</b> dari {qtyText(bom.target)} ± {qtyText(bom.tolerance)} g · <b>{inBox.length}</b> keping ({bom.minPieces}–{bom.maxPieces}){problems.length ? ` · ${problems[0]}` : " · siap ditutup"}
            </span>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={asking}
        icon="box"
        tone="brand"
        title="Tutup kotak?"
        subject={bom ? `${bom.itemLabel} · ${inBox.length} keping · ${qtyText(grams)} g` : undefined}
        body="Keping dan CAIQ-nya tercatat sebagai isi kotak, bahan penolong dipakai, dan No. Stok kotak lahir di Stand By. Kotak berikutnya langsung dimulai."
        confirmLabel="Ya, Tutup Kotak"
        busy={busy}
        onConfirm={submit}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
