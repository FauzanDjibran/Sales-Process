"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/ui/dialog";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { closeKerjaAction } from "@/app/actions/production-kerja";
import { todayIso } from "@/lib/format";
import { TransferReceiveButton } from "@/components/production/transfer-receive-button";
import { TRANSFER_KIND_TEXT } from "@/lib/erp/production-transfer-shape";
import type { IncomingTransfer } from "@/lib/erp/production-transfer";
import { StockIssueActions } from "@/components/inventory/stock-issue-actions";
import { idc } from "@/components/production/execution-parts";
import { PROCESS_TEXT } from "@/components/production/unit-cards";
import type { BoardRow } from "@/lib/erp/production-workspace";
import type { StockIssueAbilities } from "@/lib/erp/stock-issue-workflow";
import { formatDate, formatNumber } from "@/lib/format";

/**
 * One Unit's work (`Workspace-Unit-Plan-r11.md`, P274). Tabs follow the Unit
 * steps — Penerimaan, a Persiapan per step, Stand By, Dalam Perjalanan — and
 * each tab is one table: a row is a Job, or a No. Stok that has none. Only
 * Sedang Dikerjakan has tick boxes, to finish many Jobs at once (P282); elsewhere
 * a row opens its own work (grading, Pengerjaan, QC Check, or a
 * Push / BSTB from Stand By), and a No. Job or No. Stok typed in the search and
 * confirmed with Enter does the same, so a scanner works. No prices anywhere
 * (P275).
 */

export type BoardIncoming = { id: number; issueNo: string; issueDate: string; warehouseLabel: string; auxiliary: boolean; lines: { lotNo: string; qty: number; uomLabel: string }[] };
export type BoardUnit = {
  label: string;
  name: string;
  workstation: string | null;
  pre: boolean;
  checkpoint: boolean;
  /** After the checkpoint a Job may hold several partai (W103). */
  afterCheckpoint: boolean;
  lines: { id: number; name: string }[];
  steps: { id: number; process: BoardProcess }[];
  hasQc: boolean;
};
type BoardProcess = keyof typeof PROCESS_TEXT;

/** `masuk`, `p<step>` (Persiapan), `w<step>` (Sedang Dikerjakan), `qc`, `standby`, `transit`. */
export type BoardTab = string;
/** `grams` is null when none of its goods has a gram to read. */
type Group = { key: string; job: { id: number; no: string } | null; rows: BoardRow[]; grams: number | null };

const gram = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

function groupsOf(rows: BoardRow[]): Group[] {
  const out = new Map<string, Group>();
  for (const r of rows) {
    const key = r.jobId ? `j${r.jobId}` : `b${r.id}`;
    const g: Group = out.get(key) ?? { key, job: r.jobId ? { id: r.jobId, no: r.jobNo ?? "" } : null, rows: [], grams: null };
    g.rows.push(r);
    if (r.grams != null) g.grams = (g.grams ?? 0) + r.grams;
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

const EMPTY: Record<string, [string, string]> = {
  Grading: ["Tidak ada barang untuk digrading", "Barang yang diterima unit ini muncul di sini. Klik barisnya untuk menggrading."],
  JobOrder: ["Tidak ada barang untuk Job Order", "Hasil grading muncul di sini. Klik barisnya untuk membuat Job Order."],
  Assign: ["Tidak ada barang untuk dikerjakan", "Barang yang diterima unit ini muncul di sini. Klik barisnya untuk mencatat pengerjaan."],
  Kerja: ["Tidak ada barang untuk dikerjakan", "Barang yang diterima unit ini muncul di sini."],
  QC: ["Tidak ada barang menunggu QC", "Hasil pekerjaan unit ini masuk ke sini. Klik barisnya untuk memeriksa."],
  Assembly: ["Tidak ada keping untuk dikemas", "Keping dari Barcoding masuk ke sini. Klik barisnya untuk membuat kotak."],
};

export function UnitBoard({
  unit,
  rows,
  incoming,
  transfers,
  canReceive,
  can,
  issueCan,
  initialTab,
}: {
  unit: BoardUnit;
  rows: BoardRow[];
  incoming: BoardIncoming[];
  transfers: IncomingTransfer[];
  canReceive: boolean;
  can: { grading: boolean; work: boolean; qc: boolean; transfer: boolean; kerjaStart: boolean; kerjaFinish: boolean; jobOrder: boolean; box: boolean };
  issueCan: StockIssueAbilities;
  initialTab: BoardTab;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<BoardTab>(initialTab);
  const [query, setQuery] = useState("");
  const [lineFilter, setLineFilter] = useState("");
  const [partaiFilter, setPartaiFilter] = useState("");
  const [inside, setInside] = useState<Group | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [closing, setClosing] = useState<"finish" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);

  const all = groupsOf(rows);
  const stepOf = (id: number) => unit.steps.find((s) => s.id === id);
  const tabRows = (t: BoardTab): Group[] => {
    if (t === "standby") return all.filter((g) => g.rows[0].stage === "StandBy");
    if (t === "transit") return all.filter((g) => g.rows[0].stage === "InTransit");
    if (t === "qc") return all.filter((g) => g.rows[0].stage === "QcCheck");
    const id = Number(t.slice(1));
    const stage = t[0] === "w" ? "Working" : "Preparation";
    return all.filter((g) => g.rows[0].stage === stage && g.rows[0].stepId === id);
  };
  const tabOfGroup = (g: Group): BoardTab => {
    const r = g.rows[0];
    if (r.stage === "StandBy") return "standby";
    if (r.stage === "InTransit") return "transit";
    if (r.stage === "QcCheck") return "qc";
    return `${r.stage === "Working" ? "w" : "p"}${r.stepId}`;
  };
  const here = tab === "masuk" ? [] : tabRows(tab);
  const stepProcess = tab[0] === "p" || tab[0] === "w" ? stepOf(Number(tab.slice(1)))?.process : null;

  const q = query.trim().toLowerCase();
  const hit = (g: Group) => !q || g.rows.some((r) => `${r.lotNo} ${r.jobNo ?? ""} ${r.itemLabel} ${r.itemName}`.toLowerCase().includes(q));
  const filtered = here.filter((g) => hit(g) && (!lineFilter || g.rows.some((r) => String(r.lineId) === lineFilter)) && (!partaiFilter || g.rows.some((r) => String(r.partaiId) === partaiFilter)));
  const page = usePaging(filtered, `${tab}|${q}|${lineFilter}|${partaiFilter}`);
  const partaiOptions = [...new Map(here.flatMap((g) => g.rows).filter((r) => r.partaiNo).map((r) => [r.partaiId, r.partaiNo!])).entries()];

  /** A row opens the work of the step it waits at, or sends it on from Stand By (D1). */
  function open(g: Group) {
    const t = tabOfGroup(g);
    const ids = g.rows.map((r) => r.id).join(",");
    if (t === "standby") {
      if (!can.transfer) return toast("Tidak diizinkan", "Anda tidak boleh membuat Push atau BSTB.", "err");
      return router.push(`/production/transfer/new?unit=${encodeURIComponent(unit.label)}&bucket=${ids}`);
    }
    if (t === "transit") return toast("Dalam perjalanan", "Barang ini menunggu diterima unit tujuan.");
    if (t[0] === "w") {
      if (!can.kerjaFinish) return toast("Tidak diizinkan", "Anda tidak boleh menyelesaikan Kerja.", "err");
      return setTicked((s) => {
        const n = new Set(s);
        if (n.has(g.key)) n.delete(g.key);
        else n.add(g.key);
        return n;
      });
    }
    if (t === "qc") {
      if (!can.qc) return toast("Tidak diizinkan", "Anda tidak boleh membuat QC Check.", "err");
      return router.push(`/production/qc-check/new?bucket=${ids}`);
    }
    const p = stepOf(g.rows[0].stepId ?? 0)?.process;
    if (p === "Grading") {
      if (!can.grading) return toast("Tidak diizinkan", "Anda tidak boleh membuat No. Grading.", "err");
      return router.push(`/production/grading/new?${g.job ? `job=${g.job.id}` : `bucket=${g.rows[0].id}`}`);
    }
    if (p === "Assembly") {
      if (!can.box) return toast("Tidak diizinkan", "Anda tidak boleh menutup kotak.", "err");
      return router.push(`/production/box/new?unit=${encodeURIComponent(unit.label)}`);
    }
    if (p === "JobOrder") {
      if (!can.jobOrder) return toast("Tidak diizinkan", "Anda tidak boleh membuat Job Order.", "err");
      return router.push(`/production/job-order/new?unit=${encodeURIComponent(unit.label)}&bucket=${ids}`);
    }
    if (p === "Kerja") {
      if (!can.kerjaStart) return toast("Tidak diizinkan", "Anda tidak boleh memulai Kerja.", "err");
      return router.push(`/production/kerja/new?unit=${encodeURIComponent(unit.label)}&bucket=${ids}`);
    }
    if (p === "Assign") {
      if (!can.work) return toast("Tidak diizinkan", "Anda tidak boleh mencatat pengerjaan.", "err");
      return router.push(`/production/work/new?bucket=${ids}`);
    }
    toast("Belum tersedia", `Proses ${p ? PROCESS_TEXT[p] : ""} belum dibangun.`);
  }

  /** Enter on an exact No. Job or No. Stok opens its work, wherever it waits (D1). */
  function onEnter() {
    const code = query.trim().toUpperCase();
    if (!code) return;
    const g = all.find((x) => x.job?.no.toUpperCase() === code || x.rows.some((r) => r.lotNo.toUpperCase() === code));
    if (g) {
      setQuery("");
      return open(g);
    }
    if (incoming.some((d) => d.issueNo.toUpperCase() === code || d.lines.some((l) => l.lotNo.toUpperCase() === code))) {
      setQuery("");
      return setTab("masuk");
    }
    toast("Tidak ditemukan", `${query.trim()} tidak ada di ${unit.label}.`, "err");
  }

  const tabs: [BoardTab, string, number][] = [
    ["masuk", "Penerimaan", incoming.length + transfers.length],
    ...unit.steps.flatMap((s): [BoardTab, string, number][] => {
      const out: [BoardTab, string, number][] = [[`p${s.id}`, `Persiapan ${PROCESS_TEXT[s.process]}`, tabRows(`p${s.id}`).length]];
      if (s.process === "Kerja") out.push([`w${s.id}`, "Sedang Dikerjakan", tabRows(`w${s.id}`).length]);
      return out;
    }),
    ...(unit.hasQc ? [["qc", "QC Check", tabRows("qc").length] as [BoardTab, string, number]] : []),
    ["standby", "Stand By", tabRows("standby").length],
    ["transit", "Dalam Perjalanan", tabRows("transit").length],
  ];

  const sub = [
    unit.workstation,
    unit.pre ? "Sebelum partai, semua line" : unit.lines.length ? `Line ${unit.lines.map((l) => l.name).join(", ")}` : null,
    [...unit.steps.map((s) => PROCESS_TEXT[s.process]), ...(unit.hasQc ? ["QC"] : [])].join(" › "),
    unit.checkpoint ? "Checkpoint: seluruh isi partai" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const standby = tab === "standby";
  const working = tab[0] === "w";
  // One main action per tab (the artifact's acts()): it opens the document empty on this Unit, filled through its input bar.
  const at = encodeURIComponent(unit.label);
  const action: { label: string; icon: "layers" | "clip" | "check" | "clock" | "box" | "send"; href: string; allowed: boolean } | null =
    tab === "qc"
      ? { label: "QC Check", icon: "check", href: `/production/qc-check/new?unit=${at}`, allowed: can.qc }
      : standby
        ? { label: "Kirim", icon: "send", href: `/production/transfer/new?unit=${at}`, allowed: can.transfer }
        : tab[0] === "p"
          ? ({
              Grading: { label: "Buat Grading", icon: "layers" as const, href: `/production/grading/new?unit=${at}`, allowed: can.grading },
              JobOrder: { label: "Buat Job Order", icon: "clip" as const, href: `/production/job-order/new?unit=${at}`, allowed: can.jobOrder },
              Assign: { label: "Catat Pengerjaan", icon: "check" as const, href: `/production/work/new?unit=${at}`, allowed: can.work },
              Kerja: { label: "Mulai Kerja", icon: "clock" as const, href: `/production/kerja/new?unit=${at}`, allowed: can.kerjaStart },
              Assembly: { label: "Buat Kotak", icon: "box" as const, href: `/production/box/new?unit=${at}`, allowed: can.box },
            }[stepProcess ?? "Assign"] ?? null)
          : null;
  const picked = working ? filtered.filter((g) => ticked.has(g.key)) : [];
  async function close(how: "finish" | "cancel") {
    setBusy(true);
    const result = await closeKerjaAction(picked.flatMap((g) => g.rows.map((r) => r.id)), how, todayIso());
    setBusy(false);
    setClosing(null);
    if (!result.ok) return toast("Belum bisa", Object.values(result.errors)[0] ?? "Periksa kembali.", "err");
    setTicked(new Set());
    toast(how === "finish" ? "Pekerjaan selesai" : "Mulai dibatalkan", result.message, "ok");
  }
  const empty = tab === "standby" ? ["Stand By kosong", "Barang selesai dikerjakan muncul di sini. Klik barisnya untuk mengirim."] : tab === "transit" ? ["Tidak ada barang dalam perjalanan", "BSTB yang sudah diajukan dan belum diterima muncul di sini."] : tab === "qc" ? EMPTY.QC : EMPTY[stepProcess ?? "Assign"];

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
              <Icon name="layers" size={16} />
            </span>
            {unit.name}
          </h1>
          {action?.allowed && (
            <div className="ph-act">
              <button className="btn primary" disabled={!here.length} onClick={() => router.push(action.href)}>
                <Icon name={action.icon} size={15} /> {action.label}
              </button>
            </div>
          )}
        </div>
        <p className="ph-sub">{sub}</p>
      </div>

      <div className="card">
        <div className="qtabs" role="tablist">
          {tabs.map(([t, name, n]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "act" : ""} onClick={() => setTab(t)}>
              {name}
              <span className="n">{n}</span>
            </button>
          ))}
        </div>

        {tab !== "masuk" && (
          <>
            <div className="toolbar">
              <form
                style={{ display: "contents" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  onEnter();
                }}
              >
                <SearchField value={query} onChange={setQuery} placeholder="Cari atau scan No. Job, No. Stok, atau Item…" />
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
              <span className="uw-hint">{standby ? "Tujuan mengikuti routing line tiap partai." : working ? "Centang Job yang selesai atau dibatalkan." : "Klik baris, atau tombol di atas untuk mengisi lewat baris input."}</span>
              <span className="tspace" />
              {working && can.kerjaFinish && (
                <>
                  <button className="btn sm" disabled={!picked.length || busy} onClick={() => setClosing("cancel")}>
                    Batal Mulai
                  </button>
                  <button className="btn sm primary" disabled={!picked.length || busy} onClick={() => setClosing("finish")}>
                    <Icon name="check" size={14} /> Selesaikan{picked.length > 1 ? ` (${picked.length})` : ""}
                  </button>
                </>
              )}
              <span className="count">
                <b>{filtered.length}</b> baris · <b>{filtered.filter((g) => g.job).length}</b> Job · <b>{gram(filtered.reduce((a, g) => a + (g.grams ?? 0), 0))}</b> g
              </span>
            </div>

            {!filtered.length ? (
              <div className="empty">
                <div className="ic">
                  <Icon name={tab === "transit" ? "truck" : standby ? "send" : "clip"} size={18} />
                </div>
                <h4>{empty[0]}</h4>
                <p>{empty[1]}</p>
              </div>
            ) : (
              <>
                <div className="tw">
                  <table className="grid" style={{ minWidth: standby ? 1100 : 980 }}>
                    <thead>
                      <tr>
                        {working && <th className="pick" />}
                        <th style={{ width: 190 }}>No. Job</th>
                        <th style={{ width: 160 }}>No. Stok</th>
                        <th>Item</th>
                        <th style={{ width: 220 }}>Partai</th>
                        <th className="num" style={{ width: 96 }}>Gram</th>
                        {standby && <th style={{ width: 130 }}>Tujuan</th>}
                        <th style={{ width: 96 }}>Sejak</th>
                        <th>Keterangan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.pageRows.map((g) => {
                        const r = g.rows[0];
                        return (
                          <tr key={g.key} onClick={() => open(g)}>
                            {working && (
                              <td className="pick">
                                <input type="checkbox" checked={ticked.has(g.key)} readOnly aria-label={`Pilih ${g.job ? g.job.no : r.lotNo}`} />
                              </td>
                            )}
                            <td>{g.job ? <span className="mono">{g.job.no}</span> : <span className="dash">Tanpa No. Job</span>}</td>
                            <td>
                              {g.rows.length === 1 ? (
                                <span className="mono">{r.lotNo}</span>
                              ) : (
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
                              )}
                            </td>
                            <td>
                              {[...new Map(g.rows.map((x) => [x.itemLabel, x])).values()].map((x) => (
                                <div key={x.itemLabel}>
                                  {idc(x.itemLabel, x.itemName)}
                                  {x.isBjl && <span className="bdg s-mute">BJL</span>}
                                </div>
                              ))}
                            </td>
                            <td>
                              <PartaiCell rows={g.rows} />
                            </td>
                            <td className="num">{g.grams != null ? gram(g.grams) : <span className="dash">—</span>}</td>
                            {standby && (
                              <td>
                                <Next row={r} />
                              </td>
                            )}
                            <td>{oldest(g.rows) ? formatDate(oldest(g.rows)) : <span className="dash">—</span>}</td>
                            <td className="uw-note">
                              <Notes rows={g.rows} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pager page={page.page} pages={page.pages} total={page.total} perPage={page.perPage} onPage={page.setPage} onPerPage={page.setPerPage} />
              </>
            )}
          </>
        )}

        {tab === "masuk" &&
          (incoming.length + transfers.length ? (
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
                  {transfers.map((t) => (
                    <tr key={`t${t.id}`} onClick={() => router.push(`/production/transfer/${t.id}`)}>
                      <td>
                        <span className="lab">{t.no}</span>
                      </td>
                      <td>{TRANSFER_KIND_TEXT[t.kind]}</td>
                      <td>{t.fromLabel}</td>
                      <td>{formatDate(t.date)}</td>
                      <td className="num">{t.lines.length}</td>
                      <td className="num">{gram(t.lines.reduce((a, l) => a + (l.grams ?? 0), 0))}</td>
                      <td onClick={(e) => e.stopPropagation()}>{canReceive && <TransferReceiveButton id={t.id} subject={t.no} from={t.fromLabel} partai={t.kind === "BstbPartai"} small />}</td>
                    </tr>
                  ))}
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
              <p>{unit.pre ? "Kiriman baru muncul di sini setelah pengirim menekan Ajukan." : "Barang dari Unit lain dalam Workstation yang sama masuk lewat Dokumen Push, langsung ke Persiapan tanpa Terima. Kiriman BSTB muncul di sini sampai diterima."}</p>
            </div>
          ))}
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
            <table className="grid" style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  <th style={{ width: 160 }}>No. Stok</th>
                  <th>Item</th>
                  <th className="num" style={{ width: 96 }}>Gram</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={closing !== null}
        icon={closing === "cancel" ? "warn" : "check"}
        tone={closing === "cancel" ? "danger" : "brand"}
        title={closing === "cancel" ? "Batal Mulai?" : `Selesaikan ${picked.length} Job?`}
        subject={unit.label}
        body={closing === "cancel" ? "Job kembali ke Persiapan Kerja tanpa biaya." : "Biaya Unit dibebankan bila Kerja proses terakhir, dan Job masuk proses berikutnya."}
        confirmLabel={closing === "cancel" ? "Ya, Batalkan" : "Ya, Selesai"}
        busy={busy}
        onConfirm={() => close(closing!)}
        onCancel={() => setClosing(null)}
      />
    </>
  );
}
