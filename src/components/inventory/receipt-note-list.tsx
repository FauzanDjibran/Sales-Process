"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { ReceiptNoteListRow } from "@/lib/erp/receipt-note";
import { RECEIPT_NOTE_STATUS_BADGE, RECEIPT_NOTE_STATUS_TEXT, type ReceiptNoteAbilities, type ReceiptNoteStatus } from "@/lib/erp/receipt-note-workflow";

/** The Receipt Note register (P125). Drafts first, then newest first. */
export function ReceiptNoteList({ rows: all, can }: { rows: ReceiptNoteListRow[]; can: ReceiptNoteAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = all.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q || [r.rnNo, r.sourceNo, r.supplierLabel, r.supplierName].some((x) => x.toLowerCase().includes(q)))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
  }, [all, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);
  const newButton = (
    <Link className="btn primary" href="/inventory/receipt-note/new">
      <Icon name="plus" size={15} /> Receipt Note Baru
    </Link>
  );
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Persediaan</span>
          <span>/</span>
          <span className="cur">Receipt Note</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="box" size={16} />
            </span>
            Receipt Note
          </h1>
          <div className="ph-act">{can.create && newButton}</div>
        </div>
        <p className="ph-sub">
          Penerimaan barang atau jasa dari supplier menurut Purchase Order. Barang Kelola Stok masuk per lot, lainnya dibebankan,
          dengan nilai DPP Purchase Order; hutang diakui di Invoice Pembelian.
        </p>
      </div>
      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor RN, PO atau supplier…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Posted", "Cancelled"] as ReceiptNoteStatus[]).map((s) => ({ value: s, label: RECEIPT_NOTE_STATUS_TEXT[s] })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> receipt note
          </span>
        </div>
        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>Nomor</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th style={{ width: 160 }}>Purchase Order</th>
                    <th>Supplier</th>
                    <th style={{ width: 110 }}>Gudang</th>
                    <th className="num" style={{ width: 150 }}>
                      Nilai
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/inventory/receipt-note/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`/inventory/receipt-note/${r.id}`}>
                          {r.rnNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${RECEIPT_NOTE_STATUS_BADGE[r.status]}`}>{RECEIPT_NOTE_STATUS_TEXT[r.status]}</span>
                      </td>
                      <td>{formatDate(r.rnDate)}</td>
                      <td>
                        <span className="mono">{r.sourceNo}</span>
                      </td>
                      <td>
                        <span className="idc">
                          <span className="lab">{r.supplierLabel}</span>
                          <span className="nm">{r.supplierName}</span>
                        </span>
                      </td>
                      <td>{r.warehouseLabel ? <span className="lab">{r.warehouseLabel}</span> : <span className="dash">—</span>}</td>
                      <td className="num">{r.status === "Posted" ? <span className="mny">{formatMoney(r.value, "IDR")}</span> : <span className="dash">—</span>}</td>
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
              <Icon name="box" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Receipt Note"}</h4>
            <p>{q || status ? "Tidak ada Receipt Note yang sesuai dengan pencarian atau filter." : "Catat barang atau jasa yang diterima dari Purchase Order yang Open."}</p>
            {!(q || status) && can.create && <div className="cta">{newButton}</div>}
          </div>
        )}
      </div>
    </>
  );
}
