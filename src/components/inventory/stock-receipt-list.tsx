"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { StockReceiptRow } from "@/lib/erp/stock-receipt";
import { STOCK_RECEIPT_PATH, STOCK_RECEIPT_PURPOSES, STOCK_RECEIPT_PURPOSE_KEYS, type StockReceiptPurposeKey } from "@/lib/erp/stock-receipt-purposes";
import {
  STOCK_RECEIPT_STATUS_BADGE,
  STOCK_RECEIPT_STATUS_TEXT,
  availableStockReceiptActions,
  stockReceiptIsEditable,
  stockReceiptTransitions,
  type StockReceiptAbilities,
  type StockReceiptStatus,
} from "@/lib/erp/stock-receipt-workflow";
import { formatDate } from "@/lib/format";

const STATUSES: StockReceiptStatus[] = ["Draft", "Received", "Posted", "Cancelled"];

export type WaitingSource = { purpose: StockReceiptPurposeKey; id: number; no: string; date: string; from: string };

/**
 * The Stock Receipt register (P317, P339). Above it, **Menunggu Diterima**:
 * what production sent and the bonuses Receipt Notes weighed, not yet taken by
 * a Stock Receipt, each opening Buat on its source so nothing is forgotten.
 */
export function StockReceiptList({ rows, waiting, can }: { rows: StockReceiptRow[]; waiting: WaitingSource[]; can: StockReceiptAbilities }) {
  const banner = waiting.length > 0 && (
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name="clock" size={15} />
        </span>
        <div className="ct">
          <h3>Menunggu Diterima · {waiting.length}</h3>
          <p>Kiriman produksi dan bonus Receipt Note yang belum dibuatkan Stock Receipt.</p>
        </div>
      </div>
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ width: 190 }}>Sumber</th>
              <th style={{ width: 170 }}>Tujuan</th>
              <th>Dari</th>
              <th style={{ width: 110 }}>Tanggal</th>
              {can.create && <th style={{ width: 120 }} />}
            </tr>
          </thead>
          <tbody>
            {waiting.map((w) => (
              <tr key={`${w.purpose}:${w.id}`}>
                <td>
                  <span className="mono">{w.no}</span>
                </td>
                <td>{STOCK_RECEIPT_PURPOSES[w.purpose].name}</td>
                <td>{w.from}</td>
                <td>{formatDate(w.date)}</td>
                {can.create && (
                  <td>
                    <Link className="btn sm" href={`${STOCK_RECEIPT_PATH}/new?purpose=${w.purpose}&source=${w.id}`}>
                      <Icon name="down" size={14} /> Terima
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  return (
    <DocumentRegister
      module="Persediaan"
      icon="down"
      title="Stock Receipt"
      sub="Barang masuk gudang Anda tanpa partner, menurut tujuannya."
      base={STOCK_RECEIPT_PATH}
      newLabel="Buat Stock Receipt"
      canCreate={can.create}
      searchHint="Cari nomor, tujuan, sumber atau gudang…"
      statuses={STATUSES}
      statusText={STOCK_RECEIPT_STATUS_TEXT}
      statusBadge={STOCK_RECEIPT_STATUS_BADGE}
      sourceLabel="Dokumen Sumber"
      columns={[
        { key: "purpose", label: "Tujuan", width: 170 },
        { key: "warehouse", label: "Gudang" },
        { key: "lots", label: "No. Stok", width: 76, num: true },
      ]}
      valueLabel="Nilai"
      facets={[{ key: "purpose", label: "Tujuan", options: STOCK_RECEIPT_PURPOSE_KEYS.map((k) => ({ value: k, label: STOCK_RECEIPT_PURPOSES[k].name })) }]}
      empty="Terima kiriman produksi, bonus Receipt Note, atau barang lain yang masuk gudang tanpa partner."
      banner={banner}
      rows={rows.map((r) => ({
        id: r.id,
        no: r.no,
        status: r.status,
        date: r.date,
        source: r.sourceNo ? { no: r.sourceNo, href: r.sourceId ? `/inventory/receipt-note/${r.sourceId}` : undefined, note: r.unitLabel || undefined } : null,
        cells: {
          purpose: STOCK_RECEIPT_PURPOSES[r.purpose].name,
          warehouse: (
            <span className="idc">
              <span className="lab">{r.warehouseLabel}</span>
              <span className="nm">{r.warehouseName}</span>
            </span>
          ),
          lots: r.lots,
        },
        value: <Amount value={r.cost} />,
        facets: { purpose: r.purpose },
        search: [STOCK_RECEIPT_PURPOSES[r.purpose].name, r.unitLabel, r.unitName, r.warehouseLabel, r.warehouseName].join(" "),
        editable: can.edit && stockReceiptIsEditable(r.status),
        steps: rowSteps(availableStockReceiptActions(r.status, can), stockReceiptTransitions(r.purpose)),
      }))}
    />
  );
}
