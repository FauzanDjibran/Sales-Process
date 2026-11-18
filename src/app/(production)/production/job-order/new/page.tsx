import { notFound } from "next/navigation";
import { JobOrderForm } from "@/components/production/job-order-form";
import { requirePermission } from "@/lib/erp/auth";
import { requireUnit } from "@/lib/erp/production-access";
import { jobOrderOptions } from "@/lib/erp/production-job-order";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** `?unit=UML&bucket=1,2`: the Persiapan Job Order rows picked in the Workspace. */
export default async function Page({ searchParams }: { searchParams: Promise<{ unit?: string; bucket?: string }> }) {
  const { unit: label, bucket } = await searchParams;
  const actor = await requirePermission("PRODUCTION_JOB_ORDER_POST", "/production/job-order/new");
  const unit = label ? await prisma.refUnit.findFirst({ where: { unit_label: label }, select: { id: true } }) : null;
  if (!unit) notFound();
  await requireUnit(actor, unit.id);
  const options = await jobOrderOptions(unit.id);
  if (!options) notFound();
  return <JobOrderForm options={options} initialBucketIds={String(bucket ?? "").split(",").map(Number).filter(Boolean)} />;
}
