"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { chainOf, levelsOf, scopeOf, type Options, type Role, type Target } from "@/lib/erp/db-diagram";
import { APP_TEXT, Aim, Fold, GoLink, Toggle, toggled, useGo } from "./viewer-parts";

const LEVELS: Record<string, [string, string]> = {
  "-2": ["Kakek", "dirujuk oleh induk"],
  "-1": ["Induk", "dirujuk tabel ini"],
  "1": ["Anak", "merujuk tabel ini"],
  "2": ["Cucu", "merujuk anaknya"],
};

/** What the canvas shows, or the chosen table's relations and the menus that use it. */
export function TableInspector({
  target,
  sel,
  onUnselect,
  onReveal,
  options,
  onDepth,
  onHidden,
  onBack,
  onClose,
}: {
  target: Target;
  sel: number | null;
  onUnselect: () => void;
  /** Shows a table in the diagram. */
  onReveal: (i: number) => void;
  options: Options;
  onDepth: (d: number) => void;
  onHidden: (v: Set<number>) => void;
  /** Absent when there is nothing to go back to. */
  onBack?: () => void;
  onClose: () => void;
}) {
  const { model } = useGo();
  const [tab, setTab] = useState<"rel" | "use">("rel");
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set());
  const focus = target.v === "table" ? target.i : sel;
  const close = (
    <button type="button" className="iact" title="Sembunyikan panel" aria-label="Sembunyikan panel" onClick={onClose}>
      <Icon name="block" size={14} />
    </button>
  );

  /** `ids` are the section's tables when its checkbox shows or hides them all in the diagram. */
  const section = (key: string, title: string, help: string, rows: React.ReactNode[], ids?: number[]) => {
    const off = ids?.filter((i) => options.hidden.has(i)).length ?? 0;
    return rows.length > 0 && (
      <div key={key}>
        <div className="dbr-h">
          <Fold open={!shut.has(key)} name={title} onClick={() => setShut(toggled(shut, key))} />
          <b>{title}</b>
          <span className="h">{help}</span>
          <span className="tc">{off ? `${rows.length - off}/${rows.length}` : rows.length}</span>
          {ids && (
            <label className="cbx2" title={off ? `Tampilkan semua ${title}` : `Sembunyikan semua ${title}`}>
              <input
                type="checkbox"
                aria-label={`Tampilkan semua ${title} di diagram`}
                checked={off === 0}
                ref={(el) => {
                  if (el) el.indeterminate = off > 0 && off < ids.length;
                }}
                onChange={() => {
                  // Some or all hidden: show all. None hidden: hide all.
                  const next = new Set(options.hidden);
                  for (const i of ids) if (off) next.delete(i); else next.add(i);
                  onHidden(next);
                }}
              />
            </label>
          )}
        </div>
        {!shut.has(key) && <div className="dbr-l">{rows}</div>}
      </div>
    );
  };

  const row = (i: number, lines: string[], hides: boolean) => {
    const off = hides && options.hidden.has(i);
    return (
    <div
      key={i}
      className={`dbr${sel === i ? " on" : ""}${off ? " off" : ""}`}
      role="button"
      tabIndex={0}
      title={off ? `${model.tables[i].name} disembunyikan dari diagram` : `Tunjukkan ${model.tables[i].name} di diagram`}
      onClick={(e) => {
        if (!off && !(e.target as HTMLElement).closest("a,label")) onReveal(i);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        if (!off) onReveal(i);
      }}
    >
      <div className="t">
        <b className="mono">{model.tables[i].name}</b>
        {lines.map((l) => (
          <span className="mono" key={l}>
            {l}
          </span>
        ))}
      </div>
      <Aim i={i} />
      {hides && (
        <label className="cbx2" title={off ? "Tampilkan di diagram" : "Sembunyikan dari diagram"}>
          <input type="checkbox" aria-label={`Tampilkan ${model.tables[i].name} di diagram`} checked={!off} onChange={() => onHidden(toggled(options.hidden, i))} />
        </label>
      )}
    </div>
    );
  };
  const byName = (a: number, b: number) => (model.tables[a].name < model.tables[b].name ? -1 : 1);

  const relations = (f: number) => {
    const level = levelsOf(model, f, options.depth);
    const chain = chainOf(model, level, f);
    // Above the focus a row names the column that points at it; below, its own column.
    const lines = (i: number, d: number) => [
      ...new Set(
        chain
          .filter((l) => (d < 0 ? l.to === i && level.get(l.from) === d + 1 : l.from === i && level.get(l.to) === d - 1))
          .map((l) => (Math.abs(d) === 1 ? l.col : d < 0 ? `${model.tables[l.from].name}.${l.col}` : `${l.col} → ${model.tables[l.to].name}`))
      ),
    ];
    // Hiding belongs to the diagram's own focus, not to a table merely selected in it.
    const hides = target.v === "table";
    const at = (d: number) => {
      const ids = [...level].flatMap(([i, v]) => (v === d ? [i] : [])).sort(byName);
      return section(`l${d}`, ...LEVELS[String(d)], ids.map((i) => row(i, lines(i, d), hides)), hides ? ids : undefined);
    };
    const self = model.out[f].filter((l) => l.to === f);
    return (
      <>
        <div className="dbr-c">
          <span>Kedalaman</span>
          <Toggle
            label="Kedalaman relasi"
            value={String(options.depth)}
            options={[
              { value: "1", label: "1 tingkat" },
              { value: "2", label: "2 tingkat" },
            ]}
            onChange={(v) => onDepth(Number(v))}
          />
        </div>
        <div className="dbp-b" key={f}>
          {at(-2)}
          {at(-1) || <p className="dbr-e">Tidak merujuk tabel lain.</p>}
          <div className="dbr-f">
            <b className="mono">{model.tables[f].name}</b>
            {self.map((l) => (
              <span className="mono" key={l.col}>
                {l.col} → diri sendiri
              </span>
            ))}
          </div>
          {at(1) || <p className="dbr-e">Tidak dirujuk tabel lain.</p>}
          {at(2)}
        </div>
      </>
    );
  };

  const usage = (f: number) => {
    const { w, r } = model.use[f];
    const menu = (i: number) => (
      <GoLink key={i} to={{ v: "menu", i }} className="dbr" title="Lihat diagram menu ini">
        <div className="t">
          <b>{model.menus[i].name}</b>
          <span>
            {APP_TEXT[model.menus[i].app]} · {model.menus[i].module}
          </span>
        </div>
        <Icon name="chev" size={12} />
      </GoLink>
    );
    return (
      <div className="dbp-b" key={f}>
        {section("uw", "Ditulis", "oleh menu", w.map(menu))}
        {section("ur", "Dibaca", "oleh menu", r.map(menu))}
        {w.length + r.length === 0 && <p className="dbr-e">Dipakai sistem, misalnya saat masuk aplikasi.</p>}
        {section(
          "uk",
          "Aturan",
          "dijaga database",
          model.tables[f].rules.map((x) => (
            <div className="dbr st" key={x.kind + x.text}>
              <div className="t">
                <b>{x.kind}</b>
                <span className="mono wrap">{x.text}</span>
              </div>
            </div>
          ))
        )}
      </div>
    );
  };

  const contents = (t: Exclude<Target, { v: "all" }>) => {
    const set = scopeOf(model, t, { ...options, hidden: new Set() });
    const main = t.v === "menu" ? model.menus[t.i].main : -1;
    const part = (role: Role, title: string, help: string) => {
      const ids = [...set].flatMap(([i, r]) => (r === role ? [i] : [])).sort((a, b) => Number(b === main) - Number(a === main) || byName(a, b));
      return section(`r${role}`, title, help, ids.map((i) => row(i, [`${model.out[i].length} merujuk · ${model.in[i].length} dirujuk`], true)), ids);
    };
    return (
      <div className="dbp-b">
        {t.v === "menu" ? (
          <>
            {part("w", "Ditulis", "oleh menu ini")}
            {part("r", "Dibaca", "oleh menu ini")}
            {part("out", "Induk", "dirujuk yang ditulis")}
          </>
        ) : (
          <>
            {part("r", "Tabel", "kelompok ini")}
            {part("out", "Induk", "di kelompok lain")}
          </>
        )}
      </div>
    );
  };

  if (focus === null)
    return (
      <aside className="dbp" aria-label="Panel relasi">
        <div className="dbp-h">
          <div className="t">
            <b>Isi Diagram</b>
            <span>Klik tabel untuk melihat relasinya</span>
          </div>
          {close}
        </div>
        {target.v === "all" ? (
          <div className="dbp-b">
            <p className="dbr-e">Pilih satu tabel di diagram atau di daftar.</p>
          </div>
        ) : (
          contents(target)
        )}
      </aside>
    );

  const t = model.tables[focus];
  const back = target.v === "table" ? onBack : onUnselect;
  const backTitle = target.v === "table" ? "Kembali ke sebelumnya" : "Kembali ke isi diagram";
  return (
    <aside className="dbp" aria-label="Panel relasi">
      <div className="dbp-h">
        {back && (
          <button type="button" className="iact" title={backTitle} aria-label={backTitle} onClick={back}>
            <Icon name="back" size={14} />
          </button>
        )}
        <div className="t">
          <b className="mono" title={t.name}>
            {t.name}
          </b>
          <span>
            {APP_TEXT[t.app]} · {model.groups[t.group].name} · {t.cols.length} kolom
          </span>
        </div>
        {target.v !== "table" && <Aim i={focus} />}
        {close}
      </div>
      <div className="dbp-t">
        <Toggle
          label="Isi panel"
          value={tab}
          options={[
            { value: "rel", label: <>Relasi <i>{model.out[focus].length + model.in[focus].length}</i></> },
            { value: "use", label: <>Dipakai <i>{model.use[focus].w.length + model.use[focus].r.length}</i></> },
          ]}
          onChange={setTab}
        />
      </div>
      {tab === "rel" ? relations(focus) : usage(focus)}
    </aside>
  );
}
