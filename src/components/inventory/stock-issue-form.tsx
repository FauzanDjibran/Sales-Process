"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CancelButton } from "@/components/ui/cancel-button";
import { Combobox } from "@/components/ui/combobox";
import { DateInput } from "@/components/ui/date-input";
import { Field, FormBody, FormRow, FormSection } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { DeliveryNoteLotPicker, type LotPick } from "@/components/inventory/delivery-note-lot-picker";
import { StockIssueActions } from "@/components/inventory/stock-issue-actions";
import { createStockIssueAction, updateStockIssueAction } from "@/app/actions/stock-issue";
import { DEFAULT_STOCK_ISSUE_PURPOSE, stockIssuePurpose } from "@/lib/erp/stock-issue-purposes";
import { requirementKey } from "@/lib/erp/production-order-shape";
import { STOCK_ISSUE_STATUS_BADGE, STOCK_ISSUE_STATUS_TEXT, stockIssueIsPosted, type StockIssueAbilities } from "@/lib/erp/stock-issue-workflow";
import type { StockIssueHeaderInput, StockIssueOptions, StockIssueView } from "@/lib/erp/stock-issue";
import { formatDate, formatMoney, formatNumber, formatPrice, todayIso } from "@/lib/format";

/**
 * A Stock Issue in all three modes: `new`, `edit` (Draft only) and `view`
 * (P158; `production_project.md` §9.3).
 *
 * The user names the warehouse the goods leave, the workstation they are
 * placed at and the day; then each item in its base unit and, since every item
 * here is kept by lot, the lots it leaves from — the Delivery Note's picker.
 * Changing the warehouse clears the picks, which are lots of that warehouse.
 * Once posted, each line shows the moving-average cost it left at and the value
 * moved to WIP.
 *
 * As the Logistik BSTB (Walet step 3) it may be raised from an Open Perintah
 * Produksi: picking one fills the lines with what the workstation still needs
 * of its requirements (P165) — sent to its first station unless another is
 * chosen; *Isi dari Perintah* fills again for the station now chosen. The
 * Perintah names no lot: the lots are picked here.
 */

export type StockIssueMode = "new" | "edit" | "view";

type LineState = { key: string; item_id: number | null; qty: string; picks: LotPick[] };

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${seq++}`;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const money = (n: number) => formatMoney(n, "IDR");
const blankLine = (): LineState => ({ key: newKey(), item_id: null, qty: "", picks: [] });

export function StockIssueForm({
  mode,
  issue,
  options,
  can,
}: {
  mode: StockIssueMode;
  issue: StockIssueView | null;
  options: StockIssueOptions;
  can: StockIssueAbilities;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = mode !== "view";
  const itemById = useMemo(() => new Map(options.items.map((i) => [i.id, i])), [options.items]);

  const [header, setHeader] = useState<StockIssueHeaderInput>(() =>
    issue
      ? { ...issue.header }
      : { purpose: DEFAULT_STOCK_ISSUE_PURPOSE, warehouse_id: null, workstation_id: null, issue_date: todayIso(), note: "", order_id: null }
  );
  const [lines, setLines] = useState<LineState[]>(() =>
    issue
      ? issue.lines.map((l) => ({
          key: newKey(),
          item_id: Number(l.item_id),
          qty: String(l.qty),
          picks: (l.picks ?? []).map((p) => ({ lot_id: Number(p.lot_id), location_id: p.location_id ?? null, qty: String(p.qty) })),
        }))
      : [blankLine()]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lotsFor, setLotsFor] = useState<string | null>(null);

  const posted = issue ? stockIssueIsPosted(issue.status) : false;
  const warehouse = options.warehouses.find((w) => w.id === header.warehouse_id);
  const workstation = options.workstations.find((w) => w.id === header.workstation_id);
  const lotsOf = (itemId: number | null) => (header.warehouse_id && itemId ? (options.lots[header.warehouse_id]?.[itemId] ?? []) : []);

  const touch = (...names: string[]) => {
    setDirty(true);
    setErrors((e) => {
      const next = { ...e };
      for (const n of names) delete next[n];
      return next;
    });
  };
  const set = <K extends keyof StockIssueHeaderInput>(k: K, v: StockIssueHeaderInput[K]) => {
    setHeader((x) => ({ ...x, [k]: v }));
    touch(k);
  };
  const setLine = (key: string, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch("_lines");
  };
  /**
   * A Perintah names no lot (P165): its requirements say what each station
   * needs. Filling from it puts on the page what the chosen workstation still
   * needs — its requirements less what BSTBs already sent there — with no lot
   * picked; the user picks lots (or *Isi FEFO*) and may add or remove lines.
   */
  const fillFromOrder = (orderId: number, workstationId: number | null) => {
    const order = options.orders.find((o) => o.id === orderId);
    if (!order) return;
    const sent = options.sent[orderId] ?? {};
    const lines: LineState[] = [];
    for (const r of order.requirements) {
      if (r.workstationId !== workstationId) continue;
      const left = Math.round(r.qty * 10_000) - Math.round((sent[requirementKey(r.itemId, r.workstationId)] ?? 0) * 10_000);
      if (left <= 0) continue;
      const had = lines.find((l) => l.item_id === r.itemId);
      if (had) had.qty = String((Math.round(Number(had.qty) * 10_000) + left) / 10_000);
      else lines.push({ key: newKey(), item_id: r.itemId, qty: String(left / 10_000), picks: [] });
    }
    setLines(lines.length ? lines : [blankLine()]);
    touch("_lines");
  };
  /** Picking a Perintah sends to its first station unless one is chosen, and fills from it. Clearing it keeps the page. */
  const pickOrder = (id: number | null) => {
    setHeader((x) => ({ ...x, order_id: id }));
    touch("order_id");
    const order = id ? options.orders.find((o) => o.id === id) : undefined;
    if (!order) return;
    const ws = header.workstation_id ?? order.firstWorkstationId;
    setHeader((x) => ({ ...x, order_id: id, workstation_id: ws }));
    touch("workstation_id");
    fillFromOrder(order.id, ws);
  };
  /** Lots belong to a warehouse: another warehouse clears every pick. */
  const pickWarehouse = (id: number | null) => {
    setHeader((x) => ({ ...x, warehouse_id: id }));
    if (id !== header.warehouse_id) setLines((ls) => ls.map((l) => ({ ...l, picks: [] })));
    touch("warehouse_id", "_lines");
  };

  async function onSave() {
    setSaving(true);
    const sent = lines;
    const payload = sent.map((l) => ({ item_id: l.item_id, qty: l.qty, note: "", picks: l.picks }));
    const result = mode === "edit" ? await updateStockIssueAction(issue!.id, header, payload) : await createStockIssueAction(header, payload);
    setSaving(false);
    if (!result.ok) {
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.errors)) {
        const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
        if (m) mapped[`lines.${sent[Number(m[1])]?.key}.${m[2]}`] = v;
        else mapped[k] = v;
      }
      setErrors(mapped);
      toast(result.errors._form ? "Tidak diizinkan" : "Belum bisa disimpan", result.errors._form ?? result.errors._lines ?? "Periksa kembali isian.", "err");
      return;
    }
    setDirty(false);
    toast("Stock Issue disimpan", `${result.issueNo} · Draft`, "ok");
    router.push(`/inventory/stock-issue/${result.id}`);
  }

  const status = issue?.status ?? "Draft";
  const backHref = issue ? `/inventory/stock-issue/${issue.id}` : "/inventory/stock-issue";
  const ro = (node: React.ReactNode) => <div className="ro">{node}</div>;
  const nil = (t = "tidak diisi") => <div className="ro nil">{t}</div>;
  const lineErr = (key: string, f: string) => errors[`lines.${key}.${f}`];
  const place = (p: { label: string; name: string } | undefined) =>
    p ? (
      ro(
        <>
          <span className="lab">{p.label}</span>
          <span>{p.name}</span>
        </>
      )
    ) : (
      nil()
    );

  // ======================================================= header card
  const headerCard = (
    <div className="card">
      <FormBody>
        <FormSection title="Pengeluaran">
          <FormRow>
            <Field
              label="Perintah Produksi"
              span={6}
              help={editing ? "opsional — mengisi barang yang dibutuhkan workstation" : undefined}
              error={errors.order_id}
            >
              {editing ? (
                <Combobox
                  value={header.order_id ?? 0}
                  // 0 is "no Perintah" (O4): packaging sent straight to a station needs none.
                  options={[
                    { id: 0, label: "", name: "Tanpa Perintah", active: true },
                    ...options.orders
                      .filter((o) => o.open || o.id === header.order_id)
                      .map((o) => ({ id: o.id, label: o.orderNo, name: `${o.targetLabel} · ${o.targetName}`, active: o.open })),
                  ]}
                  placeholder="Pilih Perintah Produksi…"
                  invalid={Boolean(errors.order_id)}
                  onChange={(v) => pickOrder(v || null)}
                />
              ) : issue?.orderNo && header.order_id ? (
                ro(
                  <Link className="drl" href={`/production/order/${header.order_id}`}>
                    <span className="mono">{issue.orderNo}</span>
                  </Link>
                )
              ) : (
                nil("tanpa Perintah")
              )}
            </Field>
          </FormRow>
          <FormRow>
            <Field label="Tujuan" span={4} locked={editing} help={editing ? "menentukan ke mana barang dan jurnalnya" : undefined}>
              {ro(stockIssuePurpose(header.purpose ?? DEFAULT_STOCK_ISSUE_PURPOSE)?.name ?? header.purpose)}
            </Field>
            <Field label="Tanggal" span={3} required={editing} help={editing ? "hari barang keluar" : undefined} error={errors.issue_date}>
              {editing ? (
                <DateInput value={header.issue_date} invalid={Boolean(errors.issue_date)} onChange={(v) => set("issue_date", v)} />
              ) : (
                ro(formatDate(header.issue_date))
              )}
            </Field>
            {posted && (
              <Field label="Journal" span={5}>
                {issue?.journalId
                  ? ro(
                      <Link className="drl" href={`/accounting/journal/${issue.journalId}`}>
                        <span className="mono">{issue.journalNo}</span>
                      </Link>
                    )
                  : nil("tanpa nilai, tanpa journal")}
              </Field>
            )}
          </FormRow>
          <FormRow>
            <Field label="Gudang" span={6} required={editing} help={editing ? "asal barang" : undefined} error={errors.warehouse_id}>
              {editing ? (
                <Combobox
                  value={header.warehouse_id}
                  options={options.warehouses.filter((w) => w.active || w.id === header.warehouse_id)}
                  placeholder="Pilih Gudang…"
                  invalid={Boolean(errors.warehouse_id)}
                  onChange={pickWarehouse}
                />
              ) : (
                place(warehouse)
              )}
            </Field>
            <Field label="Workstation" span={6} required={editing} help={editing ? "tempat barang masuk produksi" : undefined} error={errors.workstation_id}>
              {editing ? (
                <Combobox
                  value={header.workstation_id}
                  options={options.workstations.filter((w) => w.active || w.id === header.workstation_id)}
                  placeholder="Pilih Workstation…"
                  emptyText="Belum ada Workstation yang aktif."
                  invalid={Boolean(errors.workstation_id)}
                  onChange={(v) => set("workstation_id", v)}
                />
              ) : (
                place(workstation)
              )}
            </Field>
            <Field label="Catatan" span={12}>
              {editing ? (
                <textarea className="ta" rows={2} value={header.note} placeholder="Catatan pengeluaran…" onChange={(e) => set("note", e.target.value)} />
              ) : header.note ? (
                <div className="ro multi">{header.note}</div>
              ) : (
                <div className="ro multi nil">tidak diisi</div>
              )}
            </Field>
          </FormRow>
        </FormSection>
        {issue?.cancelReason && status === "Cancelled" && (
          <p className="fnote">
            <b>Dibatalkan:</b> {issue.cancelReason}
          </p>
        )}
        {status === "Posted" && (
          <p className="fnote">
            <b>Dalam perjalanan</b> ke {workstation?.label ?? "Workstation"} — belum dapat dikerjakan sampai diterima.
          </p>
        )}
        {status === "Received" && issue?.receivedDate && (
          <p className="fnote">
            <b>Diterima</b> di {workstation?.label ?? "Workstation"} pada {formatDate(issue.receivedDate)}.
          </p>
        )}
        {status === "Rejected" && issue && (
          <p className="fnote">
            <b>Ditolak</b>
            {issue.receivedDate ? ` pada ${formatDate(issue.receivedDate)}` : ""}: {issue.rejectReason} — barang kembali ke {warehouse?.label ?? "gudang"}
            {issue.returnJournalId ? (
              <>
                {" "}
                dengan journal{" "}
                <Link className="drl" href={`/accounting/journal/${issue.returnJournalId}`}>
                  <span className="mono">{issue.returnJournalNo}</span>
                </Link>
              </>
            ) : null}
            .
          </p>
        )}
      </FormBody>
    </div>
  );

  // ======================================================== lines card
  const addButton = (cta?: boolean) => (
    <button
      className={`btn sm primary${cta ? " cta" : ""}`}
      onClick={() => {
        setLines((ls) => [...ls, blankLine()]);
        touch("_lines");
      }}
    >
      <Icon name="plus" size={14} /> Tambah Baris
    </button>
  );
  const viewLines = issue?.lines ?? [];

  const lotCell = (l: LineState, stored?: StockIssueView["lines"][number]) => {
    const item = l.item_id ? itemById.get(l.item_id) : undefined;
    if (!item) return <span className="dash">—</span>;
    const lineQty = Number(String(l.qty).replace(",", ".")) || 0;
    const picked = l.picks.reduce((s, p) => s + Math.round(Number(p.qty) * 10_000), 0) / 10_000;
    const full = lineQty > 0 && Math.abs(picked - lineQty) < 1e-9;
    if (editing) {
      const why = !header.warehouse_id ? "Pilih Gudang dulu…" : lineQty > 0 ? undefined : "Isi Qty dulu";
      return (
        <>
          <button className="btn sm" disabled={Boolean(why)} title={why} onClick={() => setLotsFor(l.key)}>
            <Icon name="layers" size={14} /> {l.picks.length ? `${l.picks.length} lot` : "Pilih Lot"}
          </button>
          <span className={full ? "fulltag" : "overtag"}>
            {why ? why.toLowerCase() : `${qtyText(picked)} / ${qtyText(lineQty)} ${item.uomLabel}${full ? "" : " · belum penuh"}`}
          </span>
        </>
      );
    }
    const lots = stored?.pickedLots ?? [];
    if (!lots.length) return <span className="overtag">Belum dipilih</span>;
    return (
      <span className="dstack" style={{ gap: 4 }}>
        {lots.map((p) => (
          <span key={`${p.lotId}:${p.locationId ?? 0}`} className="dstack">
            <span className="lab" title={p.lotNo}>
              {p.lotNo}
            </span>
            <span className="d2">
              {qtyText(p.qty)} {item.uomLabel}
              {p.expiry ? ` · ED ${formatDate(p.expiry)}` : ""}
              {p.locationLabel ? ` · ${p.locationLabel}` : ""}
            </span>
          </span>
        ))}
        {!posted && !full && (
          <span className="overtag">
            {qtyText(picked)} dari {qtyText(lineQty)} · belum penuh
          </span>
        )}
      </span>
    );
  };

  const linesCard = (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Barang Keluar</h3>
          <p>
            {editing
              ? "Pilih barang dan jumlahnya dalam satuan dasar, lalu lot asalnya. Lot tetap bernomor sama di produksi."
              : posted
                ? "Jumlah yang keluar dan lotnya, dengan harga pokok rata-rata saat diposting dan nilai yang dipindahkan ke WIP."
                : "Jumlah per barang dalam satuan dasar dan lot yang dipilih."}
          </p>
        </div>
        {editing && header.order_id && (
          <button
            className="btn sm"
            disabled={!header.workstation_id}
            title={header.workstation_id ? undefined : "Pilih Workstation dulu…"}
            onClick={() => fillFromOrder(header.order_id!, header.workstation_id)}
          >
            <Icon name="clip" size={14} /> Isi dari Perintah
          </button>
        )}
        {editing && lines.length > 0 && addButton()}
      </div>
      {errors._lines && (
        <div className="nbox bad slim">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>{errors._lines}</b>
          </div>
        </div>
      )}
      {lines.length === 0 ? (
        <div className="empty sm">
          <div className="ic">
            <Icon name="box" size={18} />
          </div>
          <h4>Belum ada barang</h4>
          <p>Hanya Barang dengan Kelola Stok yang keluar ke produksi, per lot.</p>
          {editing && addButton(true)}
        </div>
      ) : (
        <div className="tw">
          <table className="grid ltab" style={{ minWidth: posted ? 900 : 860 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Barang</th>
                <th style={{ width: editing ? 220 : 110 }}>Qty</th>
                <th style={{ width: editing ? 180 : 200 }}>Lot</th>
                {posted && (
                  <>
                    <th className="num" style={{ width: 120 }}>
                      Harga Pokok
                    </th>
                    <th className="num" style={{ width: 140 }}>
                      Nilai ke WIP
                    </th>
                  </>
                )}
                {editing && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const item = l.item_id ? itemById.get(l.item_id) : undefined;
                const available = lotsOf(l.item_id).reduce((s, x) => s + x.available, 0);
                const typed = Number(String(l.qty).replace(",", ".")) || 0;
                const over = Boolean(item && header.warehouse_id && typed > available + 1e-9);
                const lineError = lineErr(l.key, "item_id") ?? lineErr(l.key, "qty") ?? lineErr(l.key, "picks");
                const stored = viewLines[i];
                return (
                  <tr key={l.key} className={lineError || over ? "overrow" : undefined}>
                    <td className="no">{i + 1}</td>
                    <td>
                      {editing ? (
                        <Combobox
                          size="sm"
                          value={l.item_id}
                          // Each item once per issue: the others' items are not offered.
                          options={options.items.filter(
                            (o) => (o.active || o.id === l.item_id) && (o.id === l.item_id || !lines.some((x) => x.key !== l.key && x.item_id === o.id))
                          )}
                          placeholder="Pilih Barang…"
                          emptyText="Belum ada Barang dengan Kelola Stok."
                          invalid={Boolean(lineErr(l.key, "item_id"))}
                          onChange={(v) => setLine(l.key, { item_id: v, picks: [] })}
                        />
                      ) : (
                        <span className="idc">
                          <span className="lab">{item?.label}</span>
                          <span className="nm">{item?.name}</span>
                        </span>
                      )}
                      {lineError && <span className="overtag">{lineError}</span>}
                    </td>
                    <td>
                      {editing ? (
                        <>
                          <div className="qcell">
                            <MoneyInput
                              size="sm"
                              decimals={4}
                              value={l.qty}
                              over={over}
                              ariaLabel={`Qty ${item?.label ?? ""}`}
                              onChange={(v) => setLine(l.key, { qty: v })}
                            />
                            <span className="qu">{item?.uomLabel}</span>
                          </div>
                          {item && header.warehouse_id && (
                            <span className={over ? "overtag" : "fulltag"}>
                              tersedia {qtyText(available)} {item.uomLabel}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="qview">
                          <span className="mny">{qtyText(Number(l.qty))}</span>
                          <span className="lab">{item?.uomLabel}</span>
                        </span>
                      )}
                    </td>
                    <td>{lotCell(l, stored)}</td>
                    {posted && (
                      <>
                        <td className="num">
                          <span className="mny">{formatPrice(stored?.unitCost ?? 0)}</span>
                        </td>
                        <td className="num">
                          <span className="mny">{money(stored?.cost ?? 0)}</span>
                        </td>
                      </>
                    )}
                    {editing && (
                      <td>
                        <button
                          className="iact del"
                          title="Hapus baris"
                          onClick={() => {
                            setLines((ls) => ls.filter((x) => x.key !== l.key));
                            touch("_lines");
                          }}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            {posted && (
              <tfoot>
                <tr className="totrow">
                  <td colSpan={5} style={{ textAlign: "right" }}>
                    Total ke WIP
                  </td>
                  <td className="num">
                    <span className="mny">{money(issue?.cost ?? 0)}</span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {lotsFor &&
        (() => {
          const l = lines.find((x) => x.key === lotsFor);
          const item = l?.item_id ? itemById.get(l.item_id) : undefined;
          if (!l || !item) return null;
          return (
            <DeliveryNoteLotPicker
              line={{ itemLabel: item.label, itemName: item.name, uomLabel: item.uomLabel }}
              lots={lotsOf(item.id)}
              lineQty={Number(String(l.qty).replace(",", ".")) || 0}
              current={l.picks}
              shipDate={header.issue_date}
              dateLabel="Tanggal"
              emptyText="Barang ini tidak punya stok tersedia di gudang yang dipilih."
              onApply={(picks) => {
                setLine(l.key, { picks });
                touch(`lines.${l.key}.picks`);
                setLotsFor(null);
              }}
              onClose={() => setLotsFor(null)}
            />
          );
        })()}
    </div>
  );

  // ============================================================ page
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Persediaan</span>
          <span>/</span>
          <Link href="/inventory/stock-issue">Stock Issue</Link>
          <span>/</span>
          <span className="cur">{issue ? issue.issueNo : "Baru"}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="layers" size={16} />
            </span>
            {issue ? (
              <>
                <span className="docno">{issue.issueNo}</span>
                <span className={`bdg ${STOCK_ISSUE_STATUS_BADGE[status]}`}>{STOCK_ISSUE_STATUS_TEXT[status]}</span>
              </>
            ) : (
              "Stock Issue Baru"
            )}
            {mode === "edit" && <span className="bdg t-warn">Mode Ubah</span>}
          </h1>
          <div className="ph-act">
            {editing ? (
              <>
                {dirty && (
                  <span className="ph-dirty">
                    <span className="pulse" /> Belum disimpan
                  </span>
                )}
                <CancelButton href={backHref} dirty={dirty} disabled={saving} />
                <button className="btn primary" onClick={onSave} disabled={saving}>
                  <Icon name="save" size={15} /> {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </>
            ) : (
              <StockIssueActions id={issue!.id} subject={issue!.issueNo} status={status} issueDate={issue!.header.issue_date} can={can} />
            )}
          </div>
        </div>
      </div>

      <div className="fgrid solo">
        <div>
          {headerCard}
          {linesCard}
        </div>
      </div>
    </>
  );
}
