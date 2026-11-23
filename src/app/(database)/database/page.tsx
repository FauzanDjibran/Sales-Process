import { DbViewer } from "@/components/database/db-viewer";
import { requirePermission } from "@/lib/erp/auth";
import { databaseMap } from "@/lib/erp/db-map";
import { databaseSchema } from "@/lib/erp/db-schema";

export const dynamic = "force-dynamic";

/**
 * The schema in use, its relations, and the menus that use each table (P313).
 * What is chosen lives in the URL (`?table=`, `?group=`, `?menu=`); the page is
 * read once and the rest happens in the browser.
 */
export default async function DatabasePage() {
  await requirePermission("MENU_DATABASE_ACCESS", "/database");
  return <DbViewer schema={await databaseSchema()} map={databaseMap()} />;
}
