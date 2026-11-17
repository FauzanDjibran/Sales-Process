"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { receiveTransferAction } from "@/app/actions/production-transfer";

/** Terima: the receiving Unit takes a BSTB, and its goods enter Persiapan (P277). */
export function TransferReceiveButton({ id, subject, from, partai, small = false }: { id: number; subject: string; from: string; partai: boolean; small?: boolean }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const result = await receiveTransferAction(id);
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
        title="Terima BSTB"
        subject={subject}
        body={`Barang dari ${from} masuk ke Persiapan unit ini${partai ? " dan membentuk partai baru" : ""}. BSTB yang sudah diterima tidak dapat dibatalkan.`}
        confirmLabel="Ya, Terima"
        busy={busy}
        onConfirm={run}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
