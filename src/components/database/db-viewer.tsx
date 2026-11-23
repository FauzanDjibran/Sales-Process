"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/icon";
import { ExpandAll } from "@/components/ui/expand-all";
import { buildGraph, buildModel, edgesOf, type DbApp, type DbMap, type DbSchema, type Level, type Model, type Target } from "@/lib/erp/db-diagram";
import { DiagramCanvas } from "./diagram-canvas";
import { TableExplorer, type AppFilter, type Arrange } from "./table-explorer";
import { TableInspector } from "./table-inspector";
import { AppTag, GoContext, GoLink, Toggle, hrefOf, toggled } from "./viewer-parts";

/** What the URL names; a name that no longer exists falls back to the first group. */
function targetOf(m: Model, q: URLSearchParams): Target {
  if (q.has("all")) return { v: "all" };
  const table = m.index.get(q.get("table") ?? "");
  if (table !== undefined) return { v: "table", i: table };
  const menu = m.menus.findIndex((x) => x.key === q.get("menu"));
  if (menu >= 0) return { v: "menu", i: menu };
  const start = m.groups.findIndex((g) => g.key === (q.get("group") ?? "erp-penjualan"));
  return { v: "group", i: Math.max(0, start) };
}

export function DbViewer({ schema, map }: { schema: DbSchema; map: DbMap }) {
  const model = useMemo(() => buildModel(schema, map), [schema, map]);
  const params = useSearchParams();
  const query = params.toString();
  const target = useMemo(() => targetOf(model, new URLSearchParams(query)), [model, query]);

  const [app, setApp] = useState<AppFilter>("");
  const [arrange, setArrange] = useState<Arrange>(target.v === "menu" ? "menu" : "group");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [list, setList] = useState(true);
  const [panel, setPanel] = useState(true);
  const [level, setLevel] = useState<Record<Target["v"], Level>>({ all: "name", group: "key", table: "key", menu: "key" });
  const [read, setRead] = useState(false);
  const [hub, setHub] = useState(false);
  const [depth, setDepth] = useState(1);
  const [shut, setShut] = useState<ReadonlySet<number>>(new Set());
  const [sel, setSel] = useState<number | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [reveal, setReveal] = useState<{ i: number } | null>(null);
  /** How many targets were chosen here, so the panel knows it can go back. */
  const [steps, setSteps] = useState(0);

  // A new target starts clean, with its place in the list opened.
  const [seen, setSeen] = useState<string | null>(null);
  if (seen !== query) {
    setSeen(query);
    setSel(null);
    setHidden(new Set());
    setReveal(null);
    if (target.v === "group") setArrange("group");
    if (target.v === "menu") setArrange("menu");
    const branch = target.v === "group" ? `g${target.i}` : target.v === "menu" ? `m${target.i}` : target.v === "table" ? `g${model.tables[target.i].group}` : null;
    if (branch) setOpen(new Set([...open, branch]));
  }

  const go = useCallback(
    (t: Target) => {
      const href = hrefOf(model, t);
      if (href === `${window.location.pathname}${window.location.search}`) return;
      window.history.pushState(null, "", href);
      setSteps((n) => n + 1);
    },
    [model]
  );
  useEffect(() => {
    const onPop = () => setSteps((n) => Math.max(0, n - 1));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const ctx = useMemo(() => ({ model, go }), [model, go]);

  const options = useMemo(() => ({ depth, read, hub, hidden }), [depth, read, hub, hidden]);
  const shownLevel = level[target.v];
  const graph = useMemo(() => buildGraph(model, target, shownLevel, options, (a: DbApp) => !app || a === app || a === "shared", shut), [model, target, shownLevel, options, app, shut]);
  const onFrame = useCallback((id: number) => {
    setShut((s) => toggled(s, id));
    setSel(null);
  }, []);

  const menu = target.v === "menu" ? model.menus[target.i] : null;
  const name = target.v === "all" ? "Semua Tabel" : target.v === "group" ? model.groups[target.i].name : target.v === "table" ? model.tables[target.i].name : model.menus[target.i].name;
  const owner = target.v === "all" ? null : target.v === "group" ? model.groups[target.i].app : target.v === "table" ? model.tables[target.i].app : model.menus[target.i].app;
  const count = graph.frames.length ? graph.frames.reduce((n, f) => n + f.ids.length, 0) : graph.boxes.size;
  const legend: [string, string][] =
    target.v === "table"
      ? [["w", "Fokus"], ["p", "Induk"], ["r", "Anak"]]
      : menu
        ? [...(menu.w.length ? [["w", "Ditulis"] as [string, string]] : []), ...(read || !menu.w.length ? [["r", "Dibaca"] as [string, string]] : []), ...(menu.w.length ? [["o", "Induk"] as [string, string]] : [])]
        : target.v === "group"
          ? [["r", "Kelompok ini"], ["o", "Induk di kelompok lain"]]
          : [];

  return (
    <GoContext.Provider value={ctx}>
      {list && (
        <TableExplorer
          target={target}
          app={app}
          onApp={(v) => {
            setApp(v);
            if (target.v === "all") setSel(null);
          }}
          arrange={arrange}
          onArrange={setArrange}
          open={open}
          onOpen={setOpen}
          onHide={() => setList(false)}
        />
      )}
      <main className="dbm">
        <div className="dbh">
          {!list && (
            <button type="button" className="btn ico" title="Tampilkan daftar tabel" aria-label="Tampilkan daftar tabel" onClick={() => setList(true)}>
              <Icon name="menu" size={15} />
            </button>
          )}
          <div className="dbh-t">
            <Icon name={target.v === "menu" ? "link" : target.v === "table" ? "table" : "layers"} size={15} />
            {target.v === "table" && (
              <span className="path">
                <GoLink to={{ v: "group", i: model.tables[target.i].group }}>{model.groups[model.tables[target.i].group].name}</GoLink> /
              </span>
            )}
            {menu && <span className="path">{menu.module} /</span>}
            <h1 className={target.v === "table" ? "mono" : undefined}>{name}</h1>
            {owner && <AppTag app={owner} />}
            {menu?.hidden && <span className="bdg s-mute">Disembunyikan</span>}
            <span className="count">
              <b>{count}</b> tabel · {edgesOf(model, graph, sel).length} relasi
            </span>
          </div>
          <div className="dbh-a">
            {menu && menu.w.length > 0 && (
              <label className="chk sm" title="Sertakan tabel yang hanya dibaca menu ini">
                <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
                <span className="ct">Tabel dibaca</span>
              </label>
            )}
            {(menu || target.v === "group") && (
              <label className="chk sm" title="Sertakan tabel yang dirujuk hampir semua tabel: Partner, Item, Currency dan sejenisnya">
                <input type="checkbox" checked={hub} onChange={(e) => setHub(e.target.checked)} />
                <span className="ct">Tabel pusat</span>
              </label>
            )}
            {target.v === "all" && (
              <ExpandAll
                allOpen={!shut.size}
                allClosed={graph.frames.every((f) => f.shut)}
                onExpand={() => setShut(new Set())}
                onCollapse={() => {
                  setShut(new Set(model.groups.map((_, i) => i)));
                  setSel(null);
                }}
              />
            )}
            <Toggle
              label="Kolom yang ditampilkan"
              value={shownLevel}
              options={[
                { value: "name", label: "Nama" },
                { value: "key", label: "Kunci" },
                { value: "full", label: "Lengkap" },
              ]}
              onChange={(v) => setLevel({ ...level, [target.v]: v })}
            />
            <button type="button" className={`btn ico${panel ? " on" : ""}`} title={panel ? "Sembunyikan panel" : "Tampilkan panel"} aria-label="Panel relasi" aria-pressed={panel} onClick={() => setPanel(!panel)}>
              <Icon name="panel" size={15} />
            </button>
          </div>
        </div>
        <div className="dbw">
          <DiagramCanvas
            graph={graph}
            focus={target.v === "table" ? target.i : null}
            whole={target.v === "all"}
            sel={sel}
            onSel={setSel}
            onFrame={onFrame}
            reveal={reveal}
            legend={
              legend.length > 0 &&
              legend.map(([cls, label]) => (
                <span key={cls} className="lg">
                  <span className={`sw ${cls}`} />
                  {label}
                </span>
              ))
            }
          />
          {panel && (
            <TableInspector
              target={target}
              sel={sel}
              onUnselect={() => setSel(null)}
              onReveal={(i) => {
                setSel(i === sel ? null : i);
                if (i !== sel) setReveal({ i });
              }}
              options={options}
              onDepth={setDepth}
              onHidden={(v) => {
                setHidden(v);
                setSel(null);
              }}
              onBack={steps > 0 ? () => window.history.back() : undefined}
              onClose={() => setPanel(false)}
            />
          )}
        </div>
      </main>
    </GoContext.Provider>
  );
}
