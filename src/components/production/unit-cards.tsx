"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { SearchField } from "@/components/ui/search-field";
import { formatNumber } from "@/lib/format";
import type { CardUnit, WorkspaceCards } from "@/lib/erp/production-workspace";

/**
 * The Workspace's Unit cards (`Workspace-Unit-Diff.md` A1): Line tabs, a search,
 * the segment before the partai first, then each Workstation. A Line tab shows
 * the Units of that line's routing and the segment's, and counts only that
 * line's goods; goods before a partai belong to every line.
 */
export const PROCESS_TEXT = { PassThrough: "Pass Through", Grading: "Grading", Assembly: "Assembly" } as const;
const gram = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

export function UnitCards({ data, incoming, own }: { data: WorkspaceCards; incoming: Record<number, { docs: number; grams: number }>; own: boolean }) {
  const [line, setLine] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const lineName = new Map(data.lines.map((l) => [l.id, l.name]));
  const onLine = (u: CardUnit, id: number | null) => id === null || u.pre || u.lineIds.includes(id);
  const q = query.trim().toLowerCase();
  const shown = data.units.filter((u) => onLine(u, line) && (!q || `${u.label} ${u.name}`.toLowerCase().includes(q)));
  const pre = shown.filter((u) => u.pre);
  const post = shown.filter((u) => !u.pre);
  const groups = [...new Set(post.map((u) => u.workstation ?? "Tanpa Workstation"))];

  const held = (u: CardUnit, stage: string) =>
    data.totals
      .filter((t) => t.unitId === u.id && t.stage === stage && (line === null || t.lineId === null || t.lineId === line))
      .reduce((a, t) => ({ rows: a.rows + t.rows, grams: a.grams + t.grams }), { rows: 0, grams: 0 });

  const num = (label: string, rows: number, grams: number, hot = false) => (
    <div className={hot && rows ? "hot" : ""}>
      <label>{label}</label>
      <b className={rows ? "" : "z"}>{rows}</b>
      <small>{rows ? `${gram(grams)} g` : "—"}</small>
    </div>
  );

  const card = (u: CardUnit) => {
    const masuk = incoming[u.id] ?? { docs: 0, grams: 0 };
    const p = held(u, "Preparation");
    const qc = held(u, "QcCheck");
    const sb = held(u, "StandBy");
    return (
      <Link key={u.id} className="uw-card" href={`/production/workspace/${encodeURIComponent(u.label)}`}>
        <span className="uw-card-h">
          <span className="lab lg">{u.label}</span>
          <b>{u.name}</b>
        </span>
        <span className="uw-tags">
          <span className="bdg t-info">{PROCESS_TEXT[u.process]}</span>
          {u.pre ? (
            <span className="bdg t-slate">Sebelum Partai</span>
          ) : (
            u.lineIds.map((id) => (
              <span key={id} className="bdg t-acc">
                {lineName.get(id)}
              </span>
            ))
          )}
          {u.hasQc && <span className="bdg t-ok">QC</span>}
        </span>
        <span className="uw-nums">
          {num("Masuk", masuk.docs, masuk.grams, true)}
          {num("Persiapan", p.rows, p.grams)}
          {u.hasQc ? (
            num("QC", qc.rows, qc.grams, true)
          ) : (
            <div>
              <label>QC</label>
              <b className="z">—</b>
              <small>tanpa QC</small>
            </div>
          )}
          {num("Stand By", sb.rows, sb.grams)}
        </span>
      </Link>
    );
  };

  const tabs: [number | null, string, number][] = [
    [null, "Semua Line", data.units.length],
    ...data.lines.map((l) => [l.id, l.name, data.units.filter((u) => onLine(u, l.id)).length] as [number, string, number]),
  ];

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        {data.lines.length > 0 && data.units.some((u) => !u.pre) && (
          <div className="qtabs" role="tablist">
            {tabs.map(([id, name, n]) => (
              <button key={id ?? "all"} type="button" role="tab" aria-selected={line === id} className={line === id ? "act" : ""} onClick={() => setLine(id)}>
                {name}
                <span className="n">{n}</span>
              </button>
            ))}
          </div>
        )}
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari kode atau nama Unit…" />
          <span className="uw-hint">{line === null ? "Unit sebelum partai dipakai semua line." : `Unit pada routing ${lineName.get(line)}, ditambah Unit sebelum partai. Hitungan hanya barang line ini.`}</span>
          <span className="tspace" />
          <span className="count">
            <b>{shown.length}</b> Unit
          </span>
        </div>
      </div>

      {!shown.length && (
        <div className="card">
          <div className="empty">
            <div className="ic">
              <Icon name="layers" size={18} />
            </div>
            <h4>{data.units.length ? "Tidak ada Unit yang cocok" : "Belum ada Unit untuk Anda"}</h4>
            <p>
              {data.units.length
                ? "Ubah pencarian atau tab Line."
                : own
                  ? "Minta administrator menugaskan Unit di form User, tab Unit Produksi."
                  : "Belum ada Unit yang aktif. Unit dibuat di ERP › Master › Produksi."}
            </p>
          </div>
        </div>
      )}

      {pre.length > 0 && (
        <section>
          <div className="uw-ws">Sebelum Partai</div>
          <div className="uw-grid">{pre.map(card)}</div>
        </section>
      )}
      {groups.map((g) => (
        <section key={g}>
          <div className="uw-ws">{g}</div>
          <div className="uw-grid">{post.filter((u) => (u.workstation ?? "Tanpa Workstation") === g).map(card)}</div>
        </section>
      ))}
    </>
  );
}
