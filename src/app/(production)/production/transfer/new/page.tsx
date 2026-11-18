import { notFound } from "next/navigation";
import { TransferForm } from "@/components/production/transfer-form";
import { requirePermission } from "@/lib/erp/auth";
import { requireUnit } from "@/lib/erp/production-access";
import { transferOptions } from "@/lib/erp/production-transfer";
import { TRANSFER_PATH } from "@/lib/erp/production-transfer-shape";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** `?unit=UGH&bucket=1,2`: the Stand By rows picked in the Workspace. */
export default async function Page({ searchParams }: { searchParams: Promise<{ unit?: string; bucket?: string; n?: string }> }) {
  const { unit: label, bucket, n } = await searchParams;
  const actor = await requirePermission("PRODUCTION_TRANSFER_CREATE", `${TRANSFER_PATH}/new`);
  const unit = label ? await prisma.refUnit.findFirst({ where: { unit_label: label }, select: { id: true } }) : null;
  if (!unit) notFound();
  await requireUnit(actor, unit.id);
  const options = await transferOptions(unit.id);
  if (!options) notFound();
  return <TransferForm key={n ?? "0"} options={options} initialBucketIds={String(bucket ?? "").split(",").map(Number).filter(Boolean)} />;
}
