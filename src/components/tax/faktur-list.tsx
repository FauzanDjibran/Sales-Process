"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { documentHref } from "@/lib/erp/document-links";
import type { FakturListRow } from "@/lib/erp/tax-document";
import { FAKTUR_KIND_TEXT, fakturLate, type TaxFakturKind } from "@/lib/erp/tax-document-workflow";
import { formatDate, formatMoney } from "@/lib/format";

const money = (n: number) => formatMoney(n, "IDR");

/** The NSFP filter; *Late* is a reminder (no NSFP past the 15th), not a state. */
type View = "" | "NoNsfp" | "Late" | "Nsfp";

const matches = (f: FakturListRow, v: View, today: string) =>
  !v || (v === "Late" ? fakturLate(f, today) : v === "NoNsfp" ? !f.nsfp : Boolean(f.nsfp));

const KIND_BADGE: Record<TaxFakturKind, string> = { Advance: "t-vio", Settlement: "t-info", Normal: "t-slate" };

/**
 * The Faktur Pajak Keluaran register (P100, P101): the internal record of the
 * PPN Keluaran each transaction gave rise to, one document per event. Every
 * faktur here was made by a posting — a receipt's faktur uang muka, an
 * Invoice's faktur pelunasan or normal — so there is no *Baru* button. Newest
 * first, like every document register; the NSFP is shown as the reference to
 * Coretax, and the tiles only filter.
 */
export function FakturList({ rows: all, today }: { rows: FakturListRow[]; today: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("");
  const [kind, setKind] = useState("");

  const noNsfp = all.filter((f) => !f.nsfp);
  const late = noNsfp.filter((f) => fakturLate(f, today));

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = all.filter(
      (f) =>
        matches(f, view, today) &&
        (!kind || f.kind === kind) &&
        (!q ||
          f.fakturNo.toLowerCase().includes(q) ||
          f.sourceNo.toLowerCase().includes(q) ||
          (f.nsfp ?? "").includes(q) ||
          f.customerLabel.toLowerCase().includes(q) ||
          f.customerName.toLowerCase().includes(q))
    );
    return out;
  }, [all, q, view, kind, today]);
  const paging = usePaging(rows, `${q}|${view}|${kind}`);
  const filtered = Boolean(q || view || kind);

  const tile = (v: View, icon: "clock" | "warn" | "tags", tone: string, label: string, value: number, detail: string) => (
    <button className="kpi" style={{ textAlign: "left", font: "inherit" }} onClick={() => setView(view === v ? "" : v)} aria-pressed={view === v}>
      <div className="h">
        <span className={`i ${tone}`}>
          <Icon name={icon} size={14} />
        </span>
        <span className="l">{label}</span>
      </div>
      <div className="v">{value}</div>
      <div className="d">{detail}</div>
    </button>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Pajak</span>
          <span>/</span>
          <span className="cur">Faktur Pajak Keluaran</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="tags" size={16} />
            </span>
            Faktur Pajak Keluaran
          </h1>
        </div>
        <p className="ph-sub">
          Catatan PPN Keluaran per kejadian, dibuat otomatis saat posting: faktur uang muka dari Penerimaan, faktur pelunasan
          atau normal dari Invoice Penjualan. NSFP dari Coretax diisi sebagai referensi.
        </p>
      </div>

      <div className="kpis bud">
        {tile("", "tags", "t-info", "Faktur Tercatat", all.length, `PPN ${money(all.reduce((a, f) => a + f.ppn, 0))}`)}
        {tile("NoNsfp", "clock", "t-warn", "NSFP Belum Diisi", noNsfp.length, `PPN ${money(noNsfp.reduce((a, f) => a + f.ppn, 0))}`)}
        {tile("Late", "warn", "t-bad", "Lewat Tanggal 15", late.length, "belum ada NSFP setelah batas upload")}
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, NSFP, dokumen sumber atau customer…" />
          <Select
            variant="toolbar"
            value={view}
            set={Boolean(view)}
            options={[
              { value: "", label: "NSFP: semua" },
              { value: "NoNsfp", label: "NSFP belum diisi" },
              { value: "Late", label: "Lewat tanggal 15" },
              { value: "Nsfp", label: "NSFP sudah diisi" },
            ]}
            onChange={(v) => setView(v as View)}
          />
          <Select
            variant="toolbar"
            value={kind}
            set={Boolean(kind)}
            options={[
              { value: "", label: "Jenis: semua" },
              ...(["Advance", "Settlement", "Normal"] as TaxFakturKind[]).map((k) => ({ value: k, label: FAKTUR_KIND_TEXT[k] })),
            ]}
            onChange={setKind}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> faktur
          </span>
        </div>

        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Nomor</th>
                    <th style={{ width: 150 }}>Jenis</th>
                    <th style={{ width: 106 }}>Tanggal</th>
                    <th>Customer · Sumber</th>
                    <th className="num" style={{ width: 130 }}>DPP</th>
                    <th className="num" style={{ width: 130 }}>PPN</th>
                    <th style={{ width: 170 }}>NSFP</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((f) => {
                    const src = documentHref(f.sourceTable, f.sourceId);
                    const isLate = fakturLate(f, today);
                    return (
                      <tr key={f.id} onClick={() => router.push(`/tax/faktur/${f.id}`)}>
                        <td>
                          <Link className="lab" href={`/tax/faktur/${f.id}`}>
                            {f.fakturNo}
                          </Link>
                        </td>
                        <td>
                          <span className={`bdg ${KIND_BADGE[f.kind]}`}>{FAKTUR_KIND_TEXT[f.kind]}</span>
                        </td>
                        <td>{formatDate(f.taxDate)}</td>
                        <td>
                          <span className="dstack">
                            <span className="idc">
                              <span className="lab">{f.customerLabel}</span>
                              <span className="nm">{f.customerName}</span>
                            </span>
                            <span className="d2">
                              {src ? (
                                <Link className="mono" href={src} onClick={(e) => e.stopPropagation()}>
                                  {f.sourceNo}
                                </Link>
                              ) : (
                                <span className="mono">{f.sourceNo}</span>
                              )}
                            </span>
                          </span>
                        </td>
                        <td className="num">
                          <span className="mny">{money(f.dpp)}</span>
                        </td>
                        <td className="num">
                          <span className="mny">{money(f.ppn)}</span>
                        </td>
                        <td>
                          {f.nsfp ? (
                            <span className="mono">{f.nsfp}</span>
                          ) : (
                            <span className="dstack">
                              <span className="dash">belum diisi</span>
                              {isLate && <span className="bdg t-bad">Lewat {formatDate(f.deadline)}</span>}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager
              page={paging.page}
              pages={paging.pages}
              total={paging.total}
              perPage={paging.perPage}
              onPage={paging.setPage}
              onPerPage={paging.setPerPage}
            />
          </>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name="tags" size={20} />
            </div>
            <h4>{filtered ? "Tidak ada yang cocok" : "Belum ada Faktur Pajak"}</h4>
            <p>
              {filtered
                ? "Tidak ada faktur yang sesuai dengan pencarian atau filter."
                : "Faktur pajak dibuat otomatis saat Penerimaan uang muka atau Invoice Penjualan yang kena PPN diposting."}
            </p>
            {filtered && (
              <div className="cta">
                <button
                  className="btn"
                  onClick={() => {
                    setQuery("");
                    setView("");
                    setKind("");
                  }}
                >
                  Bersihkan filter
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
