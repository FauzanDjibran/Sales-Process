import { notFound } from "next/navigation";
import { FinishGoodsForm } from "@/components/production/finish-goods-form";
import { requirePermission } from "@/lib/erp/auth";
import { requireUnit } from "@/lib/erp/production-access";
import { finishGoodsOptions } from "@/lib/erp/production-receipt";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** `?unit=UCL&bucket=1,2`: BSTB Pengeluaran from Persiapan or Stand By of any Unit (P304). */
export default async function Page({ searchParams }: { searchParams: Promise<{ unit?: string; bucket?: string; n?: string }> }) {
  const { unit: label, bucket, n } = await searchParams;
  const actor = await requirePermission("PRODUCTION_RECEIPT_SEND", "/production/transfer/return");
  const unit = label ? await prisma.refUnit.findFirst({ where: { unit_label: label }, select: { id: true } }) : null;
  if (!unit) notFound();
  await requireUnit(actor, unit.id);
  const options = await finishGoodsOptions(unit.id, "return");
  if (!options) notFound();
  return <FinishGoodsForm key={n ?? "0"} options={options} initialBucketIds={String(bucket ?? "").split(",").map(Number).filter(Boolean)} />;
}
