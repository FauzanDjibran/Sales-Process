"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select } from "@/components/ui/select";
import type { RefOption } from "@/lib/erp/records";
import { reportHref } from "@/lib/erp/reports";
import type { StockGroupBy } from "@/lib/erp/stock-report";
import { useReportRun } from "./report-run";

const GROUPS: { value: StockGroupBy; label: string }[] = [
  { value: "item", label: "Per Barang" },
  { value: "warehouse", label: "Per Gudang" },
];

/**
 * The filter for the inventory reports (P120), in the URL like every Report
 * View. Then either a period (`period`, the cards) or one date the stock stands
 * at (`asof`, the balances).
 *
 * Kartu Stok and Saldo Stok (`grouped`) take several items and several
 * warehouses as chips — none means all — and a **Kelompok**: per item answers
 * *where is this item?*, per warehouse *what does this warehouse hold?*. The
 * valuation reports are one pool per item over every warehouse, so they keep
 * one item and no warehouse.
 */
export function StockReportParams({
  slug,
  items,
  warehouses,
  grouped,
  itemIds,
  warehouseIds,
  groupBy,
  mode,
  asOf,
  from,
  to,
  itemRequired,
}: {
  slug: string;
  items: RefOption[];
  /** Null on the valuation reports, which have no warehouse filter. */
  warehouses: RefOption[] | null;
  grouped: boolean;
  itemIds: number[];
  warehouseIds: number[];
  groupBy: StockGroupBy;
  mode: "asof" | "period";
  asOf: string;
  from: string;
  to: string;
  itemRequired: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [itemSet, setItemSet] = useState<number[]>(itemIds);
  const [warehouseSet, setWarehouseSet] = useState<number[]>(warehouseIds);
  const [group, setGroup] = useState<StockGroupBy>(groupBy);
  const [day, setDay] = useState(asOf);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);

  const invalidRange = mode === "period" && Boolean(start && end && start > end);
  const missing = itemRequired && itemSet.length === 0;

  useReportRun(
    () => {
      if (invalidRange || missing) return;
      const where = grouped
        ? { group, items: itemSet.join(","), warehouses: warehouseSet.join(",") }
        : { item: itemSet[0] ?? null };
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
      {grouped ? (
        <>
          <div className="rrow">
            <span className="rl">Kelompok</span>
            <div className="rf">
              <Select
                variant="toolbar"
                value={group}
                onChange={(v) => setGroup(v as StockGroupBy)}
                options={GROUPS}
                ariaLabel="Kelompok"
                title="Per Barang: di gudang mana barang ada. Per Gudang: barang apa saja di gudang."
              />
            </div>
            <span className="rl">Barang</span>
            <div className="rf wide">
              <MultiSelect
                value={itemSet}
                options={items}
                placeholder="Tambah Barang…"
                emptyPlaceholder="Semua barang"
                removeTitle="Keluarkan dari laporan"
                onChange={setItemSet}
              />
            </div>
          </div>
          {warehouses && (
            <div className="rrow">
              <span className="rl">Gudang</span>
              <div className="rf wide">
                <MultiSelect
                  value={warehouseSet}
                  options={warehouses}
                  placeholder="Tambah Gudang…"
                  emptyPlaceholder="Semua gudang"
                  removeTitle="Keluarkan dari laporan"
                  onChange={setWarehouseSet}
                />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rrow">
          <span className="rl">Barang</span>
          <div className="rf wide">
            <Combobox
              value={itemSet[0] ?? null}
              options={items}
              placeholder={itemRequired ? "Pilih Barang…" : "Semua barang"}
              emptyText="Belum ada barang dengan Kelola Stok."
              onChange={(id) => setItemSet(id ? [id] : [])}
            />
          </div>
        </div>
      )}
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
