"use client";

import { createContext, useContext } from "react";
import { Icon } from "@/components/icon";
import type { DbApp, Model, Target } from "@/lib/erp/db-diagram";

export const APP_TEXT: Record<DbApp, string> = { erp: "ERP", production: "Produksi", shared: "ERP & Produksi" };
const APP_TONE: Record<DbApp, string> = { erp: "t-info", production: "t-acc", shared: "t-slate" };

export const AppTag = ({ app }: { app: DbApp }) => <span className={`bdg ${APP_TONE[app]}`}>{APP_TEXT[app]}</span>;

/** A target's query string: names, not ids, so a shared link survives a migration. */
export function hrefOf(m: Model, t: Target): string {
  if (t.v === "all") return "/database?all=1";
  const name = t.v === "table" ? m.tables[t.i].name : t.v === "group" ? m.groups[t.i].key : m.menus[t.i].key;
  return `/database?${t.v}=${name}`;
}

/** Choosing a target changes the URL in place: everything is already in the browser. */
export const GoContext = createContext<{ model: Model; go: (t: Target) => void } | null>(null);
export function useGo() {
  const ctx = useContext(GoContext);
  if (!ctx) throw new Error("GoContext is missing");
  return ctx;
}

export function GoLink({ to, children, ...rest }: { to: Target; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const { model, go } = useGo();
  return (
    <a
      {...rest}
      href={hrefOf(model, to)}
      onClick={(e) => {
        // A new tab stays a new tab.
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}

/** Makes a table the focus: its own hierarchy fills the canvas. */
export function Aim({ i, size = 14 }: { i: number; size?: number }) {
  const { model } = useGo();
  return (
    <GoLink to={{ v: "table", i }} className="iact" title="Jadikan fokus" aria-label={`Jadikan fokus ${model.tables[i].name}`}>
      <Icon name="aim" size={size} />
    </GoLink>
  );
}

export function Toggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <span className="dtog" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? "on" : undefined} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function Fold({ open, name, onClick }: { open: boolean; name: string; onClick: () => void }) {
  return (
    <button type="button" className="dbs-c" aria-expanded={open} aria-label={`${open ? "Tutup" : "Buka"} ${name}`} onClick={onClick}>
      <span className={`chev${open ? " o" : ""}`}>
        <Icon name="chev" size={11} />
      </span>
    </button>
  );
}

export const toggled = <T,>(set: ReadonlySet<T>, key: T): Set<T> => {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
};
