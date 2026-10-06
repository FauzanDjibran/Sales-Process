"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import type { RefOption } from "@/lib/erp/records";
import { reportHref } from "@/lib/erp/reports";
import { useReportRun } from "./report-run";

/**
 * The filter for the inventory reports (P120): an item and, where the report
 * is per warehouse, a warehouse; then either a period (`period`, the cards) or
 * one date the stock stands at (`asof`, the balances). In the URL, like every
 * Report View.
 */
export function StockReportParams({
  slug,
  items,
  itemId,
  warehouses,
  warehouseId,
  mode,
  asOf,
  from,
  to,
  itemRequired,
}: {
  slug: string;
  items: RefOption[];
  itemId: number | null;
  /** Null hides the warehouse filter (the valuation reports are per item, all warehouses). */
  warehouses: RefOption[] | null;
  warehouseId: number | null;
  mode: "asof" | "period";
  asOf: string;
  from: string;
  to: string;
  itemRequired: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [item, setItem] = useState<number | null>(itemId);
  const [warehouse, setWarehouse] = useState<number | null>(warehouseId);
  const [day, setDay] = useState(asOf);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);

  const invalidRange = mode === "period" && Boolean(start && end && start > end);
  const missing = itemRequired && !item;

  useReportRun(
    () => {
      if (invalidRange || missing) return;
      const where = { item, warehouse: warehouses ? warehouse : null };
      startTransition(() => {
        router.push(reportHref(slug, mode === "asof" ? { ...where, asOf: day } : { ...where, from: start, to: end }));
      });
    },
    {
      blocked: invalidRange || missing,
      hint: invalidRange ? "Tanggal akhir tidak boleh lebih awal dari tanggal mulai." : "Pilih Barang terlebih dahulu.",
      pending,
    }
  );

  return (
    <>
      <div className="rrow">
        <span className="rl">Barang</span>
        <div className="rf wide">
          <Combobox
            value={item}
            options={items}
            placeholder={itemRequired ? "Pilih Barang…" : "Semua barang"}
            emptyText="Belum ada barang dengan Kelola Stok."
            onChange={setItem}
          />
        </div>
        {warehouses && (
          <>
            <span className="rl">Gudang</span>
            <div className="rf">
              <Combobox value={warehouse} options={warehouses} placeholder="Semua gudang" onChange={setWarehouse} />
            </div>
          </>
        )}
      </div>
      <div className="rrow">
        {mode === "asof" ? (
          <>
            <span className="rl">Per Tanggal</span>
            <div className="rf date">
              <DateInput value={day} onChange={setDay} />
            </div>
          </>
        ) : (
          <>
            <span className="rl">Periode</span>
            <div className="rf date">
              <DateInput value={start} invalid={invalidRange} onChange={setStart} />
            </div>
            <span className="rl">s/d</span>
            <div className="rf date">
              <DateInput value={end} invalid={invalidRange} onChange={setEnd} />
            </div>
            {invalidRange && (
              <span className="err">
                <Icon name="warn" size={11} />
                Tanggal akhir lebih awal dari tanggal mulai.
              </span>
            )}
          </>
        )}
      </div>
    </>
  );
}
