"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon, type IconName } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { useToast } from "@/components/ui/toast";
import { previewCostCloseAction, runCostCloseAction } from "@/app/actions/production-close";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import type { ClosePreview, CostingView, StoredClose } from "@/lib/erp/production-close";

const KIND_TEXT: Record<string, string> = { Wip: "WIP (barang dalam proses)", Stock: "Persediaan", Hpp: "HPP", Scrap: "Beban Pemusnahan" };
const money = (n: number) => <span className="mny">{formatMoney(n, "IDR")}</span>;
const qty = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

function CardHead({ icon, title, hint, aside }: { icon: IconName; title: string; hint: string; aside?: React.ReactNode }) {
  return (
    <div className="card-h">
      <span className="ci">
        <Icon name={icon} size={15} />
      </span>
      <div className="ct">
        <h3>{title}</h3>
        <p>{hint}</p>
      </div>
      {aside}
    </div>
  );
}

/** The four figure cards of a close — pool, shares, destinations, items (R25) — before it runs or as stored. */
export function CostingCards({ view }: { view: CostingView }) {
  return (
    <>
      <div className="card" style={{ marginTop: 14 }}>
        <CardHead icon="coin" title="Biaya Produksi Periode" hint="Debit bersih pada account yang dipakai Jenis Biaya, dari journal mana pun (R10)." aside={money(view.poolTotal)} />
        {view.pools.length ? (
          <div className="tw">
            <table className="grid" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="num" style={{ width: 180 }}>
                    Jumlah
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.pools.map((p) => (
                  <tr key={p.accountLabel}>
                    <td>
                      <span className="idc">
                        <span className="lab">{p.accountLabel}</span>
                        <span className="nm">{p.accountName}</span>
                      </span>
                    </td>
                    <td className="num">{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty sm">
            <h4>Tidak ada biaya produksi pada periode ini</h4>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <CardHead icon="gear" title="Bagian per Eksekusi" hint="Biaya dibagi ke eksekusi yang diposting pada periode ini menurut Driver (R11). Tanpa eksekusi, seluruhnya ke HPP (R14)." />
        {view.shares.length ? (
          <div className="tw">
            <table className="grid" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>Eksekusi</th>
                  <th className="num" style={{ width: 140 }}>
                    Driver
                  </th>
                  <th className="num" style={{ width: 180 }}>
                    Bagian
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.shares.map((s) => (
                  <tr key={s.executionId}>
                    <td>
                      <Link className="mono" href={`/production/execution/${s.executionId}`}>
                        {s.executionNo}
                      </Link>
                    </td>
                    <td className="num">
                      <span className="mny">{qty(s.driver)}</span>
                    </td>
                    <td className="num">{money(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty sm">
            <h4>Tidak ada eksekusi yang diposting pada periode ini</h4>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <CardHead icon="layers" title="Dibebankan ke" hint="Bagian tiap eksekusi mengikuti lotnya menurut jumlah sampai posisinya saat penutupan dijalankan (R12)." />
        {view.dests.length ? (
          <div className="tw">
            <table className="grid" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ width: 220 }}>Tujuan</th>
                  <th>Barang</th>
                  <th style={{ width: 160 }}>Account</th>
                  <th className="num" style={{ width: 180 }}>
                    Jumlah
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.dests.map((d, i) => (
                  <tr key={i}>
                    <td>{KIND_TEXT[d.kind] ?? d.kind}</td>
                    <td>{d.itemLabel ? <span className="lab">{d.itemLabel}</span> : <span className="dash">—</span>}</td>
                    <td>{d.accountLabel ? <span className="lab">{d.accountLabel}</span> : <span className="dash">—</span>}</td>
                    <td className="num">{money(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total — kredit Biaya Produksi Dibebankan</td>
                  <td className="num">{money(view.dests.reduce((a, d) => a + d.amount, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="empty sm">
            <h4>Tidak ada biaya yang dibebankan</h4>
          </div>
        )}
      </div>

      {view.items.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <CardHead icon="box" title="Barang Masuk Persediaan" hint="Bagian yang sampai di persediaan dibagi menurut barang tersedia: yang keluar periode ini ke HPP, sisanya menaikkan nilai persediaan (R25)." />
          <div className="tw">
            <table className="grid" style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  <th>Barang</th>
                  <th className="num" style={{ width: 110 }}>Awal</th>
                  <th className="num" style={{ width: 110 }}>Masuk</th>
                  <th className="num" style={{ width: 110 }}>Keluar</th>
                  <th className="num" style={{ width: 110 }}>Akhir</th>
                  <th className="num" style={{ width: 150 }}>Nilai Sebelum</th>
                  <th className="num" style={{ width: 140 }}>Ke HPP</th>
                  <th className="num" style={{ width: 140 }}>Ke Persediaan</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((i) => (
                  <tr key={i.itemLabel}>
                    <td>
                      <span className="idc">
                        <span className="lab">{i.itemLabel}</span>
                        <span className="nm">{i.itemName}</span>
                      </span>
                    </td>
                    <td className="num">
                      <span className="mny">{qty(i.openingQty)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{qty(i.inflowQty)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{qty(i.outflowQty)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{qty(i.endingQty)}</span>
                    </td>
                    <td className="num">{money(i.valueBefore)}</td>
                    <td className="num">{money(i.hpp)}</td>
                    <td className="num">{money(i.stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * One period's close (P210): the checklist, the figures it will write — or
 * wrote — and the one button. The confirmation shows the journal from a dry
 * run of the close itself (P103); the button stays disabled while a blocker
 * stands.
 */
export function CostCloseDetail({ preview, stored, periodId, canRun }: { preview: ClosePreview | null; stored: StoredClose | null; periodId: number; canRun: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const head = (stored ?? preview)!;
  const costed = Boolean(stored);

  const run = async () => {
    setBusy(true);
    const r = await runCostCloseAction(periodId);
    setBusy(false);
    setOpen(false);
    if (!r.ok) toast("Tidak dapat ditutup", r.errors._form, "err");
    else toast(r.message, head.periodName, "ok");
  };

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <Link href="/production/cost-close">Penutupan Biaya</Link>
          <span>/</span>
          <span className="cur">{head.periodName}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="lock" size={16} />
            </span>
            <span className="docno">{head.periodName}</span>
            <span className={`bdg ${costed ? "s-ok" : "s-mute"}`}>{costed ? "Biaya ditutup" : "Belum ditutup"}</span>
          </h1>
          <div className="ph-act">
            {costed ? (
              <span className="lockchip">
                <Icon name="lock" size={13} /> Periode terkunci
              </span>
            ) : (
              canRun && (
                <button
                  className="btn primary"
                  disabled={busy || (preview?.blockers.length ?? 0) > 0}
                  onClick={() => {
                    setReady(false);
                    setOpen(true);
                  }}
                >
                  <Icon name="lock" size={15} /> Tutup Biaya Periode
                </button>
              )
            )}
          </div>
        </div>
        <p className="ph-sub">
          {formatDate(head.start)} – {formatDate(head.end)}
          {stored ? ` · ditutup ${formatDate(stored.createdAt.slice(0, 10))}, journal bertanggal ${formatDate(stored.closeDate)}` : ""}
        </p>
      </div>

      {preview && (
        <div className="card">
          <CardHead icon="check" title="Checklist" hint="Semua harus terpenuhi sebelum biaya periode dapat ditutup." />
          {preview.blockers.length ? (
            <ul style={{ margin: 0, padding: "0 16px 14px 34px" }}>
              {preview.blockers.map((b) => (
                <li key={b} className="hint">
                  {b}
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint" style={{ padding: "0 16px 14px" }}>
              Tidak ada yang menghalangi.
            </p>
          )}
        </div>
      )}

      <CostingCards view={stored ?? preview!.view} />

      {open && preview && (
        <ConfirmDialog
          open
          wide
          icon="lock"
          tone="danger"
          title="Tutup biaya periode?"
          subject={head.periodName}
          body="Biaya produksi periode ini dibebankan ke WIP, persediaan, HPP dan pemusnahan, dan periode dikunci untuk posting stok, produksi dan account biaya produksi. Tindakan ini tidak dapat dibatalkan. Journal yang akan ditulis:"
          confirmLabel="Ya, Tutup"
          confirmTone="solid-danger"
          busy={busy}
          confirmDisabled={!ready}
          onConfirm={run}
          onCancel={() => setOpen(false)}
        >
          <JournalPreview load={() => previewCostCloseAction(periodId)} onReady={setReady} />
        </ConfirmDialog>
      )}
    </>
  );
}
