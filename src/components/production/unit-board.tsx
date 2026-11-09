"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { useToast } from "@/components/ui/toast";
import { idc } from "@/components/production/execution-parts";
import { formatDate, formatNumber } from "@/lib/format";

/**
 * One Unit's work (`Production-Unit-Workspace-Plan.md`): four queues by stage and a
 * scan field. A scan — or a click on the row — does the same thing: it opens the
 * one form that row's work needs, so a form is one action: one grading, one
 * Pengerjaan, one QC Check. The scale is not part of this: grams are typed.
 */

export type BoardRow = {
  id: number;
  lotNo: string;
  itemLabel: string;
  itemName: string;
  uomLabel: string;
  stage: "Preparation" | "QcCheck" | "StandBy";
  partaiId: number | null;
  partaiNo: string | null;
  jobId: number | null;
  jobNo: string | null;
  grams: number | null;
  isBjl: boolean;
  qcCheckId: number | null;
};

export type BoardIncoming = { id: number; issueNo: string; issueDate: string; warehouseLabel: string; lines: { lotNo: string; qty: number; uomLabel: string }[] };

type Tab = "masuk" | "persiapan" | "qc" | "standby";
const TAB_OF = { Preparation: "persiapan", QcCheck: "qc", StandBy: "standby" } as const;
const gram = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const sumG = (rows: BoardRow[]) => rows.reduce((a, r) => a + (r.grams ?? 0), 0);
const partais = (rows: BoardRow[]) => new Set(rows.flatMap((r) => (r.partaiId ? [r.partaiId] : []))).size;

export function UnitBoard({
  unit,
  rows,
  incoming,
  can,
  initialTab,
}: {
  unit: { label: string; name: string; process: "PassThrough" | "Grading" | "Assembly"; hasQc: boolean };
  rows: BoardRow[];
  incoming: BoardIncoming[];
  can: { grading: boolean; work: boolean; qc: boolean };
  initialTab: Tab;
}) {
  const router = useRouter();
  const toast = useToast();
  const scanRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<number | null>(null);

  useEffect(() => scanRef.current?.focus(), [tab]);

  const by = (stage: BoardRow["stage"]) => rows.filter((r) => r.stage === stage);
  const prep = by("Preparation");
  const qc = by("QcCheck");
  const standBy = by("StandBy");
  const inGrams = incoming.reduce((a, d) => a + d.lines.reduce((s, l) => s + (l.uomLabel === "GR" ? l.qty : 0), 0), 0);

  const tabs: [Tab, string, number][] = [
    ["masuk", "Masuk", incoming.length],
    ["persiapan", "Persiapan", prep.length],
    ...(unit.hasQc ? ([["qc", "QC Check", qc.length]] as [Tab, string, number][]) : []),
    ["standby", "Stand By", standBy.length],
  ];

  const q = query.trim().toLowerCase();
  const shown = (tab === "persiapan" ? prep : tab === "qc" ? qc : standBy).filter((r) => !q || `${r.lotNo} ${r.jobNo ?? ""} ${r.itemLabel} ${r.itemName}`.toLowerCase().includes(q));
  const paging = usePaging(shown, `${tab}|${q}`);
  const chosen = prep.filter((r) => selected.includes(r.id));
  const multiPartai = new Set(chosen.map((r) => r.partaiId)).size > 1;
  const pickable = unit.process === "PassThrough" && tab === "persiapan";

  /** What this row's work is: one form, opened with the row already in it. */
  function open(row: BoardRow) {
    if (row.stage === "Preparation") {
      if (unit.process === "Grading") return can.grading ? router.push(`/production/grading/new?bucket=${row.id}`) : toast("Tidak diizinkan", "Anda tidak boleh membuat Dokumen Grading.", "err");
      if (unit.process === "Assembly") return toast("Belum ada dokumen", "Assembly Kotak belum dibangun.", "err");
      const group = row.jobId ? prep.filter((r) => r.jobId === row.jobId) : [row];
      const on = group.every((r) => selected.includes(r.id));
      setSelected((s) => (on ? s.filter((id) => !group.some((r) => r.id === id)) : [...new Set([...s, ...group.map((r) => r.id)])]));
      return;
    }
    if (row.stage === "QcCheck") return can.qc ? router.push(`/production/qc-check/new?bucket=${row.id}`) : toast("Tidak diizinkan", "Anda tidak boleh membuat QC Check.", "err");
    setFlash(row.id);
    toast("Siap dikirim", `${row.lotNo} menunggu di Stand By; Dokumen Push dan BSTB Transfer belum dibangun.`, "ok");
  }

  /** A scanner types the label and presses Enter. */
  function scan(raw: string) {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    const row = rows.find((r) => r.lotNo.toUpperCase() === code || r.jobNo?.toUpperCase() === code);
    if (row) {
      setTab(TAB_OF[row.stage]);
      setFlash(row.id);
      return open(row);
    }
    const doc = incoming.find((d) => d.issueNo.toUpperCase() === code || d.lines.some((l) => l.lotNo.toUpperCase() === code));
    if (doc) return router.push(`/inventory/stock-issue/${doc.id}`);
    toast("Tidak ditemukan", `${raw.trim()} tidak ada di ${unit.label}.`, "err");
  }

  const kpi = (icon: "truck" | "clip" | "check" | "send", tone: string, label: string, value: string, d: string, to: Tab) => (
    <button type="button" className="kpi" style={{ textAlign: "left" }} onClick={() => setTab(to)}>
      <div className="h">
        <span className={`i ${tone}`}>
          <Icon name={icon} size={14} />
        </span>
        <span className="l">{label}</span>
      </div>
      <div className="v">{value}</div>
      <div className="d">{d}</div>
    </button>
  );

  const hint =
    tab === "persiapan"
      ? unit.process === "Grading"
        ? "Scan No. Stok atau klik barisnya: satu No. Stok, satu Dokumen Grading."
        : unit.process === "PassThrough"
          ? multiPartai
            ? "Satu dokumen untuk satu partai."
            : "Scan atau centang No. Job yang dikerjakan, dari satu partai."
          : "Assembly Kotak belum dibangun."
      : tab === "qc"
        ? "Scan No. Stok atau klik barisnya: QC Check dibuka untuk partainya."
        : "Dokumen Push dan BSTB Transfer belum dibangun; hasil menunggu di sini.";

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <Link href="/production/workspace">Workspace Unit</Link>
          <span>/</span>
          <span className="cur">{unit.label}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="layers" size={16} />
            </span>
            {unit.name}
            <span className="bdg t-info">{{ PassThrough: "Pass Through", Grading: "Grading", Assembly: "Assembly" }[unit.process]}</span>
          </h1>
          <div className="ph-act">
            {pickable && chosen.length > 0 && (
              <span className="selcount">
                {chosen.length} dipilih · {gram(sumG(chosen))} g
                <button aria-label="Hapus pilihan" onClick={() => setSelected([])}>
                  <Icon name="block" size={13} />
                </button>
              </span>
            )}
            {pickable && can.work && (
              <button className="btn primary" disabled={!chosen.length || multiPartai} onClick={() => router.push(`/production/work/new?bucket=${chosen.map((r) => r.id).join(",")}`)}>
                <Icon name="check" size={14} /> Catat Pengerjaan{chosen.length > 1 ? ` (${chosen.length})` : ""}
              </button>
            )}
          </div>
        </div>
        <p className="ph-sub">
          {unit.hasQc ? "Ada QC Check" : "Tanpa QC Check"} · scan label No. Stok atau No. Job untuk membuka form pekerjaannya.
        </p>
      </div>

      <div className="kpis bud">
        {kpi("truck", "t-warn", "Kiriman Masuk", `${gram(inGrams)} g`, incoming.length ? `${incoming.length} dokumen menunggu Terima` : "Tidak ada yang menunggu", "masuk")}
        {kpi("clip", "t-info", "Persiapan", `${gram(sumG(prep))} g`, prep.length ? `${prep.length} baris · ${partais(prep)} partai` : "Kosong", "persiapan")}
        {unit.hasQc && kpi("check", "t-acc", "QC Check", `${gram(sumG(qc))} g`, qc.length ? `${qc.length} baris menunggu keputusan` : "Tidak ada yang menunggu", "qc")}
        {kpi("send", "t-ok", "Stand By", `${gram(sumG(standBy))} g`, standBy.length ? `${standBy.length} baris` : "Kosong", "standby")}
      </div>

      <div className="card">
        <div className="qtabs" role="tablist">
          {tabs.map(([k, label, n]) => (
            <button key={k} role="tab" aria-selected={k === tab} className={k === tab ? "act" : ""} onClick={() => setTab(k)}>
              {label}
              <span className="n">{n}</span>
            </button>
          ))}
        </div>

        <div className="scanbar">
          <label htmlFor="scan">
            <Icon name="srch" size={14} /> Scan
          </label>
          <input
            id="scan"
            className="inp idf"
            ref={scanRef}
            autoComplete="off"
            placeholder="Scan label No. Stok, No. Job atau nomor BSTB, lalu Enter…"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              scan(e.currentTarget.value);
              e.currentTarget.value = "";
            }}
          />
        </div>

        {tab === "masuk" ? (
          incoming.length ? (
            <div className="tw">
              <table className="grid" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ width: 250 }}>Nomor</th>
                    <th style={{ width: 120 }}>Gudang</th>
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th className="num" style={{ width: 70 }}>
                      Baris
                    </th>
                    <th>No. Stok</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {incoming.map((d) => (
                    <tr key={d.id} className="clk" onClick={() => router.push(`/inventory/stock-issue/${d.id}`)}>
                      <td>
                        <span className="lab">{d.issueNo}</span>
                      </td>
                      <td className="mono">{d.warehouseLabel}</td>
                      <td>{formatDate(d.issueDate)}</td>
                      <td className="num">{d.lines.length}</td>
                      <td className="uw-note">{d.lines.map((l) => l.lotNo).join(", ")}</td>
                      <td>
                        <Link className="btn sm primary" href={`/inventory/stock-issue/${d.id}`} onClick={(e) => e.stopPropagation()}>
                          Terima
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <div className="ic">
                <Icon name="truck" size={18} />
              </div>
              <h4>Tidak ada kiriman yang menunggu</h4>
              <p>Kiriman muncul di sini setelah pengirim menekan Ajukan.</p>
            </div>
          )
        ) : (
          <>
            <div className="toolbar">
              <SearchField value={query} onChange={setQuery} placeholder="Cari No. Stok, No. Job atau Item…" />
              <span className={`uw-hint ${tab === "persiapan" && multiPartai ? "bad" : ""}`}>{hint}</span>
              <span className="tspace" />
              <span className="count">
                <b>{shown.length}</b> baris · <b>{gram(sumG(shown))}</b> g
              </span>
            </div>
            {shown.length ? (
              <div className="tw">
                <table className="grid" style={{ minWidth: 980 }}>
                  <thead>
                    <tr>
                      {pickable && <th className="selchk" />}
                      <th style={{ width: 170 }}>No. Stok</th>
                      <th style={{ width: 260 }}>Item</th>
                      <th style={{ width: 170 }}>Partai</th>
                      <th style={{ width: 170 }}>No. Job</th>
                      <th className="num" style={{ width: 110 }}>
                        Gram
                      </th>
                      <th>Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paging.pageRows.map((r) => (
                      <tr key={r.id} className={`clk${selected.includes(r.id) ? " sel" : ""}${flash === r.id ? " flash" : ""}`} onClick={() => open(r)}>
                        {pickable && (
                          <td className="selchk">
                            <input type="checkbox" aria-label={`Pilih ${r.lotNo}`} checked={selected.includes(r.id)} readOnly tabIndex={-1} />
                          </td>
                        )}
                        <td className="mono" style={{ fontWeight: 600 }}>
                          {r.lotNo}
                        </td>
                        <td>
                          {idc(r.itemLabel, r.itemName)}
                          {r.isBjl && <span className="bdg s-mute">BJL</span>}
                        </td>
                        <td className="mono">{r.partaiNo ?? <span className="dash">Sebelum partai</span>}</td>
                        <td className="mono">{r.jobNo ?? <span className="dash">—</span>}</td>
                        <td className="num">
                          <span className="mny">{r.grams == null ? "—" : gram(r.grams)}</span>
                        </td>
                        <td className="uw-note">{r.qcCheckId ? <span className="bdg t-bad">Balik QC</span> : <span className="dash">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <h4>{tab === "persiapan" ? "Persiapan kosong" : tab === "qc" ? "Tidak ada barang menunggu QC" : "Stand By kosong"}</h4>
                <p>{query ? "Tidak ada baris yang cocok dengan pencarian." : "Barang muncul di sini setelah diterima atau dikerjakan."}</p>
              </div>
            )}
            <Pager page={paging.page} pages={paging.pages} total={paging.total} perPage={paging.perPage} onPage={paging.setPage} onPerPage={paging.setPerPage} />
          </>
        )}
      </div>
    </>
  );
}
