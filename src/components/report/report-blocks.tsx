"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icon";
import { ExpandAll } from "@/components/ui/expand-all";

/**
 * The parts every subject-book report is drawn from (SIBA's Buku Subjek; P233):
 * the count line over the blocks, a block header that folds from the mouse and
 * the keyboard, the empty state, and a filter toggle that changes what is read.
 * Buku / Saldo Piutang & Hutang and the stock reports share them, so the books
 * read the same wherever they are.
 */

/** A block's header: chevron, label, the muted line, then its summary figures. */
export function BlockHead({
  open,
  onToggle,
  label,
  meta,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  meta: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="cbh"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{ cursor: "pointer" }}
    >
      <span className={`chev${open ? " o" : ""}`}>
        <Icon name="chev" size={12} />
      </span>
      <b>{label}</b>
      <span className="cbn">{meta}</span>
      {children}
    </div>
  );
}

/** `n <noun> · <when>`, with Buka / Tutup Semua when the caller gives it. */
export function CountLine({
  count,
  noun,
  when,
  expand,
}: {
  count: number;
  noun: string;
  when: string;
  expand?: { onExpand: () => void; onCollapse: () => void; allOpen: boolean; allClosed: boolean };
}) {
  return (
    <div className="rhead">
      <span className="count">
        <b>{count}</b> {noun} · {when}
      </span>
      <div className="tspace" />
      {expand && <ExpandAll {...expand} />}
    </div>
  );
}

export function ReportEmpty({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div className="empty sm">
      <div className="ic">
        <Icon name={icon} size={20} />
      </div>
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}

/** Moves at once: it changes what is read, not a filter waiting for Tampilkan. */
export function RunToggle<T extends string>({
  label,
  value,
  options,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; href: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <>
      <span className="rl">{label}</span>
      <span className="dtog" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={value === o.value ? "on" : undefined}
            aria-pressed={value === o.value}
            disabled={pending}
            onClick={() => {
              if (value !== o.value) startTransition(() => router.push(o.href));
            }}
          >
            {o.label}
          </button>
        ))}
      </span>
      <span className="rsep" />
    </>
  );
}
