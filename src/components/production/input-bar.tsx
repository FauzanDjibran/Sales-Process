"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Combobox } from "@/components/ui/combobox";
import { MoneyInput } from "@/components/ui/money-input";
import { qtyText } from "@/components/production/execution-parts";
import type { JobChoice } from "@/components/production/job-picker";

/**
 * The one way a production document takes goods (`Workspace-Unit-Plan-r11.md`
 * U3, the artifact's `bar()`): pick or scan a No. Job / No. Stok in the
 * dropdown, type the gram when the goods may be taken in part, then Tambah
 * (Enter in the gram does the same). A Job is always taken whole, so it asks
 * no gram. Every form — Grading, Pengerjaan, QC Check, Kirim, Kerja, Job
 * Order — fills itself through this bar.
 */
export function InputBar({
  choices,
  onAdd,
  partial = () => false,
  label = "No. Job / No. Stok",
  emptyText = "Tidak ada lagi yang menunggu.",
}: {
  choices: JobChoice[];
  /** `grams` only for a choice that may be taken in part; null means all of it. */
  onAdd: (key: string, grams: number | null) => void;
  /** Whether a choice may be taken in part (goods without a Job, where the document allows it). */
  partial?: (c: JobChoice) => boolean;
  label?: string;
  emptyText?: string;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [gram, setGram] = useState("");
  const [error, setError] = useState("");
  const cur = picked ? choices[picked - 1] : undefined;
  const part = cur ? partial(cur) : false;
  const options = choices.map((c, i) => ({
    id: i + 1,
    label: c.jobNo ?? c.lotNo,
    name: [c.jobNo ? `${c.count} No. Stok` : c.itemName, `${qtyText(c.grams)} g`, c.partaiNo].filter(Boolean).join(" · "),
    active: true,
  }));

  function add() {
    if (!cur) return;
    let grams: number | null = null;
    if (part && gram !== "") {
      grams = Number(gram);
      if (!(grams > 0) || grams > cur.grams) return setError(`Isi gram lebih dari 0, paling banyak ${qtyText(cur.grams)}.`);
      if (grams === cur.grams) grams = null;
    }
    onAdd(cur.key, grams);
    setPicked(null);
    setGram("");
    setError("");
  }

  return (
    <form
      className="toolbar"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <div style={{ width: 340 }}>
        <Combobox
          size="sm"
          value={picked}
          options={options}
          placeholder={choices.length ? `Pilih atau scan ${label}…` : "Tidak ada yang tersedia"}
          emptyText={emptyText}
          disabled={!choices.length}
          onChange={(v) => {
            setPicked(v);
            setGram("");
            setError("");
          }}
        />
      </div>
      {part && (
        <div style={{ width: 160 }}>
          <MoneyInput size="sm" decimals={4} value={gram} placeholder={qtyText(cur!.grams)} ariaLabel="Gram diambil" onChange={setGram} />
        </div>
      )}
      <button type="submit" className="btn sm primary" disabled={!cur}>
        <Icon name="plus" size={14} /> Tambah
      </button>
      <span className="uw-hint">{error || (part ? "Gram kosong = ambil semua; Enter = Tambah." : `${choices.length} tersedia. Job diambil utuh.`)}</span>
    </form>
  );
}
