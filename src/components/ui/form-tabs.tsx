"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/icon";

export type FormTab = {
  key: string;
  label: string;
  icon: IconName;
  content: React.ReactNode;
  /** How many rows the tab holds; left out when it holds no rows. */
  count?: number;
  /** The last save refused something in this tab. */
  bad?: boolean;
};

/** Whether a save refused a field whose error key starts with one of `prefixes`. */
export const tabHasError = (errors: Record<string, string>, ...prefixes: string[]) =>
  Object.keys(errors).some((k) => errors[k] && prefixes.some((p) => k.startsWith(p)));

/**
 * What a form holds after its header card (P308): every section is a tab, one
 * section included, so header → tabs → Riwayat reads the same on every record.
 * Inactive tabs stay mounted, so what was typed in one survives a visit to
 * another. A save that is refused opens the first tab it names.
 */
export function FormTabs({
  tabs: all,
  foot,
}: {
  tabs: (FormTab | false | null | undefined)[];
  /** Below whichever tab is open: totals that follow from several tabs. */
  foot?: React.ReactNode;
}) {
  const tabs = all.filter((t): t is FormTab => Boolean(t));
  const [chosen, setChosen] = useState(tabs[0]?.key);
  const bad = tabs.filter((t) => t.bad).map((t) => t.key);
  const badKey = bad.join("|");
  const [seenBad, setSeenBad] = useState(badKey);
  const active = tabs.some((t) => t.key === chosen) ? chosen : tabs[0]?.key;
  if (badKey !== seenBad) {
    setSeenBad(badKey);
    if (bad.length && !bad.includes(active ?? "")) setChosen(bad[0]);
  }
  if (!tabs.length) return null;
  return (
    <>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === active}
            className={`tab${t.key === active ? " on" : ""}${t.bad ? " bad" : ""}`}
            onClick={() => setChosen(t.key)}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
            {t.count !== undefined && <span className="tc">{t.count}</span>}
            {t.bad && <span className="td" title="Ada yang perlu diperbaiki" />}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" hidden={t.key !== active}>
          {t.content}
        </div>
      ))}
      {foot}
    </>
  );
}
