import { notFound } from "next/navigation";
import { ProductionIssueForm } from "@/components/production/production-issue-form";
import { requirePermission } from "@/lib/erp/auth";
import { requireUnit } from "@/lib/erp/production-access";
import { productionIssueOptions } from "@/lib/erp/production-issue";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** `?unit=UP5&bucket=1,2`: Kirim ke Finish Goods from the Stand By of the Unit that ends a line (P303). */
export default async function Page({ searchParams }: { searchParams: Promise<{ unit?: string; bucket?: string; n?: string }> }) {
  const { unit: label, bucket, n } = await searchParams;
  const actor = await requirePermission("PRODUCTION_ISSUE_SEND", "/production/issue/finish-goods");
  const unit = label ? await prisma.refUnit.findFirst({ where: { unit_label: label }, select: { id: true } }) : null;
  if (!unit) notFound();
  await requireUnit(actor, unit.id);
  const options = await productionIssueOptions(unit.id, "finish_goods");
  if (!options) notFound();
  return <ProductionIssueForm key={n ?? "0"} options={options} initialBucketIds={String(bucket ?? "").split(",").map(Number).filter(Boolean)} />;
}
