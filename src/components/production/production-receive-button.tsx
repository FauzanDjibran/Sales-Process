"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { receiveProductionReceiptAction } from "@/app/actions/production-handover";

/** Terima: the Unit takes in what the warehouse sent, and it enters Persiapan (P317). */
export function ProductionReceiveButton({ id, subject, from, small = false }: { id: number; subject: string; from: string; small?: boolean }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const result = await receiveProductionReceiptAction(id);
    setBusy(false);
    setAsking(false);
    if (!result.ok) return toast("Tidak dapat diterima", result.errors._form ?? "Periksa kembali.", "err");
    toast(result.message, subject, "ok");
  }

  return (
    <>
      <button className={small ? "btn sm primary" : "btn primary"} onClick={() => setAsking(true)}>
        <Icon name="check" size={small ? 13 : 15} /> Terima
      </button>
      <ConfirmDialog
        open={asking}
        icon="check"
        tone="ok"
        title="Terima Production Receipt"
        subject={subject}
        body={`Barang dari ${from} masuk ke Persiapan unit ini. Dokumen yang sudah diterima tidak dapat dibatalkan.`}
        confirmLabel="Ya, Terima"
        busy={busy}
        onConfirm={run}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
