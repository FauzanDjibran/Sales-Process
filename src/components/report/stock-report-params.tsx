"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { MultiSelect } from "@/components/ui/multi-select";
import type { RefOption } from "@/lib/erp/records";
import { reportHref } from "@/lib/erp/reports";
import type { StockGroupBy } from "@/lib/erp/stock-report";
import { INVALID_RANGE_HINT, PeriodRow, invalidRange as isInvalidRange } from "./period-row";
import { RunToggle } from "./report-blocks";
import { useReportRun } from "./report-run";

/**
 * The filter for the inventory reports (P120), in the URL like every Report
 * View. Then either a period (`period`, the cards) or one date the stock stands
 * at (`asof`, the balances).
 *
 * Kartu Stok and Saldo Stok (`grouped`) take several items and several
 * warehouses as chips — none means all — and a **Kelompok** toggle that moves
 * at once, as Buku does on Buku Piutang: per item answers *where is this item?*,
 * per warehouse *what does this warehouse hold?*, and nothing else may be a
 * grouping. The lots behind Saldo Stok are a checkbox. The
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
  lots,
  showLots,
  groupBy,
  groupHrefs,
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
  /** Lot numbers, comma separated; null on a report without a lot filter. */
  lots: string | null;
  /** Saldo Stok: a row per lot rather than per place; null on the other reports. */
  showLots: boolean | null;
  groupBy: StockGroupBy;
  /** The applied run under each grouping: the toggle navigates, it does not wait for Tampilkan. */
  groupHrefs: Record<StockGroupBy, string>;
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
  const [lotText, setLotText] = useState(lots ?? "");
  const [withLots, setWithLots] = useState(showLots ?? false);
  const [day, setDay] = useState(asOf);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);

  const invalidRange = mode === "period" && isInvalidRange(start, end);
  const missing = itemRequired && itemSet.length === 0;

  const run = () => {
    if (invalidRange || missing) return;
    const where = grouped
      ? { group: groupBy, items: itemSet.join(","), warehouses: warehouseSet.join(","), lots: lots === null ? null : lotText.trim(), showLots: withLots ? 1 : null }
      : { item: itemSet[0] ?? null };
    startTransition(() => {
      router.push(reportHref(slug, mode === "asof" ? { ...where, asOf: day } : { ...where, from: start, to: end }));
    });
  };
  useReportRun(run, {
    blocked: invalidRange || missing,
    hint: invalidRange ? INVALID_RANGE_HINT : "Pilih Barang terlebih dahulu.",
    pending,
  });

  return (
    <>
      {grouped ? (
        <>
          <div className="rrow">
            <RunToggle
              label="Kelompok"
              value={groupBy}
              options={[
                { value: "item", label: "Per Barang", href: groupHrefs.item },
                { value: "warehouse", label: "Per Gudang", href: groupHrefs.warehouse },
              ]}
            />
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
          {lots !== null && (
            <div className="rrow">
              <span className="rl">Lot</span>
              <div className="rf wide">
                <input
                  className="inp mono"
                  value={lotText}
                  placeholder="Semua lot"
                  title="Beberapa nomor lot dipisah koma"
                  aria-label="Lot"
                  onChange={(e) => setLotText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") run();
                  }}
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
      {mode === "asof" ? (
        <div className="rrow">
          <span className="rl">Per Tanggal</span>
          <div className="rf date">
            <DateInput value={day} onChange={setDay} ariaLabel="Per tanggal" />
          </div>
        </div>
      ) : (
        <PeriodRow start={start} end={end} onStart={setStart} onEnd={setEnd} />
      )}
      {showLots !== null && (
        <div className="rrow">
          <label className="chk sm">
            <input type="checkbox" checked={withLots} onChange={(e) => setWithLots(e.target.checked)} />
            <span>
              <span className="ct">Tampilkan No. Stok</span>
            </span>
          </label>
        </div>
      )}
    </>
  );
}
