"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { PROD_DOC_STATUS_BADGE, PROD_DOC_STATUS_TEXT, type ProdDocStatus } from "@/lib/erp/production-doc-workflow";

/** One register row: what every production document shows, then its own places and value. */
export type ProdDocListRow = {
  id: number;
  no: string;
  date: string;
  status: ProdDocStatus;
  /** Label + name pairs, one per place column (unit, warehouse…). */
  places: { label: string; name: string }[];
  /** A short tag, e.g. the release's purpose; empty for none. */
  tag?: string;
  /** The partai it is about (W76); none before a partai. */
  partai?: string | null;
  lines: number;
  /** Gram it holds (A7.2); posted documents show what they took. */
  grams?: number | null;
  /** Shown for a posted document only. */
  value: number | null;
};

/**
 * The register every production document shares (R5, R7, R8, A7): status tabs
 * with their counts, then Nomor, Status, Tanggal, Unit, Partai, Baris, Gram and
 * the value in its own column (D6). Drafts sort first, then newest first.
 */
const TABS: [ProdDocStatus | "", string][] = [
  ["Draft", PROD_DOC_STATUS_TEXT.Draft],
  ["Posted", PROD_DOC_STATUS_TEXT.Posted],
  ["Cancelled", PROD_DOC_STATUS_TEXT.Cancelled],
  ["", "Semua"],
];

export function ProdDocList({
  crumb,
  title,
  icon,
  sub,
  path,
  rows: all,
  placeColumns,
  tagColumn,
  valueColumn,
  canCreate,
  emptyText,
}: {
  crumb: string;
  title: string;
  icon: IconName;
  sub: string;
  path: string;
  rows: ProdDocListRow[];
  placeColumns: string[];
  tagColumn?: string;
  valueColumn?: string;
  canCreate: boolean;
  emptyText: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // A queue opens on its Drafts, when there are any.
  const [status, setStatus] = useState<string>(() => (all.some((o) => o.status === "Draft") ? "Draft" : ""));
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all
        .filter(
          (o) =>
            (!status || o.status === status) &&
            (!q || [o.no, o.tag ?? "", o.partai ?? "", ...o.places.flatMap((p) => [p.label, p.name])].some((s) => s.toLowerCase().includes(q)))
        )
        .sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft")),
    [all, q, status]
  );
  const paging = usePaging(rows, `${q}|${status}`);
  const hasPartai = all.some((o) => o.partai !== undefined);
  const hasGrams = all.some((o) => o.grams !== undefined);
  const newButton = canCreate && (
    <Link className="btn primary" href={`${path}/new`}>
      <Icon name="plus" size={15} /> {title} Baru
    </Link>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>{crumb}</span>
          <span>/</span>
          <span className="cur">{title}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={icon} size={16} />
            </span>
            {title}
          </h1>
          <div className="ph-act">{newButton}</div>
        </div>
        <p className="ph-sub">{sub}</p>
      </div>

      <div className="card">
        <div className="qtabs" role="tablist">
          {TABS.map(([value, label]) => (
            <button key={value || "all"} type="button" role="tab" aria-selected={status === value} className={status === value ? "act" : ""} onClick={() => setStatus(value)}>
              {label}
              <span className="n">{value ? all.filter((o) => o.status === value).length : all.length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder={`Cari nomor, partai atau ${placeColumns.join(" / ").toLowerCase()}…`} />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> dokumen
          </span>
        </div>

        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>Nomor</th>
                    <th style={{ width: 120 }}>Status</th>
                    <th style={{ width: 106 }}>Tanggal</th>
                    {tagColumn && <th style={{ width: 170 }}>{tagColumn}</th>}
                    {placeColumns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                    {hasPartai && <th style={{ width: 160 }}>Partai</th>}
                    <th className="num" style={{ width: 70 }}>
                      Baris
                    </th>
                    {hasGrams && (
                      <th className="num" style={{ width: 120 }}>
                        Gram
                      </th>
                    )}
                    {valueColumn && (
                      <th className="num" style={{ width: 150 }}>
                        {valueColumn}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`${path}/${o.id}`)}>
                      <td>
                        <Link className="lab" href={`${path}/${o.id}`}>
                          {o.no}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${PROD_DOC_STATUS_BADGE[o.status]}`}>{PROD_DOC_STATUS_TEXT[o.status]}</span>
                      </td>
                      <td>{formatDate(o.date)}</td>
                      {tagColumn && <td>{o.tag ? <span className="bdg t-slate">{o.tag}</span> : <span className="dash">—</span>}</td>}
                      {o.places.map((p, i) => (
                        <td key={i}>
                          {p.label ? (
                            <span className="idc">
                              <span className="lab">{p.label}</span>
                              <span className="nm">{p.name}</span>
                            </span>
                          ) : (
                            <span className="dash">—</span>
                          )}
                        </td>
                      ))}
                      {hasPartai && <td className="mono">{o.partai ?? <span className="dash">—</span>}</td>}
                      <td className="num">{o.lines}</td>
                      {hasGrams && <td className="num">{o.grams != null ? formatNumber(o.grams, o.grams % 1 ? 2 : 0) : <span className="dash">—</span>}</td>}
                      {valueColumn && (
                        <td className="num">
                          {o.status === "Posted" && o.value != null ? <span className="mny">{formatMoney(o.value, "IDR")}</span> : <span className="dash">—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={paging.page} pages={paging.pages} total={paging.total} perPage={paging.perPage} onPage={paging.setPage} onPerPage={paging.setPerPage} />
          </>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name={icon} size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : `Belum ada ${title}`}</h4>
            <p>{q || status ? `Tidak ada ${title} yang sesuai dengan pencarian atau filter.` : emptyText}</p>
            {q || status ? (
              <div className="cta">
                <button
                  className="btn"
                  onClick={() => {
                    setQuery("");
                    setStatus("");
                  }}
                >
                  Bersihkan filter
                </button>
              </div>
            ) : (
              newButton && <div className="cta">{newButton}</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
