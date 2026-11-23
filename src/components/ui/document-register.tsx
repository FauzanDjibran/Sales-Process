"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icon";
import { DocumentHeader } from "@/components/ui/document-header";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { useRegisterParams } from "@/components/ui/use-register-params";
import { withStep } from "@/components/ui/save-buttons";
import { menuButtonClass, orderForHeader, type ActionTone } from "@/lib/erp/header-actions";
import { PERIODS, periodRange, type Paged } from "@/lib/erp/register-query";
import { formatDate, todayIso } from "@/lib/format";

export type RegisterAction = { key: string; label: string; icon: IconName; tone: ActionTone };

/** A row's lifecycle steps for its ⋯ menu, read off the document's own transition table. */
export const rowSteps = <A extends string>(
  available: readonly A[],
  transitions: Record<A, { label: string; icon: IconName; tone: ActionTone }>
): RegisterAction[] => available.map((a) => ({ key: a, label: transitions[a].label, icon: transitions[a].icon, tone: transitions[a].tone }));

/** One document as every register shows it; what only one register shows goes in `cells`. */
export type RegisterRow = {
  id: number;
  no: string;
  status: string;
  date: string | null;
  /** Jatuh Tempo, under the date. */
  due?: string;
  overdue?: boolean;
  partner?: { label: string; name: string } | null;
  /** The document it came from — always named, linked where its page is known. */
  source?: { no: string; href?: string; note?: string } | null;
  /** The register's own columns, by key. */
  cells?: Record<string, React.ReactNode>;
  value?: React.ReactNode;
  pay?: { state: string; text: string; tone: string; note?: string } | null;
  /** The register's own filters, by key. */
  facets?: Record<string, string>;
  /** Further words the search finds. */
  search?: string;
  editable?: boolean;
  steps?: RegisterAction[];
};

export type RegisterColumn = { key: string; label: string; width?: number; num?: boolean };
export type RegisterFacet = { key: string; label: string; options: { value: string; label: string }[] };

/**
 * Every ERP document register (P309): the same header, filters, column order,
 * row actions, pager and empty state, so a register only says what its rows
 * are. Columns run No · Nomor · Status · Tanggal · Partner · Dokumen Sumber ·
 * the register's own · Nilai · Pembayaran · actions; Nomor and the actions stay
 * in place when the table scrolls. The filters live in the URL, so a register
 * opened again from a document's page is as it was left.
 *
 * `paged` is a register the database pages: it filters the same URL itself.
 * Otherwise every row is here and filtering asks the server nothing.
 */
export function DocumentRegister({
  module,
  icon,
  title,
  sub,
  base,
  newLabel,
  canCreate,
  createHref = `${base}/new`,
  moreActions,
  searchHint,
  statuses,
  statusText,
  statusBadge,
  statusWidth = 100,
  partnerLabel,
  sourceLabel,
  columns = [],
  valueLabel,
  payment,
  facets = [],
  empty,
  banner,
  rows: given,
  paged,
}: {
  module: string;
  icon: IconName;
  title: string;
  /** One short sentence: what the register lists. */
  sub: string;
  base: string;
  newLabel?: string;
  canCreate?: boolean;
  createHref?: string;
  /** Neutral buttons left of the create button. */
  moreActions?: React.ReactNode;
  searchHint: string;
  statuses: readonly string[];
  statusText: Record<string, string>;
  statusBadge: Record<string, string>;
  /** Wider where a status is a phrase. */
  statusWidth?: number;
  partnerLabel?: string;
  sourceLabel?: string;
  columns?: RegisterColumn[];
  valueLabel?: string;
  /** Bills: a Pembayaran column and filter. */
  payment?: boolean;
  facets?: RegisterFacet[];
  /** What the register is waiting for, while it holds nothing. */
  empty: string;
  banner?: React.ReactNode;
  rows: RegisterRow[];
  paged?: Pick<Paged<unknown>, "total" | "all" | "page" | "pages" | "size">;
}) {
  const router = useRouter();
  const reg = useRegisterParams({ local: !paged });
  const [menu, setMenu] = useState<{ row: RegisterRow; x: number; y: number } | null>(null);

  const q = reg.search.value.trim().toLowerCase();
  const period = reg.param("period");
  const partner = reg.param("partner");
  const pay = reg.param("pay");
  const facetValues = facets.map((f) => [f.key, reg.param(f.key)] as const);
  const facetKey = facetValues.map(([, v]) => v).join("|");

  const partners = useMemo(
    () => [...new Map(given.flatMap((r) => (r.partner ? [[r.partner.label, r.partner.name] as const] : []))).entries()].sort((a, b) => a[0].localeCompare(b[0])),
    [given]
  );
  const rows = useMemo(() => {
    if (paged) return given;
    const range = periodRange(period, todayIso());
    const out = given.filter(
      (r) =>
        (!reg.status || r.status === reg.status) &&
        (!range || (r.date !== null && r.date.slice(0, 10) >= range.from && r.date.slice(0, 10) <= range.to)) &&
        (!partner || r.partner?.label === partner) &&
        (!pay || (pay === "overdue" ? Boolean(r.overdue) : r.pay?.state === pay)) &&
        facetValues.every(([k, v]) => !v || r.facets?.[k] === v) &&
        (!q || [r.no, r.partner?.label, r.partner?.name, r.source?.no, r.search].some((v) => v?.toLowerCase().includes(q)))
    );
    // Drafts are the rows somebody still has something to do about.
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [given, paged, reg.status, period, partner, pay, facetKey, q]);

  const local = usePaging(rows, [q, reg.status, period, partner, pay, facetKey].join("|"));
  const page = paged
    ? { rows, page: paged.page, pages: paged.pages, total: paged.total, size: paged.size, onPage: reg.setPage, onSize: reg.setSize }
    : { rows: local.pageRows, page: local.page, pages: local.pages, total: local.total, size: local.perPage, onPage: local.setPage, onSize: local.setPerPage };
  const all = paged ? paged.all : given.length;

  const payOptions = useMemo(() => {
    const seen = new Map(given.flatMap((r) => (r.pay ? [[r.pay.state, r.pay.text] as const] : [])));
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [given]);
  const extraKeys = ["period", "partner", "pay", ...facets.map((f) => f.key)];
  const active = [q, reg.status, ...extraKeys.map((k) => reg.param(k))].filter(Boolean).length;
  const clear = () => reg.clear(...extraKeys);

  const width =
    36 + 158 + statusWidth + 88 + (partnerLabel ? 130 : 0) + (sourceLabel ? 144 : 0) + columns.reduce((s, c) => s + (c.width ?? 130), 0) + (valueLabel ? 124 : 0) + (payment ? 116 : 0) + 84;
  const create = canCreate && newLabel && (
    <Link className="btn primary" href={createHref}>
      <Icon name="plus" size={15} /> {newLabel}
    </Link>
  );
  // The whole row opens the document; a link inside it goes where it says.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <>
      <DocumentHeader module={module} icon={icon} title={title} sub={sub}>
        {moreActions}
        {create}
      </DocumentHeader>
      {banner}
      <div className="card">
        <div className="toolbar">
          <SearchField value={reg.search.value} onChange={reg.search.onChange} placeholder={searchHint} />
          <Select
            variant="toolbar"
            value={reg.status}
            set={Boolean(reg.status)}
            ariaLabel="Filter status"
            options={[{ value: "", label: "Status: semua" }, ...statuses.map((s) => ({ value: s, label: statusText[s] }))]}
            onChange={reg.setStatus}
          />
          <Select
            variant="toolbar"
            value={period}
            set={Boolean(period)}
            ariaLabel="Filter periode"
            options={[{ value: "", label: "Periode: semua" }, ...PERIODS]}
            onChange={(v) => reg.setParam("period", v)}
          />
          {partnerLabel && !paged && partners.length > 1 && (
            <Select
              variant="toolbar"
              value={partner}
              set={Boolean(partner)}
              ariaLabel={`Filter ${partnerLabel}`}
              options={[{ value: "", label: `${partnerLabel}: semua` }, ...partners.map(([label, name]) => ({ value: label, label: `${label} · ${name}` }))]}
              onChange={(v) => reg.setParam("partner", v)}
            />
          )}
          {payment && !paged && (
            <Select
              variant="toolbar"
              value={pay}
              set={Boolean(pay)}
              ariaLabel="Filter pembayaran"
              options={[{ value: "", label: "Pembayaran: semua" }, ...payOptions, { value: "overdue", label: "Lewat jatuh tempo" }]}
              onChange={(v) => reg.setParam("pay", v)}
            />
          )}
          {facets.map((f) => (
            <Select
              key={f.key}
              variant="toolbar"
              value={reg.param(f.key)}
              set={Boolean(reg.param(f.key))}
              ariaLabel={`Filter ${f.label}`}
              options={[{ value: "", label: `${f.label}: semua` }, ...f.options]}
              onChange={(v) => reg.setParam(f.key, v)}
            />
          ))}
          {active > 0 && (
            <button className="btn sm ghost" onClick={clear}>
              Bersihkan filter ({active})
            </button>
          )}
          <span className="tspace" />
          <span className="count">
            <b>{page.total}</b> dari {all} dokumen
          </span>
        </div>

        {page.total ? (
          <>
            <div className="tw">
              <table className="grid reg" style={{ minWidth: width }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>No</th>
                    <th className="rk" style={{ width: 158 }}>Nomor</th>
                    <th style={{ width: statusWidth }}>Status</th>
                    <th style={{ width: 88 }}>Tanggal</th>
                    {partnerLabel && <th>{partnerLabel}</th>}
                    {sourceLabel && <th style={{ width: 144 }}>{sourceLabel}</th>}
                    {columns.map((c) => (
                      <th key={c.key} className={c.num ? "num" : undefined} style={c.width ? { width: c.width } : undefined}>
                        {c.label}
                      </th>
                    ))}
                    {valueLabel && <th className="num" style={{ width: 124 }}>{valueLabel}</th>}
                    {payment && <th style={{ width: 116 }}>Pembayaran</th>}
                    <th className="ra" style={{ width: 84 }} />
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((r, i) => {
                    const href = `${base}/${r.id}`;
                    return (
                      <tr key={r.id} onClick={() => router.push(href)}>
                        <td className="no">{(page.page - 1) * page.size + i + 1}</td>
                        <td className="rk">
                          <Link className="lab" href={href} onClick={stop}>
                            {r.no}
                          </Link>
                        </td>
                        <td>
                          <span className={`bdg ${statusBadge[r.status] ?? "s-mute"}`}>{statusText[r.status] ?? r.status}</span>
                        </td>
                        <td>
                          {r.date ? formatDate(r.date) : <span className="dash">—</span>}
                          {r.due && <span className={`rsub${r.overdue ? " over" : ""}`}>jt {formatDate(r.due)}</span>}
                        </td>
                        {partnerLabel && (
                          <td>
                            {r.partner ? (
                              <span className="idc">
                                <span className="lab">{r.partner.label}</span>
                                <span className="nm">{r.partner.name}</span>
                              </span>
                            ) : (
                              <span className="dash">—</span>
                            )}
                          </td>
                        )}
                        {sourceLabel && (
                          <td>
                            {!r.source ? (
                              <span className="dash">—</span>
                            ) : r.source.href ? (
                              <Link className="lab" href={r.source.href} onClick={stop}>
                                {r.source.no}
                              </Link>
                            ) : (
                              <span className="mono">{r.source.no}</span>
                            )}
                            {r.source?.note && <span className="rsub">{r.source.note}</span>}
                          </td>
                        )}
                        {columns.map((c) => (
                          <td key={c.key} className={c.num ? "num" : undefined}>
                            {r.cells?.[c.key] ?? <span className="dash">—</span>}
                          </td>
                        ))}
                        {valueLabel && <td className="num">{r.value ?? <span className="dash">—</span>}</td>}
                        {payment && (
                          <td>
                            {r.pay ? <span className={`bdg ${r.pay.tone}`}>{r.pay.text}</span> : <span className="dash">—</span>}
                            {r.overdue ? <span className="rsub over">lewat tempo</span> : r.pay?.note && <span className="rsub">{r.pay.note}</span>}
                          </td>
                        )}
                        <td className="acts ra">
                          <span className="ract">
                            <Link className="iact" href={href} title="Lihat detail" onClick={stop}>
                              <Icon name="eye" size={15} />
                            </Link>
                            {r.editable ? (
                              <Link className="iact" href={`${href}/edit`} title="Ubah" onClick={stop}>
                                <Icon name="pen" size={15} />
                              </Link>
                            ) : (
                              <span className="sp" />
                            )}
                            {r.steps?.length ? (
                              <button
                                className="iact kb"
                                title="Aksi lain"
                                onClick={(e) => {
                                  stop(e);
                                  const box = e.currentTarget.getBoundingClientRect();
                                  setMenu({ row: r, x: box.right - 200, y: box.bottom + 5 });
                                }}
                              >
                                <Icon name="more" size={15} />
                              </button>
                            ) : (
                              <span className="sp" />
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={page.page} pages={page.pages} total={page.total} perPage={page.size} onPage={page.onPage} onPerPage={page.onSize} />
          </>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name={active ? "srch" : icon} size={20} />
            </div>
            <h4>{active ? "Tidak ada yang cocok" : `Belum ada ${title}`}</h4>
            <p>{active ? "Ubah kata kunci atau bersihkan filter yang sedang aktif." : empty}</p>
            {(active > 0 || create) && (
              <div className="cta">
                {active > 0 ? (
                  <button className="btn" onClick={clear}>
                    Bersihkan filter
                  </button>
                ) : (
                  create
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {menu && (
        <RowMenu
          row={menu.row}
          statusText={statusText[menu.row.status] ?? menu.row.status}
          x={menu.x}
          y={menu.y}
          // The document's page holds the confirmation, its reason and its journal.
          onPick={(key) => router.push(withStep(`${base}/${menu.row.id}`, key))}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

/** The row action menu — a fixed popup anchored to the trigger. */
function RowMenu({
  row,
  statusText,
  x,
  y,
  onPick,
  onClose,
}: {
  row: RegisterRow;
  statusText: string;
  x: number;
  y: number;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="menu" ref={ref} style={{ left: Math.max(8, x), top: y }}>
      <div className="hd">
        <b>{row.no}</b>
        <span>{statusText}</span>
      </div>
      <div className="dv" />
      {[...orderForHeader(row.steps ?? [], (s) => s.tone)].reverse().map((s) => (
        <button key={s.key} className={menuButtonClass(s.tone)} onClick={() => onPick(s.key)}>
          <Icon name={s.icon} size={14} /> {s.label}
        </button>
      ))}
    </div>
  );
}
