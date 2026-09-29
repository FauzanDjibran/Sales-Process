# ERP

A business web application for Indonesian accounting and tax practice, run on
the user's own machine. One installation serves one company. Sales comes first:
the goal is to do everything the PRJ.001 sales simulation does, on SIBA 3.0's
stack and accounting framework.

The project guideline is [`Claude-ERP.md`](Claude-ERP.md) — decisions, scope and
conventions live there. The phased plan is
[`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md), and the schema is mirrored
in [`DBML/erp.dbml.md`](DBML/erp.dbml.md).

## Stack

Next.js 16 (App Router), React 19, TypeScript, Prisma 7 with the `pg` driver
adapter, PostgreSQL 18, plain CSS, `node:test` against a real database.

## Getting started

1. PostgreSQL 18 running locally, with a database named `erp`.
2. `cp .env.example .env`, then set `DATABASE_URL` to your Postgres password.
3. `npm install`
4. `npx prisma migrate deploy`
5. `npm run db:seed` — system data only; prints the administrator sign-in.

`npm run build` generates the Prisma client itself (`prebuild`), since
`src/generated/` is not committed.

| Run | Command | Port |
| --- | --- | --- |
| Development (hot reload) | `npm run dev` | 3100 |
| Local run — production build | `npm run build`, then `npm start` | 3110 |

A fresh installation holds system data only. The chart of accounts, partners,
cash & bank resources, the fiscal calendar and the System Default accounts are
set up through the application.

## Checks

`npm run lint`, `npm run build` and `npm test` must all pass before a change is
done. The tests run against the database in `DATABASE_URL`, create their own
fixtures and remove them afterwards.

Other scripts: `npm run db:reset` (**destroys all data**, then migrates and
re-seeds), `npm run db:truncate-transactions` (empties journals and the Cash
Bank Book, keeping master and system data; dry run without `-- --confirm`).
