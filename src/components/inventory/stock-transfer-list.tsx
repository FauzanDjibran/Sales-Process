"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { formatDate, formatNumber } from "@/lib/format";
import type { StockTransferListRow } from "@/lib/erp/stock-transfer";
import type { TransferReceiptListRow } from "@/lib/erp/stock-transfer-receipt";
import {
  STOCK_TRANSFER_RECEIPT_STATUS_BADGE,
  STOCK_TRANSFER_RECEIPT_STATUS_TEXT,
  STOCK_TRANSFER_STATUS_BADGE,
  STOCK_TRANSFER_STATUS_TEXT,
  type StockTransferReceiptStatus,
  type StockTransferStatus,
} from "@/lib/erp/stock-transfer-workflow";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

type Row = { id: number; no: string; date: string; status: string; fromLabel: string; fromName: string; toLabel: string; toName: string; lines: number; qty: number; extra?: React.ReactNode };

/**
 * The registers of Transfer Kirim and Transfer Terima (P300): status tabs with
 * their counts, then the documents newest first. The rows are already narrowed
 * to the user's warehouses in the database (OD-9).
 */
function TransferRegister({
  title,
  icon,
  slug,
  sub,
  tabs,
  rows: all,
  badge,
  text,
  newLabel,
  canCreate,
  extraHead,
  empty,
}: {
  title: string;
  icon: "send" | "down";
  slug: string;
  sub: string;
  tabs: [string, string][];
  rows: Row[];
  badge: Record<string, string>;
  text: Record<string, string>;
  newLabel: string;
  canCreate: boolean;
  extraHead?: string;
  empty: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(all.some((r) => r.status === tabs[0][0]) ? tabs[0][0] : "");
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all.filter(
        (r) =>
          (!status || r.status === status) &&
          (!q || [r.no, r.fromLabel, r.fromName, r.toLabel, r.toName].some((v) => v.toLowerCase().includes(q)))
      ),
    [all, status, q]
  );
  const paging = usePaging(rows, `${q}|${status}`);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Persediaan</span>
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
          <div className="ph-act">
            {canCreate && (
              <Link className="btn primary" href={`/inventory/${slug}/new`}>
                <Icon name="plus" size={15} /> {newLabel}
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">{sub}</p>
      </div>

      <div className="card">
        <div className="qtabs" role="tablist">
          {tabs.map(([value, label]) => (
            <button key={value || "all"} type="button" role="tab" aria-selected={status === value} className={status === value ? "act" : ""} onClick={() => setStatus(value)}>
              {label}
              <span className="n">{value ? all.filter((o) => o.status === value).length : all.length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor atau gudang…" />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> dokumen
          </span>
        </div>
        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>Nomor</th>
                    <th style={{ width: 140 }}>Status</th>
                    <th style={{ width: 106 }}>Tanggal</th>
                    {extraHead && <th style={{ width: 160 }}>{extraHead}</th>}
                    <th>Gudang Asal</th>
                    <th>Gudang Tujuan</th>
                    <th className="num" style={{ width: 70 }}>
                      Baris
                    </th>
                    <th className="num" style={{ width: 110 }}>
                      Qty
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/inventory/${slug}/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`/inventory/${slug}/${r.id}`}>
                          {r.no}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${badge[r.status]}`}>{text[r.status]}</span>
                      </td>
                      <td>{formatDate(r.date)}</td>
                      {extraHead && <td>{r.extra}</td>}
                      <td>
                        <span className="idc">
                          <span className="lab">{r.fromLabel}</span>
                          <span className="nm">{r.fromName}</span>
                        </span>
                      </td>
                      <td>
                        <span className="idc">
                          <span className="lab">{r.toLabel}</span>
                          <span className="nm">{r.toName}</span>
                        </span>
                      </td>
                      <td className="num">{r.lines}</td>
                      <td className="num">
                        <span className="mny">{qtyText(r.qty)}</span>
                      </td>
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
            <p>{q || status ? "Tidak ada dokumen yang sesuai dengan pencarian atau tab ini." : empty}</p>
          </div>
        )}
      </div>
    </>
  );
}

export function StockTransferList({ transfers, canCreate }: { transfers: StockTransferListRow[]; canCreate: boolean }) {
  const tabs: [StockTransferStatus | "", string][] = [
    ["Draft", "Draft"],
    ["InTransit", "Dalam Perjalanan"],
    ["Received", "Diterima"],
    ["Cancelled", "Dibatalkan"],
    ["", "Semua"],
  ];
  return (
    <TransferRegister
      title="Transfer Kirim"
      icon="send"
      slug="stock-transfer"
      sub="Stok dikirim dari satu gudang ke gudang lain lewat Gudang Transit, per lot. Tanpa journal; harga pokok rata-rata tidak berubah. Tampil kiriman dari dan ke gudang Anda."
      tabs={tabs}
      rows={transfers.map((t) => ({ id: t.id, no: t.transferNo, date: t.transferDate, status: t.status, fromLabel: t.fromLabel, fromName: t.fromName, toLabel: t.toLabel, toName: t.toName, lines: t.lines, qty: t.qty }))}
      badge={STOCK_TRANSFER_STATUS_BADGE}
      text={STOCK_TRANSFER_STATUS_TEXT}
      newLabel="Transfer Kirim Baru"
      canCreate={canCreate}
      empty="Transfer Kirim memindahkan stok dari gudang Anda ke gudang lain: pilih gudang tujuan, barang dan lotnya."
    />
  );
}

export function TransferReceiptList({ receipts, canCreate }: { receipts: TransferReceiptListRow[]; canCreate: boolean }) {
  const tabs: [StockTransferReceiptStatus | "", string][] = [
    ["Draft", "Draft"],
    ["Posted", "Diterima"],
    ["Cancelled", "Dibatalkan"],
    ["", "Semua"],
  ];
  return (
    <TransferRegister
      title="Transfer Terima"
      icon="down"
      slug="stock-transfer-receipt"
      sub="Gudang tujuan menerima Transfer Kirim dari Gudang Transit, boleh bertahap, ke lokasi yang dipilih. Tampil penerimaan ke gudang Anda."
      tabs={tabs}
      rows={receipts.map((r) => ({
        id: r.id,
        no: r.receiptNo,
        date: r.receiptDate,
        status: r.status,
        fromLabel: r.fromLabel,
        fromName: r.fromName,
        toLabel: r.toLabel,
        toName: r.toName,
        lines: r.lines,
        qty: r.qty,
        extra: <span className="lab">{r.transferNo}</span>,
      }))}
      badge={STOCK_TRANSFER_RECEIPT_STATUS_BADGE}
      text={STOCK_TRANSFER_RECEIPT_STATUS_TEXT}
      newLabel="Transfer Terima Baru"
      canCreate={canCreate}
      extraHead="Transfer Kirim"
      empty="Transfer Terima mencatat barang dari Transfer Kirim yang tiba di gudang Anda."
    />
  );
}
