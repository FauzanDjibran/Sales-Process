"use client";

import { Icon, type IconName } from "@/components/icon";
import type { RefOption } from "@/lib/erp/records";

/**
 * The shared parts of a form's collection tab (Claude-ERP.md P38): the card
 * with its title and add button, the row actions, and the row-key helper. A
 * Partner's addresses and contacts and an Item's unit conversions are each one
 * of these, with their own table and dialog.
 */

export type CollectionTabProps<T> = {
  editing: boolean;
  items: T[];
  error?: string;
  onChange: (items: T[]) => void;
  /**
   * The rest of the form, for a tab whose rows depend on it — an Item's unit
   * conversions are to the base unit chosen in the header.
   */
  context?: { values: Record<string, unknown>; refs: Record<string, RefOption[]> };
};

let keySeq = 0;
export const newKey = (prefix: string) => `${prefix}n${Date.now().toString(36)}${keySeq++}`;

export function CollectionCard({
  icon,
  title,
  desc,
  editing,
  addLabel,
  onAdd,
  error,
  children,
}: {
  icon: IconName;
  title: string;
  desc: string;
  editing: boolean;
  addLabel: string;
  onAdd: () => void;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name={icon} size={15} />
        </span>
        <div className="ct">
          <h3>{title}</h3>
          <p>{desc}</p>
        </div>
        {editing && (
          <button className="btn sm" onClick={onAdd}>
            <Icon name="plus" size={14} /> {addLabel}
          </button>
        )}
      </div>
      {error && (
        <div className="nbox bad slim cerr">
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>Belum bisa disimpan</b>
            <p>{error}</p>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

export function RowActions({
  onEdit,
  onRemove,
  removeBlocked,
}: {
  onEdit: () => void;
  onRemove: () => void;
  /** Why the row cannot be removed (a location stock has used) — the button stays, disabled, saying so. */
  removeBlocked?: string;
}) {
  return (
    <div className="ract">
      <button
        className="iact"
        title="Ubah"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        <Icon name="pen" size={14} />
      </button>
      <button
        className="iact del"
        title={removeBlocked ?? "Hapus"}
        disabled={Boolean(removeBlocked)}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <Icon name="trash" size={14} />
      </button>
    </div>
  );
}

