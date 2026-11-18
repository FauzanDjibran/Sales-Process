import { notFound } from "next/navigation";
import { KerjaForm } from "@/components/production/kerja-form";
import { requirePermission } from "@/lib/erp/auth";
import { requireUnit } from "@/lib/erp/production-access";
import { kerjaOptions } from "@/lib/erp/production-kerja";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** `?unit=UCL&bucket=1,2`: the Persiapan Kerja rows picked in the Workspace. */
export default async function Page({ searchParams }: { searchParams: Promise<{ unit?: string; bucket?: string }> }) {
  const { unit: label, bucket } = await searchParams;
  const actor = await requirePermission("PRODUCTION_KERJA_START", "/production/kerja/new");
  const unit = label ? await prisma.refUnit.findFirst({ where: { unit_label: label }, select: { id: true } }) : null;
  if (!unit) notFound();
  await requireUnit(actor, unit.id);
  const options = await kerjaOptions(unit.id);
  if (!options) notFound();
  return <KerjaForm options={options} initialBucketIds={String(bucket ?? "").split(",").map(Number).filter(Boolean)} />;
}
