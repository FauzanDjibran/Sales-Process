"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { documentHref } from "@/lib/erp/document-links";
import type { SlipListRow } from "@/lib/erp/tax-document";
import { SLIP_STATUS_BADGE, SLIP_STATUS_TEXT, slipLate } from "@/lib/erp/tax-document-workflow";
import { formatDate, formatMoney, formatPct } from "@/lib/format";

const money = (n: number) => formatMoney(n, "IDR");

type View = "" | "Awaiting" | "Late" | "Received";

/**
 * The Bukti Potong PPh register (P100): one row per document settled, per
 * receipt, per Jenis PPh the customer withheld (P69). Each is made by the
 * posted receipt and waits for the customer's BPPU; one past the 20th of the
 * month after it is flagged *Perlu Ditagih* — chase the customer for it.
 */
export function SlipList({ rows: all, today }: { rows: SlipListRow[]; today: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("");

  const awaiting = all.filter((s) => s.status === "Awaiting");
  const late = awaiting.filter((s) => slipLate(s, today));
  const received = all.filter((s) => s.status === "Received");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = all.filter(
      (s) =>
        (!view || (view === "Late" ? slipLate(s, today) : s.status === view)) &&
        (!q ||
          s.slipNo.toLowerCase().includes(q) ||
          s.receiptNo.toLowerCase().includes(q) ||
          s.docNo.toLowerCase().includes(q) ||
          (s.slipNumber ?? "").toLowerCase().includes(q) ||
          s.customerLabel.toLowerCase().includes(q) ||
          s.customerName.toLowerCase().includes(q))
    );
    return out.sort((a, b) => {
      const wa = a.status === "Awaiting";
      const wb = b.status === "Awaiting";
      if (wa !== wb) return wa ? -1 : 1;
      return wa ? a.expected.localeCompare(b.expected) : 0;
    });
  }, [all, q, view, today]);
  const paging = usePaging(rows, `${q}|${view}`);
  const filtered = Boolean(q || view);

  const tile = (v: View, icon: "clock" | "warn" | "check", tone: string, label: string, value: number, detail: string) => (
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
          <span className="cur">Bukti Potong PPh</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="scale" size={16} />
            </span>
            Bukti Potong PPh
          </h1>
        </div>
        <p className="ph-sub">
          PPh yang dipotong customer atas pembayarannya, dibuat otomatis saat Penerimaan diposting. Catat nomor dan tanggal
          BPPU dari customer agar PPh dapat dikreditkan.
        </p>
      </div>

      <div className="kpis bud">
        {tile("Awaiting", "clock", "t-warn", "Menunggu Bukti Potong", awaiting.length, `PPh ${money(awaiting.reduce((a, s) => a + s.amount, 0))}`)}
        {tile("Late", "warn", "t-bad", "Perlu Ditagih", late.length, "lewat tanggal 20 bulan berikutnya")}
        {tile("Received", "check", "t-ok", "Diterima", received.length, "BPPU sudah dicatat")}
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, penerimaan, dokumen atau customer…" />
          <Select
            variant="toolbar"
            value={view}
            set={Boolean(view)}
            options={[
              { value: "", label: "Status: semua" },
              { value: "Awaiting", label: SLIP_STATUS_TEXT.Awaiting },
              { value: "Late", label: "Perlu Ditagih" },
              { value: "Received", label: SLIP_STATUS_TEXT.Received },
            ]}
            onChange={(v) => setView(v as View)}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> bukti potong
          </span>
        </div>

        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Nomor</th>
                    <th style={{ width: 170 }}>Status</th>
                    <th style={{ width: 106 }}>Tanggal Potong</th>
                    <th>Pemotong · Dokumen</th>
                    <th style={{ width: 120 }}>Jenis PPh</th>
                    <th className="num" style={{ width: 130 }}>PPh</th>
                    <th style={{ width: 150 }}>No. Bukti Potong</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((s) => {
                    const doc = documentHref(s.docTable, s.docId);
                    return (
                      <tr key={s.id} onClick={() => router.push(`/tax/withholding-slip/${s.id}`)}>
                        <td>
                          <span className="dstack">
                            <Link className="lab" href={`/tax/withholding-slip/${s.id}`}>
                              {s.slipNo}
                            </Link>
                            <span className="d2">masa {s.taxPeriod}</span>
                          </span>
                        </td>
                        <td>
                          <span className="dstack">
                            <span className={`bdg ${SLIP_STATUS_BADGE[s.status]}`}>{SLIP_STATUS_TEXT[s.status]}</span>
                            {slipLate(s, today) && <span className="bdg t-bad">Perlu ditagih</span>}
                          </span>
                        </td>
                        <td>{formatDate(s.withheldDate)}</td>
                        <td>
                          <span className="dstack">
                            <span className="idc">
                              <span className="lab">{s.customerLabel}</span>
                              <span className="nm">{s.customerName}</span>
                            </span>
                            <span className="d2">
                              <Link className="mono" href={`/finance/cash-bank/receipt/${s.receiptId}`} onClick={(e) => e.stopPropagation()}>
                                {s.receiptNo}
                              </Link>
                              {" · "}
                              {doc ? (
                                <Link className="mono" href={doc} onClick={(e) => e.stopPropagation()}>
                                  {s.docNo}
                                </Link>
                              ) : (
                                <span className="mono">{s.docNo}</span>
                              )}
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className="dstack">
                            <span className="lab">{s.whtLabel}</span>
                            <span className="d2">{formatPct(s.rate)} × {money(s.base)}</span>
                          </span>
                        </td>
                        <td className="num">
                          <span className="mny">{money(s.amount)}</span>
                        </td>
                        <td>{s.slipNumber ? <span className="mono">{s.slipNumber}</span> : <span className="dash">belum diterima</span>}</td>
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
              <Icon name="scale" size={20} />
            </div>
            <h4>{filtered ? "Tidak ada yang cocok" : "Belum ada Bukti Potong"}</h4>
            <p>
              {filtered
                ? "Tidak ada bukti potong yang sesuai dengan pencarian atau filter."
                : "Bukti potong dibuat otomatis saat Penerimaan yang memotong PPh diposting."}
            </p>
            {filtered && (
              <div className="cta">
                <button
                  className="btn"
                  onClick={() => {
                    setQuery("");
                    setView("");
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
