import { notFound } from "next/navigation";
import { BoxForm } from "@/components/production/box-form";
import { requirePermission } from "@/lib/erp/auth";
import { requireUnit } from "@/lib/erp/production-access";
import { boxOptions } from "@/lib/erp/production-box";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** `?unit=UP5`: Packing 95 makes a kotak from everything in its Persiapan (W114). */
export default async function Page({ searchParams }: { searchParams: Promise<{ unit?: string }> }) {
  const { unit: label } = await searchParams;
  const actor = await requirePermission("PRODUCTION_BOX_POST", "/production/box/new");
  const unit = label ? await prisma.refUnit.findFirst({ where: { unit_label: label }, select: { id: true } }) : null;
  if (!unit) notFound();
  await requireUnit(actor, unit.id);
  const options = await boxOptions(unit.id);
  if (!options) notFound();
  return <BoxForm options={options} />;
}
