import { EntityNewPage } from "@/components/master/entity-pages";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<{ copy?: string }>;
}) {
  const { entity } = await params;
  const { copy } = await searchParams;
  return <EntityNewPage module="master" slug={entity} copyOf={Number(copy) || undefined} />;
}
