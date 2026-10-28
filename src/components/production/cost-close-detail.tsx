"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JournalPreview } from "@/components/ui/journal-preview";
import { useToast } from "@/components/ui/toast";
import { previewCostCloseAction, runCostCloseAction } from "@/app/actions/production-close";
import { formatDate, formatMoney } from "@/lib/format";
import type { CloseStored, CloseView } from "@/lib/erp/production-close";

const KIND_TEXT: Record<string, string> = { Wip: "WIP (barang dalam proses)", Stock: "Persediaan", Hpp: "HPP", Scrap: "Beban pemusnahan" };
const money = (n: number) => <span className="mny">{formatMoney(n, "IDR")}</span>;

function CardHead({ icon, title, hint }: { icon: "coin" | "check" | "layers" | "book"; title: string; hint: string }) {
  return (
    <div className="card-h">
      <span className="ci">
        <Icon name={icon} size={15} />
      </span>
      <div className="ct">
        <h3>{title}</h3>
        <p>{hint}</p>
      </div>
    </div>
  );
}

/**
 * One period's close (P172): the checklist, the figures it will write — or wrote —
 * and the one button. The confirmation shows the journal from a dry run of the
 * close itself (P103); the button stays disabled while a blocker stands.
 */
export function CostCloseDetail({ view, stored, canRun }: { view: CloseView; stored: CloseStored | null; canRun: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const run = async () => {
    setBusy(true);
    const r = await runCostCloseAction(view.periodId);
    setBusy(false);
    setOpen(false);
    if (!r.ok) toast("Tidak dapat ditutup", r.errors._form, "err");
    else toast(r.message, view.periodName, "ok");
  };

  const pools = stored ? stored.pools : view.pools.map((p) => ({ costCenterLabel: p.costCenterLabel, itemLabel: p.itemLabel, actual: p.actual, standard: p.standard, overhead: p.overhead, leftover: p.leftover }));
  const shares = stored ? stored.shares : view.shares.map((s) => ({ runNo: s.runNo, driver: s.driver, amount: s.amount }));
  const dests = stored ? stored.dests : view.dests.map((d) => ({ kind: d.kind, itemLabel: d.itemLabel, amount: d.amount }));
  const total = stored ? stored.leftoverTotal : view.absorbed;

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <span>Penutupan Biaya</span>
          <span>/</span>
          <span className="cur">{view.periodName}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="lock" size={16} />
            </span>
            <span className="docno">{view.periodName}</span>
            <span className={`bdg ${view.costed ? "s-ok" : "s-mute"}`}>{view.costed ? "Biaya ditutup" : "Belum ditutup"}</span>
          </h1>
          <div className="ph-act">
            {view.costed ? (
              <span className="lockchip">
                <Icon name="lock" size={13} /> Periode terkunci
              </span>
            ) : (
              canRun && (
                <button
                  className="btn primary"
                  disabled={busy || view.blockers.length > 0}
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
          {formatDate(view.start)} – {formatDate(view.end)}
        </p>
      </div>

      {!view.costed && (
        <div className="card">
          <CardHead icon="check" title="Checklist" hint="Semua harus terpenuhi sebelum biaya periode dapat ditutup." />
          {view.blockers.length ? (
            <ul className="optlist" style={{ padding: "0 16px 14px" }}>
              {view.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="hint" style={{ padding: "0 16px 14px" }}>
              Tidak ada yang menghalangi.
            </p>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <CardHead icon="coin" title="Sisa Biaya per Cost Center" hint="Biaya sebenarnya dikurangi standar yang sudah dibebankan eksekusi; overhead disebar rata ke Cost Center yang berproduksi." />
        {pools.length ? (
          <div className="tw">
            <table className="grid" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Cost Center</th>
                  <th>Standard Cost Item</th>
                  <th className="num" style={{ width: 140 }}>
                    Biaya Sebenarnya
                  </th>
                  <th className="num" style={{ width: 140 }}>
                    Standar Dibebankan
                  </th>
                  <th className="num" style={{ width: 140 }}>
                    Overhead
                  </th>
                  <th className="num" style={{ width: 150 }}>
                    Sisa
                  </th>
                </tr>
              </thead>
              <tbody>
                {pools.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <span className="lab">{p.costCenterLabel}</span>
                    </td>
                    <td>{p.itemLabel}</td>
                    <td className="num">{money(p.actual)}</td>
                    <td className="num">{money(p.standard)}</td>
                    <td className="num">{p.overhead ? money(p.overhead) : <span className="dash">—</span>}</td>
                    <td className="num">{money(p.leftover)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty sm">
            <h4>Tidak ada biaya pada Cost Center produksi</h4>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <CardHead icon="layers" title="Bagian tiap Eksekusi" hint="Sisa dibagi menurut Driver, lalu diteruskan ke output dan ke tempat nilainya berada." />
        {shares.length ? (
          <div className="tw">
            <table className="grid" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Eksekusi</th>
                  <th className="num" style={{ width: 160 }}>
                    Driver
                  </th>
                  <th className="num" style={{ width: 180 }}>
                    Bagian
                  </th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => (
                  <tr key={s.runNo}>
                    <td>
                      <span className="lab">{s.runNo}</span>
                    </td>
                    <td className="num">{s.driver}</td>
                    <td className="num">{money(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty sm">
            <h4>Tidak ada eksekusi pada periode ini</h4>
            <p>Sisa biaya, bila ada, seluruhnya ke HPP.</p>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <CardHead icon="book" title="Tujuan Biaya" hint="Tempat nilai berada saat penutupan dijalankan: WIP, persediaan, HPP atau scrap." />
        {dests.length ? (
          <div className="tw">
            <table className="grid" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ width: 240 }}>Tujuan</th>
                  <th>Barang</th>
                  <th className="num" style={{ width: 180 }}>
                    Jumlah
                  </th>
                </tr>
              </thead>
              <tbody>
                {dests.map((d, i) => (
                  <tr key={i}>
                    <td>{KIND_TEXT[d.kind] ?? d.kind}</td>
                    <td>{d.itemLabel ? <span className="lab">{d.itemLabel}</span> : <span className="dash">—</span>}</td>
                    <td className="num">{money(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total dibebankan</td>
                  <td className="num">{money(total)}</td>
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

      {open && (
        <ConfirmDialog
          open
          wide
          icon="lock"
          tone="danger"
          title="Tutup biaya periode?"
          subject={view.periodName}
          body="Sisa biaya dibebankan ke WIP, stok, HPP dan scrap, dan periode dikunci untuk posting stok, produksi dan biaya. Tindakan ini tidak dapat dibatalkan. Journal yang akan ditulis:"
          confirmLabel="Ya, Tutup"
          confirmTone="solid-danger"
          busy={busy}
          confirmDisabled={!ready}
          onConfirm={run}
          onCancel={() => setOpen(false)}
        >
          <JournalPreview load={() => previewCostCloseAction(view.periodId)} onReady={setReady} />
        </ConfirmDialog>
      )}
    </>
  );
}
