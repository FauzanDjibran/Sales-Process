"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icon";
import type { ActionTone } from "@/lib/erp/header-actions";

export type NextStep = { key: string; label: string };

/** The step that moves a fresh Draft on — Ajukan, Terbitkan, Posting — if this user may take it. */
export function firstStep<A extends string>(
  available: readonly A[],
  transitions: Record<A, { label: string; tone: ActionTone }>
): NextStep | null {
  const key = available.find((a) => transitions[a].tone !== "danger");
  return key ? { key, label: transitions[key].label } : null;
}

/** The address of a saved document, opening the confirmation of `next` there. */
export const withStep = (href: string, next?: string) => (next ? `${href}?do=${next}` : href);

/**
 * A form's two ways to save (P309): keep the Draft, or keep it and go straight
 * to its next step. The step itself is taken on the document's page, where its
 * confirmation — the journal a posting writes included — opens by itself, so a
 * refusal or a Batal leaves the Draft as saved.
 */
export function SaveButtons({
  saving,
  disabled = saving,
  onSave,
  next,
  label = "Simpan",
}: {
  saving: boolean;
  disabled?: boolean;
  onSave: (next?: string) => void;
  next?: NextStep | null;
  /** What saving alone is called, when there is no next step to offer. */
  label?: string;
}) {
  // Which button is at work, so only that one says so.
  const [pressed, setPressed] = useState<string | undefined>();
  const save = (step?: string) => {
    setPressed(step);
    onSave(step);
  };
  return (
    <>
      <button className={`btn${next ? "" : " primary"}`} onClick={() => save()} disabled={disabled}>
        <Icon name="save" size={15} /> {saving && !pressed ? "Menyimpan…" : next ? "Simpan Draft" : label}
      </button>
      {next && (
        <button className="btn primary" onClick={() => save(next.key)} disabled={disabled}>
          <Icon name="check" size={15} /> {saving && pressed ? "Menyimpan…" : `Simpan & ${next.label}`}
        </button>
      )}
    </>
  );
}

/**
 * The step `?do=` asks a document's page to confirm, when this user may take it
 * now; anything else opens nothing. The address is cleaned at once, so a reload
 * does not ask again.
 */
export function useInitialAction<A extends string>(available: readonly A[]): A | null {
  const pathname = usePathname();
  const asked = useSearchParams().get("do");
  const [initial] = useState<A | null>(() => available.find((a) => a === asked) ?? null);
  useEffect(() => {
    if (asked !== null) window.history.replaceState(null, "", pathname);
  }, [asked, pathname]);
  return initial;
}
