"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { Dialog } from "@/components/ui/dialog";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { StockIssueActions } from "@/components/inventory/stock-issue-actions";
import { idc } from "@/components/production/execution-parts";
import { PROCESS_TEXT } from "@/components/production/unit-cards";
import type { BoardRow } from "@/lib/erp/production-workspace";
import type { StockIssueAbilities } from "@/lib/erp/stock-issue-workflow";
import { formatDate, formatNumber } from "@/lib/format";

/**
 * One Unit's work (`Workspace-Unit-Diff.md` A2, P263). Five tabs by where the
 * goods are; goods with a No. Job are one row per Job and always move whole,
 * goods without one are a row per No. Stok (W111). The actions sit in the page
 * header and follow the tab and the rows chosen. A No. Job or No. Stok typed in
 * the search and confirmed with Enter opens its work, so a scanner works too (D1).
 */

export type BoardIncoming = { id: number; issueNo: string; issueDate: string; warehouseLabel: string; auxiliary: boolean; lines: { lotNo: string; qty: number; uomLabel: string }[] };
export type BoardUnit = {
  label: string;
  name: string;
  process: "PassThrough" | "Grading" | "Assembly";
  hasQc: boolean;
  workstation: string | null;
  pre: boolean;
  checkpoint: boolean;
  releasesJob: boolean;
  /** After the checkpoint a Job may hold several partai (W103). */
  afterCheckpoint: boolean;
  lines: { id: number; name: string }[];
};

type Tab = "masuk" | "persiapan" | "qc" | "standby" | "transit";
/** `grams` is null when none of its goods has a gram to read. */
type Group = { key: string; job: { id: number; no: string } | null; rows: BoardRow[]; grams: number | null; value: number };

const STAGE: Record<"persiapan" | "qc" | "standby", BoardRow["stage"]> = { persiapan: "Preparation", qc: "QcCheck", standby: "StandBy" };
const TAB_OF: Record<BoardRow["stage"], Tab> = { Preparation: "persiapan", QcCheck: "qc", StandBy: "standby" };
const gram = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

function groupsOf(rows: BoardRow[]): Group[] {
  const out = new Map<string, Group>();
  for (const r of rows) {
    const key = r.jobId ? `j${r.jobId}` : `b${r.id}`;
    const g: Group = out.get(key) ?? { key, job: r.jobId ? { id: r.jobId, no: r.jobNo ?? "" } : null, rows: [], grams: null, value: 0 };
    g.rows.push(r);
    if (r.grams != null) g.grams = (g.grams ?? 0) + r.grams;
    g.value += r.value;
    out.set(key, g);
  }
  return [...out.values()];
}

const oldest = (rows: BoardRow[]) => rows.map((r) => r.since).filter(Boolean).sort()[0] ?? null;

function PartaiCell({ rows }: { rows: BoardRow[] }) {
  const partais = [...new Map(rows.filter((r) => r.partaiNo).map((r) => [r.partaiId, r])).values()];
  if (!partais.length) return <span className="dash">Sebelum partai</span>;
  return (
    <>
      {partais.map((r) => (
        <div key={r.partaiId}>
          <span className="mono" style={{ fontSize: 11.5 }}>
            {r.partaiNo}
          </span>{" "}
          {r.lineName && <span className="bdg t-acc">{r.lineName}</span>}
        </div>
      ))}
    </>
  );
}

function Notes({ rows }: { rows: BoardRow[] }) {
  const notes = [...new Set(rows.flatMap((r) => r.notes))];
  const parts = [
    rows.some((r) => r.balikQc) && <span key="b" className="bdg t-bad">Balik QC</span>,
    rows.some((r) => r.inDraft) && <span key="d" className="bdg t-slate">Ada di Draft</span>,
    ...notes.map((n) => <span key={n}>{n}</span>),
  ].filter(Boolean);
  return parts.length ? <>{parts.reduce<React.ReactNode[]>((a, p, i) => (i ? [...a, " ", p] : [p]), [])}</> : <span className="dash">—</span>;
}

function Next({ row }: { row: BoardRow }) {
  return row.next ? (
    <>
      <span className="lab">{row.next.label}</span> <span className="uw-hint">{row.next.exit === "Push" ? "Push" : "BSTB"}</span>
    </>
  ) : (
    <span className="dash">—</span>
  );
}

export function UnitBoard({
  unit,
  rows,
  incoming,
  can,
  issueCan,
  initialTab,
}: {
  unit: BoardUnit;
  rows: BoardRow[];
  incoming: BoardIncoming[];
  can: { grading: boolean; work: boolean; qc: boolean };
  issueCan: StockIssueAbilities;
  initialTab: Tab;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [lineFilter, setLineFilter] = useState("");
  const [partaiFilter, setPartaiFilter] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [inside, setInside] = useState<Group | null>(null);

  const all = groupsOf(rows);
  const byStage = (s: BoardRow["stage"]) => all.filter((g) => g.rows[0].stage === s);
  const stageTab = tab === "persiapan" || tab === "qc" || tab === "standby" ? tab : null;
  const here = stageTab ? byStage(STAGE[stageTab]) : [];
  const onePartai = !unit.afterCheckpoint;

  const q = query.trim().toLowerCase();
  const hit = (g: Group) => !q || g.rows.some((r) => `${r.lotNo} ${r.jobNo ?? ""} ${r.itemLabel} ${r.itemName}`.toLowerCase().includes(q));
  const filtered = here.filter((g) => hit(g) && (!lineFilter || g.rows.some((r) => String(r.lineId) === lineFilter)) && (!partaiFilter || g.rows.some((r) => String(r.partaiId) === partaiFilter)));
  const jobs = filtered.filter((g) => g.job);
  const loose = filtered.filter((g) => !g.job);
  const resetOn = `${tab}|${q}|${lineFilter}|${partaiFilter}`;
  const jobPage = usePaging(jobs, resetOn);
  const loosePage = usePaging(loose, resetOn);
  const onPage = [...jobPage.pageRows, ...loosePage.pageRows];

  const picked = here.filter((g) => chosen.has(g.key));
  const pickedRows = picked.flatMap((g) => g.rows);
  const pickedPartais = new Set(pickedRows.map((r) => r.partaiId));
  const mixed = onePartai && pickedPartais.size > 1;
  const partaiOptions = [...new Map(here.flatMap((g) => g.rows).filter((r) => r.partaiNo).map((r) => [r.partaiId, r.partaiNo!])).entries()];

  const goTab = (t: Tab) => {
    setTab(t);
    setChosen(new Set());
  };
  const toggle = (g: Group) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(g.key)) n.delete(g.key);
      else n.add(g.key);
      return n;
    });

  /** A Grading Unit grades a Job whole: its row opens that grading (W97). */
  function openGrading(g: Group) {
    if (!can.grading) return toast("Tidak diizinkan", "Anda tidak boleh membuat No. Grading.", "err");
    router.push(`/production/grading/new?bucket=${g.rows[0].id}`);
  }

  function onRow(g: Group) {
    if (tab === "persiapan" && unit.process === "Grading") return openGrading(g);
    toggle(g);
  }

  /** Enter on an exact No. Job or No. Stok opens its work, wherever it waits (D1). */
  function onEnter() {
    const code = query.trim().toUpperCase();
    if (!code) return;
    const g = all.find((x) => x.job?.no.toUpperCase() === code || x.rows.some((r) => r.lotNo.toUpperCase() === code));
    if (g) {
      const t = TAB_OF[g.rows[0].stage];
      if (t === "persiapan" && unit.process === "Grading") return openGrading(g);
      setTab(t);
      setChosen(new Set([g.key]));
      setQuery("");
      return;
    }
    if (incoming.some((d) => d.issueNo.toUpperCase() === code || d.lines.some((l) => l.lotNo.toUpperCase() === code))) {
      setQuery("");
      return goTab("masuk");
    }
    toast("Tidak ditemukan", `${query.trim()} tidak ada di ${unit.label}.`, "err");
  }

  const tabs: [Tab, string, number][] = [
    ["masuk", "Masuk", incoming.length],
    ["persiapan", "Persiapan", byStage("Preparation").length],
    ...(unit.hasQc ? ([["qc", "QC Check", byStage("QcCheck").length]] as [Tab, string, number][]) : []),
    ["standby", "Stand By", byStage("StandBy").length],
    ["transit", "Dalam Perjalanan", 0],
  ];

  const actions = (() => {
    const out: React.ReactNode[] = [];
    if (tab === "persiapan" && unit.process === "PassThrough" && can.work) {
      out.push(
        <button key="work" className="btn primary" disabled={!picked.length || mixed} onClick={() => router.push(`/production/work/new?bucket=${pickedRows.map((r) => r.id).join(",")}`)}>
          <Icon name="check" size={14} /> Catat Pengerjaan{picked.length > 1 ? ` (${picked.length} Job)` : ""}
        </button>
      );
    }
    if (tab === "qc" && can.qc) {
      out.push(
        <button key="qc" className="btn primary" disabled={!picked.length || mixed} onClick={() => router.push(`/production/qc-check/new?bucket=${pickedRows[0].id}`)}>
          <Icon name="check" size={14} /> Periksa{picked.length > 1 ? ` (${picked.length})` : ""}
        </button>
      );
    }
    return out;
  })();

  const hint =
    tab === "persiapan"
      ? unit.process === "Grading"
        ? "Klik baris untuk langsung menggrading Job itu."
        : unit.process === "PassThrough"
          ? mixed
            ? "Satu dokumen untuk satu partai."
            : "Pilih No. Job yang dikerjakan, dari satu partai."
          : "Assembly dibangun bersama Packing."
      : tab === "qc"
        ? mixed
          ? "Satu QC Check untuk satu partai."
          : "Centang Job yang diperiksa, lalu Periksa."
        : tab === "standby"
          ? "Tujuan mengikuti routing line tiap partai."
          : "";

  const sub = [
    unit.workstation,
    unit.pre ? "Sebelum partai, semua line" : unit.lines.length ? `Line ${unit.lines.map((l) => l.name).join(", ")}` : null,
    unit.hasQc ? "Ada QC Check" : "Tanpa QC Check",
    unit.checkpoint ? "Checkpoint: seluruh isi partai" : null,
    unit.releasesJob ? "Lepas No. Job" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const check = (g: Group) => (
    <td
      className="selchk"
      onClick={(e) => {
        e.stopPropagation();
        toggle(g);
      }}
    >
      <input type="checkbox" checked={chosen.has(g.key)} readOnly tabIndex={-1} aria-label={`Pilih ${g.job?.no ?? g.rows[0].lotNo}`} />
    </td>
  );
  const sejak = (g: Group) => <td>{oldest(g.rows) ? formatDate(oldest(g.rows)) : <span className="dash">—</span>}</td>;
  const allOn = onPage.length > 0 && onPage.every((g) => chosen.has(g.key));

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Pengerjaan</span>
          <span>/</span>
          <Link href="/production/workspace">Workspace Unit</Link>
          <span>/</span>
          <span className="cur">{unit.label}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={unit.process === "Grading" ? "layers" : unit.process === "Assembly" ? "box" : "check"} size={16} />
            </span>
            {unit.name} <span className="bdg t-info">{PROCESS_TEXT[unit.process]}</span>
          </h1>
          <div className="ph-act">
            {picked.length > 0 && (
              <span className="selcount">
                {picked.length} dipilih · {gram(pickedRows.reduce((a, r) => a + (r.grams ?? 0), 0))} g
                <button type="button" aria-label="Hapus pilihan" onClick={() => setChosen(new Set())}>
                  <Icon name="block" size={13} />
                </button>
              </span>
            )}
            {actions}
          </div>
        </div>
        <p className="ph-sub">{sub}</p>
      </div>

      <div className="card">
        <div className="qtabs" role="tablist">
          {tabs.map(([t, name, n]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "act" : ""} onClick={() => goTab(t)}>
              {name}
              <span className="n">{n}</span>
            </button>
          ))}
        </div>

        {stageTab && (
          <>
            <div className="toolbar">
              <form
                style={{ display: "contents" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  onEnter();
                }}
              >
                <SearchField value={query} onChange={setQuery} placeholder="Cari No. Job, No. Stok, atau Item…" />
              </form>
              {unit.lines.length > 1 && (
                <div style={{ width: 170 }}>
                  <Select variant="toolbar" value={lineFilter} onChange={setLineFilter} set={Boolean(lineFilter)} options={[{ value: "", label: "Line: semua" }, ...unit.lines.map((l) => ({ value: String(l.id), label: `Line: ${l.name}` }))]} />
                </div>
              )}
              {partaiOptions.length > 1 && (
                <div style={{ width: 220 }}>
                  <Select variant="toolbar" value={partaiFilter} onChange={setPartaiFilter} set={Boolean(partaiFilter)} options={[{ value: "", label: "Partai: semua" }, ...partaiOptions.map(([id, no]) => ({ value: String(id), label: no }))]} />
                </div>
              )}
              {onPage.length > 0 && !(tab === "persiapan" && unit.process === "Grading") && (
                <label className="uw-hint" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={allOn} onChange={() => setChosen((s) => (allOn ? new Set([...s].filter((k) => !onPage.some((g) => g.key === k))) : new Set([...s, ...onPage.map((g) => g.key)])))} /> Pilih semua di halaman
                </label>
              )}
              <span className={`uw-hint${mixed ? " bad" : ""}`}>{hint}</span>
              <span className="tspace" />
              <span className="count">
                <b>{jobs.length}</b> Job · <b>{loose.length}</b> No. Stok tanpa Job · <b>{gram(filtered.reduce((a, g) => a + (g.grams ?? 0), 0))}</b> g
              </span>
            </div>

            {!filtered.length ? (
              <div className="empty">
                <div className="ic">
                  <Icon name={tab === "qc" ? "check" : tab === "standby" ? "send" : "clip"} size={18} />
                </div>
                <h4>{tab === "persiapan" ? "Persiapan kosong" : tab === "qc" ? "Tidak ada barang menunggu QC" : "Stand By kosong"}</h4>
                <p>{tab === "persiapan" ? "Barang yang diterima muncul di sini." : tab === "qc" ? "Hasil pekerjaan Unit ini masuk ke sini." : unit.hasQc ? "Barang yang lulus QC muncul di sini." : "Barang selesai dikerjakan muncul di sini."}</p>
              </div>
            ) : (
              <>
                {jobs.length > 0 && (
                  <>
                    <div className="uw-sec">
                      Job <span>{jobs.length} Job · isi tiap Job dibuka dari kolom No. Stok</span>
                    </div>
                    <div className="tw">
                      <table className="grid" style={{ minWidth: tab === "standby" ? 1000 : 880 }}>
                        <thead>
                          <tr>
                            <th className="selchk" />
                            <th style={{ width: 200 }}>No. Job</th>
                            <th style={{ width: 230 }}>Partai</th>
                            <th style={{ width: 130 }}>No. Stok</th>
                            <th className="num" style={{ width: 96 }}>Gram</th>
                            <th className="num" style={{ width: 130 }}>Nilai</th>
                            {tab === "standby" && <th style={{ width: 130 }}>Tujuan</th>}
                            <th style={{ width: 96 }}>Sejak</th>
                            <th>Keterangan</th>
                          </tr>
                        </thead>
                        <tbody>
                          {jobPage.pageRows.map((g) => (
                            <tr key={g.key} className={chosen.has(g.key) ? "sel" : ""} onClick={() => onRow(g)}>
                              {check(g)}
                              <td>
                                <span className="mono">{g.job!.no}</span>
                              </td>
                              <td>
                                <PartaiCell rows={g.rows} />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn sm ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInside(g);
                                  }}
                                >
                                  {g.rows.length} · lihat isi
                                </button>
                              </td>
                              <td className="num">{g.grams != null ? gram(g.grams) : <span className="dash">—</span>}</td>
                              <td className="num">
                                <Amount value={g.value} />
                              </td>
                              {tab === "standby" && (
                                <td>
                                  <Next row={g.rows[0]} />
                                </td>
                              )}
                              {sejak(g)}
                              <td className="uw-note">
                                <Notes rows={g.rows} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pager page={jobPage.page} pages={jobPage.pages} total={jobPage.total} perPage={jobPage.perPage} onPage={jobPage.setPage} onPerPage={jobPage.setPerPage} />
                  </>
                )}
                {loose.length > 0 && (
                  <>
                    <div className="uw-sec">
                      No. Stok tanpa Job <span>{loose.length} No. Stok · dipilih satu per satu</span>
                    </div>
                    <div className="tw">
                      <table className="grid" style={{ minWidth: tab === "standby" ? 1000 : 880 }}>
                        <thead>
                          <tr>
                            <th className="selchk" />
                            <th style={{ width: 160 }}>No. Stok</th>
                            <th style={{ width: 250 }}>Item</th>
                            <th style={{ width: 220 }}>Partai</th>
                            <th className="num" style={{ width: 96 }}>Gram</th>
                            <th className="num" style={{ width: 130 }}>Nilai</th>
                            {tab === "standby" && <th style={{ width: 130 }}>Tujuan</th>}
                            <th style={{ width: 96 }}>Sejak</th>
                            <th>Keterangan</th>
                          </tr>
                        </thead>
                        <tbody>
                          {loosePage.pageRows.map((g) => {
                            const r = g.rows[0];
                            return (
                              <tr key={g.key} className={chosen.has(g.key) ? "sel" : ""} onClick={() => onRow(g)}>
                                {check(g)}
                                <td className="mono">{r.lotNo}</td>
                                <td>
                                  {idc(r.itemLabel, r.itemName)}
                                  {r.isBjl && <span className="bdg s-mute">BJL</span>}
                                </td>
                                <td>
                                  <PartaiCell rows={g.rows} />
                                </td>
                                <td className="num">{r.grams != null ? gram(r.grams) : <span className="dash">—</span>}</td>
                                <td className="num">
                                  <Amount value={r.value} />
                                </td>
                                {tab === "standby" && (
                                  <td>
                                    <Next row={r} />
                                  </td>
                                )}
                                {sejak(g)}
                                <td className="uw-note">
                                  <Notes rows={g.rows} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <Pager page={loosePage.page} pages={loosePage.pages} total={loosePage.total} perPage={loosePage.perPage} onPage={loosePage.setPage} onPerPage={loosePage.setPerPage} />
                  </>
                )}
              </>
            )}
          </>
        )}

        {tab === "masuk" &&
          (incoming.length ? (
            <div className="tw">
              <table className="grid" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={{ width: 230 }}>Nomor</th>
                    <th>Jenis</th>
                    <th style={{ width: 120 }}>Dari</th>
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th className="num" style={{ width: 70 }}>Baris</th>
                    <th className="num" style={{ width: 96 }}>Gram</th>
                    <th style={{ width: 110 }} />
                  </tr>
                </thead>
                <tbody>
                  {incoming.map((d) => (
                    <tr key={d.id} onClick={() => router.push(`/inventory/stock-issue/${d.id}`)}>
                      <td>
                        <span className="lab">{d.issueNo}</span>
                      </td>
                      <td>BSTB Issue · {d.auxiliary ? "Bahan Penolong" : "Bahan ke Produksi"}</td>
                      <td>{d.warehouseLabel}</td>
                      <td>{formatDate(d.issueDate)}</td>
                      <td className="num">{d.lines.length}</td>
                      <td className="num">{gram(d.lines.reduce((a, l) => a + (l.uomLabel === "GR" ? l.qty : 0), 0))}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <StockIssueActions id={d.id} subject={d.issueNo} status="Submitted" can={issueCan} />
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
              <p>{unit.pre ? "Kiriman baru muncul di sini setelah pengirim menekan Ajukan." : "Barang dari Unit sebelumnya dalam Workstation yang sama masuk lewat Dokumen Push, langsung ke Persiapan tanpa Terima."}</p>
            </div>
          ))}

        {tab === "transit" && (
          <div className="empty">
            <div className="ic">
              <Icon name="truck" size={18} />
            </div>
            <h4>Tidak ada barang dalam perjalanan</h4>
            <p>BSTB yang sudah diajukan dan belum diterima muncul di sini, bukan di Stand By. Dokumen Push tidak pernah ada di sini karena barangnya langsung pindah.</p>
          </div>
        )}
      </div>

      <Dialog
        open={inside !== null}
        icon="layers"
        title={inside?.job ? `Isi ${inside.job.no}` : "Isi Job"}
        subtitle={inside ? `${inside.rows.length} No. Stok${inside.grams != null ? ` · ${gram(inside.grams)} g` : ""}` : undefined}
        width={640}
        onClose={() => setInside(null)}
      >
        {inside && (
          <div className="tw boxed">
            <table className="grid" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ width: 160 }}>No. Stok</th>
                  <th>Item</th>
                  <th className="num" style={{ width: 96 }}>Gram</th>
                  <th className="num" style={{ width: 130 }}>Nilai</th>
                </tr>
              </thead>
              <tbody>
                {inside.rows.map((r) => (
                  <tr key={r.id} style={{ cursor: "default" }}>
                    <td className="mono">{r.lotNo}</td>
                    <td>
                      {idc(r.itemLabel, r.itemName)}
                      {r.isBjl && <span className="bdg s-mute">BJL</span>}
                    </td>
                    <td className="num">{r.grams != null ? gram(r.grams) : <span className="dash">—</span>}</td>
                    <td className="num">
                      <Amount value={r.value} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Dialog>
    </>
  );
}
