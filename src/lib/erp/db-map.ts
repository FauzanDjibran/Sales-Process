import type { DbMap } from "./db-diagram";
import map from "./db-map.json";
import { MODULES, appOfModule } from "./nav";

/** The traced map (`npm run db:map`) with each menu's name and module as the navigation states them now. */
export function databaseMap(): DbMap {
  const traced = map.menus as Record<string, { main: string | null; w: string[]; r: string[] }>;
  return {
    groups: map.groups as DbMap["groups"],
    tables: map.tables,
    menus: MODULES.flatMap((mod) =>
      (mod.groups ?? []).flatMap((g) =>
        g.entities.flatMap((e) =>
          traced[e.key]
            ? [{ key: e.key, name: e.name, module: mod.name, app: appOfModule(mod.key) === "production" ? ("production" as const) : ("erp" as const), hidden: Boolean(mod.hidden), ...traced[e.key] }]
            : []
        )
      )
    ),
  };
}
