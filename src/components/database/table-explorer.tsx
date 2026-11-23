"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { ExpandAll } from "@/components/ui/expand-all";
import { SearchField } from "@/components/ui/search-field";
import type { DbApp, Model, Target } from "@/lib/erp/db-diagram";
import { APP_TEXT, Fold, GoLink, Toggle, toggled, useGo } from "./viewer-parts";

export type AppFilter = "" | "erp" | "production";
export type Arrange = "group" | "menu";

type Branch = { key: string; name: string; app: DbApp; module?: string; to: Target; tables: number[] };

/** The tables as a tree, application first: ERP, Produksi, then what both use. */
function branchesOf(m: Model, by: Arrange): Branch[] {
  const order: DbApp[] = ["erp", "production", "shared"];
  const list: Branch[] =
    by === "group"
      ? m.groups.map((g, i) => ({ key: `g${i}`, name: g.name, app: g.app, to: { v: "group", i }, tables: m.tables.flatMap((t, k) => (t.group === i ? [k] : [])) }))
      : m.menus.map((x, i) => ({ key: `m${i}`, name: x.name, app: x.app, module: x.module, to: { v: "menu", i }, tables: [...(x.w.length ? x.w : x.r)].sort((a, b) => Number(b === x.main) - Number(a === x.main)) }));
  return list.sort((a, b) => order.indexOf(a.app) - order.indexOf(b.app));
}

export function TableExplorer({
  target,
  app,
  onApp,
  arrange,
  onArrange,
  open,
  onOpen,
  onHide,
}: {
  target: Target;
  app: AppFilter;
  onApp: (v: AppFilter) => void;
  arrange: Arrange;
  onArrange: (v: Arrange) => void;
  open: ReadonlySet<string>;
  onOpen: (v: Set<string>) => void;
  onHide: () => void;
}) {
  const { model, go } = useGo();
  const [find, setFind] = useState("");
  const q = find.trim().toLowerCase();
  const navRef = useRef<HTMLElement>(null);
  const at = target.v === "all" ? "all" : `${target.v}${target.i}`;
  /** The class of a row, marked when it is the one drawn. */
  const cls = (base: string, t: Target) => (at === (t.v === "all" ? "all" : `${t.v}${t.i}`) ? `${base} on` : base);

  // The chosen row comes into view when the choice was made elsewhere.
  useEffect(() => {
    navRef.current?.querySelector(".dbs-list .on")?.scrollIntoView({ block: "center" });
  }, [at, arrange]);

  // "/" reaches the search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || /INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName)) return;
      e.preventDefault();
      navRef.current?.querySelector("input")?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const branches = branchesOf(model, arrange);
  const shown = branches.flatMap((b) => {
    if (app && b.app !== app && b.app !== "shared") return [];
    const named = b.name.toLowerCase().includes(q);
    const tables = b.tables.filter((i) => named || model.tables[i].name.includes(q));
    return tables.length ? [{ ...b, tables, isOpen: (q && !named) || open.has(b.key) }] : [];
  });

  /** ↓ leaves the search for the list, ↑ / ↓ walk it, Enter opens the first table found. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const from = e.target as HTMLElement;
    const searching = from.tagName === "INPUT";
    if (searching && e.key === "Enter" && q && shown.length) {
      const hit = shown.find((b) => b.isOpen);
      go(hit ? { v: "table", i: hit.tables[0] } : shown[0].to);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const nodes = [...(navRef.current?.querySelectorAll<HTMLElement>(".dbs-list a") ?? [])];
    const i = nodes.indexOf(from as HTMLElement);
    if (!searching && i < 0) return;
    e.preventDefault();
    const next = searching ? 0 : i + (e.key === "ArrowDown" ? 1 : -1);
    if (next < 0) navRef.current?.querySelector("input")?.focus();
    else nodes[next]?.focus();
  };

  return (
    <nav className="sub dbs" aria-label="Daftar tabel" ref={navRef} onKeyDown={onKeyDown}>
      <div className="dbs-f">
        <div className="dbs-r">
          <Toggle
            label="Aplikasi"
            value={app}
            options={[
              { value: "", label: "Semua" },
              { value: "erp", label: "ERP" },
              { value: "production", label: "Produksi" },
            ]}
            onChange={onApp}
          />
          <button type="button" className="collapse" title="Sembunyikan daftar tabel" aria-label="Sembunyikan daftar tabel" onClick={onHide}>
            <Icon name="back" size={13} />
          </button>
        </div>
        <SearchField value={find} onChange={setFind} placeholder={arrange === "group" ? "Cari tabel…" : "Cari menu atau tabel…"} />
        <div className="dbs-r lbl">
          <span>Susun per</span>
          <Toggle
            label="Susun per"
            value={arrange}
            options={[
              { value: "group", label: "Kelompok" },
              { value: "menu", label: "Menu" },
            ]}
            onChange={onArrange}
          />
        </div>
      </div>
      <div className="dbs-list">
        <div className="dbs-b">
          <GoLink to={{ v: "all" }} className={cls("dbs-all", { v: "all" })}>
            <Icon name="layers" size={13} /> Semua Tabel
          </GoLink>
          <span className="tspace" />
          <ExpandAll iconOnly onExpand={() => onOpen(new Set([...open, ...branches.map((b) => b.key)]))} onCollapse={() => onOpen(new Set())} />
        </div>
        {shown.map((b, k) => (
          <div key={b.key}>
            {b.app !== shown[k - 1]?.app && (
              <div className="dbs-app">
                {APP_TEXT[b.app]}
                <span>{arrange === "group" ? `${model.tables.filter((t) => t.app === b.app).length} tabel` : `${model.menus.filter((x) => x.app === b.app).length} menu`}</span>
              </div>
            )}
            {b.module && (b.module !== shown[k - 1]?.module || b.app !== shown[k - 1]?.app) && <div className="dbs-mod">{b.module}</div>}
            <div className={cls("dbs-g", b.to)}>
              <Fold open={Boolean(b.isOpen)} name={b.name} onClick={() => onOpen(toggled(open, b.key))} />
              <GoLink to={b.to} title={b.name}>
                <Hit text={b.name} q={q} />
              </GoLink>
              <span className="dbs-n">{b.tables.length}</span>
            </div>
            {b.isOpen && (
              <div className="dbs-t">
                {b.tables.map((i) => (
                  <GoLink key={i} to={{ v: "table", i }} className={cls("dbs-l", { v: "table", i })} title={model.tables[i].name}>
                    <Icon name="table" size={12} />
                    <span className="mono">
                      <Hit text={model.tables[i].name} q={q} />
                    </span>
                  </GoLink>
                ))}
              </div>
            )}
          </div>
        ))}
        {!shown.length && <div className="cbe">Tidak ada tabel yang cocok.</div>}
      </div>
    </nav>
  );
}

function Hit({ text, q }: { text: string; q: string }) {
  const k = q ? text.toLowerCase().indexOf(q) : -1;
  if (k < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, k)}
      <mark>{text.slice(k, k + q.length)}</mark>
      {text.slice(k + q.length)}
    </>
  );
}
