/**
 * Starter chart of accounts with Account Mapping, Kategori Item accounts and
 * Jenis PPh accounts (Claude-ERP.md P130) — `npm run db:seed-accounts`,
 * `npm run db:neon-seed-accounts`.
 *
 * Unlike the showcase this is not demo data: it is a usable starting chart,
 * safe to run on a real installation. It creates only accounts whose name is
 * missing and fills only pointers that are still empty, so running it on a
 * chart the user built leaves their choices alone. Run it after `db:seed`.
 */
import { prisma } from "../src/lib/prisma";
import { seedStarterAccounts } from "./lib/starter-accounts";

async function main() {
  const sistem = await prisma.sysUser.findUnique({ where: { email: "sistem@erp.app" }, select: { id: true } });
  if (!sistem) throw new Error("System data is missing. Run `npm run db:seed` first.");

  const { made } = await seedStarterAccounts(sistem.id);
  const entries = Object.entries(made);
  if (entries.length) {
    console.log("Starter accounts:");
    for (const [what, n] of entries) console.log(`  ${String(n).padStart(4)}  ${what}`);
  } else {
    console.log("Nothing to do — every starter account and mapping is already there.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
