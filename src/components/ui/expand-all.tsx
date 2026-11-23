"use client";

import { Icon } from "@/components/icon";

/**
 * Buka Semua / Tutup Semua — always a pair, always in the bar directly above
 * the content it opens, never in `.ph-act`: it changes what is on screen, not
 * the record, so it does not belong beside the actions that do.
 * `allOpen` / `allClosed` disable the button that would do nothing.
 */
export function ExpandAll({
  onExpand,
  onCollapse,
  allOpen,
  allClosed,
  iconOnly,
}: {
  onExpand: () => void;
  onCollapse: () => void;
  allOpen?: boolean;
  allClosed?: boolean;
  /** Two icons, where the bar is too narrow for words. */
  iconOnly?: boolean;
}) {
  if (iconOnly)
    return (
      <>
        <button type="button" className="iact" title="Buka Semua" aria-label="Buka Semua" onClick={onExpand} disabled={allOpen}>
          <Icon name="expand" size={14} />
        </button>
        <button type="button" className="iact" title="Tutup Semua" aria-label="Tutup Semua" onClick={onCollapse} disabled={allClosed}>
          <Icon name="collapse" size={14} />
        </button>
      </>
    );
  return (
    <>
      <button className="btn sm" onClick={onExpand} disabled={allOpen}>
        <Icon name="expand" size={13} /> Buka Semua
      </button>
      <button className="btn sm" onClick={onCollapse} disabled={allClosed}>
        <Icon name="collapse" size={13} /> Tutup Semua
      </button>
    </>
  );
}
