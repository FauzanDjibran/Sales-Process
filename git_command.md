# Command Reference — ERP

Every command you normally need for this project, in the order you usually
need them. Written for **Windows PowerShell**, run from the project folder
(the one holding `package.json`).

> If PowerShell refuses `npm` / `npx` with *"running scripts is disabled"*, use
> `npm.cmd` / `npx.cmd` instead (e.g. `npm.cmd run dev`), or run once as
> administrator: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

---

## 1. The everyday routine

What to do each time you sit down to use or test the latest version.

```powershell
git pull origin main          # 1. get the latest code
npm install                   # 2. only needed when package.json changed (safe to always run)
npx prisma migrate deploy     # 3. apply any new database changes
npm run db:seed               # 4. add new permissions / settings / system data (safe, deletes nothing)
npm run build                 # 5. build the app (also regenerates the Prisma client)
npm start                     # 6. run it → http://localhost:3110
```

Stop the app with **Ctrl + C** in that window.

Sign in with `admin@erp.app`. The password is `ERP_ADMIN_PASSWORD` from your
`.env`, or `erp123` if you never set one (development only).

> If you signed in **before** step 4 added new permissions, sign out and in
> again, or new menus answer *403 / tidak diizinkan*.

---

## 2. Running the app

| What | Command | Address |
| --- | --- | --- |
| Normal local run (production build) | `npm run build` then `npm start` | <http://localhost:3110> |
| Development mode (reloads on every code change, slower) | `npm run dev` | <http://localhost:3100> |

Use the normal run to use or check the app. Development mode is only for
editing code.

### PostgreSQL must be running first

```powershell
Get-Service postgresql*                  # is it running?
Start-Service postgresql-x64-18          # start it (name may differ; see the line above)
```

Or open **Services** (`services.msc`) and start *postgresql-x64-18*.

The Postgres tools (`psql`, `createdb`, `pg_isready`) are not on PATH. They
live in `C:\Program Files\PostgreSQL\18\bin`:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d erp
```

---

## 3. Checking the code (what Claude runs before every commit)

```powershell
npm run lint      # code style / mistakes
npm test          # the whole test suite (needs Postgres running; takes a few minutes)
npm run build     # the app compiles
```

Run a single test file:

```powershell
node --env-file-if-exists=.env --conditions=react-server --import tsx --test tests/sales-order.test.ts
```

---

## 4. Database commands

| Command | What it does | Safe? |
| --- | --- | --- |
| `npx prisma migrate deploy` | Applies new migrations (schema changes) that came with a pull | ✅ Safe, never deletes data |
| `npm run db:seed` | Adds missing **system** data: permissions, admin role and user, the chart-of-accounts skeleton, document types, partner categories, **all Indonesian regions** (38 provinsi, 514 kota/kabupaten, 7.285 kecamatan, 83.762 kelurahan with kode pos), Kategori Item, the PPN settings, and the **starter references**: Currency IDR + USD; Satuan PCS, UNIT, SET, PAK, BOX, LSN, KRT, BTL, GR, KG, ML, L; Termin TUNAI, NET7, NET14, NET30, NET45, NET60; Jenis PPh PPH22, PPH23, PPH23-15 (sales) and PPH23-BELI (purchase); the purchase settings (Toleransi Selisih Tagihan Supplier Rp 100). A starter row is added only when no row has that label. Never overwrites your edits, never deletes | ✅ Safe, run it after every pull |
| `npm run db:seed-accounts` | Adds a **starter chart of accounts** (34 postable accounts for sales, purchasing, stock and tax) and points **Account Mapping**, the **Kategori Item accounts** and the **Jenis PPh accounts** at it — so every document can post on day one. Not demo data: fine on a real installation. Creates an account only when no account has that name, fills a mapping only where it is empty; your own choices are never changed (P130) | ✅ Safe, additive |
| `npm run db:seed-showcase` | Adds **demo data** from the simulation so you can test straight away (see below). Development only. Additive: matched on label / name, never duplicates, never overwrites | ✅ Safe on a dev database |
| `npm run db:seed-cash-bank-showcase` | After `db:seed-showcase`: six more Cash & Banks (Kas Kecil, Kas Besar, BNI in IDR; BCA USD, Mandiri USD, Kas Valas USD) with Saldo Awal on 01/07/2026, and Jul–Oct 2026 movements through all eight — each a posted journal with its Cash Bank Book entries, so the books reconcile. Runs once (skipped when Kas Kecil exists) | ✅ Safe on a dev database |
| `npm run db:seed-production-showcase` | After both showcases above: three months of Tagihan Biaya Produksi (PLN, air, tenaga borongan, bengkel, limbah) and the Pengeluaran that pay them — Lunas, Sebagian, Belum Dibayar and a Draft of each — all through the posting code, so the books reconcile. Additive: bills matched on No. Tagihan Supplier, payments on their bank reference | ✅ Safe on a dev database |
| `npm run db:tax-backfill` | Makes the Faktur Pajak and Bukti Potong of receipts and Invoices posted before the Pajak menu existed (P100). Idempotent | ✅ Safe |
| `npm run db:stock-inject -- stok.csv` | Checks a CSV of stock to bring in (columns `item,warehouse,lot,expiry,qty,value,date`, plus `location` for a Gudang with Gunakan Lokasi — its Label, Kode or `GUDANG-LOKASI`; item and gudang by Label or Kode; `value` the row's total in whole rupiah) and prints what it would inject. Add `--apply` to record it in the stock books as one run `INJ/YYYY/MM/NNNN`, all or nothing. **Writes no journal** (P120) | ⚠️ Adds stock; cannot be undone from the app |
| `npm run db:reconcile` | Proves the books and the documents agree: 43 read-only checks along the order-to-cash and procure-to-pay flows (journals, Cash Bank Book, AR / AP items vs GL, delivered and received quantities, billing, tax records, the stock books). Prints each check and the rows that disagree; exits 1 if any does | ✅ Read-only |
| `npx prisma generate` | Rebuilds the database client code. `npm run build` does it for you; run it by hand only if an error mentions `@/generated/prisma` or *"Cannot read properties of undefined (reading 'findMany')"* | ✅ Safe |
| `npx prisma studio` | Opens a browser table viewer of the database (<http://localhost:5555>) | ✅ Look only; edits there skip the app's rules and audit |
| `npm run db:truncate-transactions` | Shows what it would delete; add `-- --confirm` to really delete. Empties **journals, the Cash Bank Book, Penerimaan Kas & Bank, AR items with Buku Piutang, Faktur Pajak and Bukti Potong, Invoices, Delivery Notes, the stock books and their lots, Delivery Orders, Sales Orders, Customer Orders and Uang Muka Penjualan bills** (and their audit rows), keeping all master data (partners, items, references), the chart of accounts, the fiscal calendar and the settings. Cash & Bank opening balances are lost; document numbers restart at 0001 | ⚠️ Deletes transactions |
| `npm run db:reset` | **Drops the whole database**, re-applies every migration, then runs `db:seed`. You get system data only (admin, regions, settings…) and nothing you entered | ⛔ Destroys all data |
| `npm run db:fresh` | `db:reset` **plus** `db:seed-showcase`: a clean database already filled with the demo data. The quickest way to start testing from zero | ⛔ Destroys all data |
| `npx prisma migrate dev --name <name>` | Creates a **new** migration from a schema change. Developer command; Claude runs it, you normally never do | ⚠️ Can offer to reset in some states |

> **Why `db:reset` used to leave everything empty:** Prisma 7 only seeds after
> a reset when a seed command is configured in a Prisma config file, and this
> project has none. `db:reset` now runs `db:seed` itself. If you ever run
> `npx prisma migrate reset` directly, run `npm run db:seed` straight after it.

### The deployed copy on Vercel + Neon

Vercel rebuilds the `erp` project on every push to `main`, but it does **not**
touch the database. The Neon database is changed from this machine, through
`.env.neon` (never committed). Create it once: Vercel → Storage →
`erp-postgres` → *Show Metadata & Quickstart* → *Show secret* → *Copy Snippet*,
paste the whole snippet into `.env.neon`, and add a line
`ERP_ADMIN_PASSWORD="..."` (the password of the deployed administrator).

| Command | What it does | Safe? |
| --- | --- | --- |
| `npm run db:neon-migrate` | Applies new migrations to the deployed database. Run it after every push that adds a migration | ✅ Safe, never deletes data |
| `npm run db:neon-seed` | `db:seed` on the deployed database. Refuses without `ERP_ADMIN_PASSWORD` in `.env.neon` | ✅ Safe |
| `npm run db:neon-seed-accounts` | `db:seed-accounts` on the deployed database: the starter chart and its mappings, only where empty | ✅ Additive |
| `npm run db:neon-seed-showcase` | The demo data on the deployed database. Only for a demo deployment | ✅ Additive |
| `npm run db:neon-seed-cash-bank-showcase` | The Cash & Bank demo movements on the deployed database. Only for a demo deployment | ✅ Additive, runs once |
| `npm run db:neon-seed-production-showcase` | The production-cost demo documents on the deployed database, after the two showcases above. Only for a demo deployment | ✅ Additive |
| `npm run db:neon-tax-backfill` | Makes the Faktur Pajak and Bukti Potong of everything posted before the Pajak menu existed (P100). Run once after `db:neon-migrate` | ✅ Safe, idempotent |
| `npm run db:neon-stock-inject -- stok.csv --apply` | `db:stock-inject` against the deployed database (without `--apply` it only checks) | ⚠️ Adds stock |
| `npm run db:neon-reconcile` | `db:reconcile` against the deployed database. Run after `db:neon-migrate` and whenever a report looks wrong | ✅ Read-only |
| `npm run db:neon-reset` | Shows what it would destroy; add `-- --confirm` to really drop and re-migrate the deployed database. Seeds nothing: run `db:neon-seed` after it | ⛔ Destroys all deployed data |

### What the showcase data contains (`db:seed-showcase`)

| Area | Created |
| --- | --- |
| Master › Entitas | Gudang GD-CKR, GD-SBY (Satuan, Termin and Currency already come from `db:seed`) |
| Chart of Accounts | Everything `db:seed-accounts` makes (it runs first), plus Bank BCA and Bank Mandiri |
| Account Mapping, Kategori Item, Jenis PPh | From `db:seed-accounts`: every mapping (sales, purchasing, Selisih Kurs, Laba/Rugi), each Kategori Item's Persediaan / HPP / Beban, PPh Dibayar Dimuka on PPH22 / PPH23 / PPH23-15 and Hutang PPh 23 on PPH23-BELI (only where still empty) |
| Cash & Bank | BCA and MANDIRI, rupiah, with their book at zero |
| Fiscal Year | The current year, Open, with 12 periods |
| Partner | The simulation's 10 customers: tax identity, sales defaults, addresses on real kelurahan, contacts (PT Dermaskin inactive); 4 suppliers with purchase defaults (S-001 / S-002 PKP, S-003 non-PKP, S-004 a person with NIK) |
| Item | The simulation's 8 finished goods, with their BOX conversions; 9 bought items: raw materials BB-001..003 (KG, Kelola Stok, kadaluarsa), packaging BK-001..003 (Kelola Stok, BOX / PAK conversions), BHP-001 (Barang without stock — an expense), Jasa JS-001 Pengiriman and JS-002 Kalibrasi |
| Stock | Opening stock of the finished goods: two lots per item in each Gudang (`INJ/…`, no journal), so a Delivery Note can be picked and posted straight away. Bought items start empty: a Receipt Note brings them in |

Not created: opening balances, Customer Orders or other documents, and the
perizinan services.

### Start again from a clean database

```powershell
npm run db:fresh          # ⛔ wipes everything, then system data + demo data
npm run build
npm start                 # sign in: admin@erp.app / erp123 (or your ERP_ADMIN_PASSWORD)
```

Use `npm run db:reset` instead if you want an empty application with system
data only.

### First-time setup on a new machine

```powershell
git clone https://github.com/FauzanDjibran/Sales-Process.git
cd Sales-Process
Copy-Item .env.example .env        # then edit .env: set the Postgres password in DATABASE_URL
npm install
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres erp
npx prisma migrate deploy
npm run db:seed
npm run db:seed-accounts           # starter chart + Account Mapping (skip if you build your own)
npm run db:seed-showcase           # optional: demo data to test with
npm run build
npm start
```

`.env` holds your passwords and is never committed.

---

## 5. Git — saving and sharing work

### See what is going on

```powershell
git status                    # what changed, which branch you are on
git log --oneline -10         # the last 10 commits
git diff                      # the exact changes not yet committed
```

### Get the latest from GitHub

```powershell
git pull origin main
```

### Commit and push your own changes to main

```powershell
git add -A                                  # stage everything changed
git commit -m "Short description of the change"
git push origin main
```

This project works **straight on `main`** (decision P33): each finished step
is committed to `main` and pushed.

### Throw away local changes you do not want

```powershell
git restore <file>            # undo changes in one file
git restore .                 # ⚠️ undo ALL uncommitted changes
git clean -fd                 # ⚠️ delete new, untracked files too
```

### Put changes aside for a moment

```powershell
git stash                     # park uncommitted changes
git pull origin main
git stash pop                 # bring them back
```

---

## 6. Branches and merging

Some Claude sessions push their work to a branch named `claude/...` instead of
`main`. To bring such a branch into `main`:

```powershell
git fetch origin                              # see all branches on GitHub
git branch -r                                 # list them
git checkout main
git pull origin main
git merge origin/claude/<branch-name>         # bring the branch's commits into main
git push origin main
```

Or on GitHub: open the branch → **Compare & pull request** → **Merge pull
request**. Then run `git pull origin main` locally.

Work on a branch yourself:

```powershell
git checkout -b my-branch          # create and switch
git push -u origin my-branch       # publish it
git checkout main                  # back to main
git merge my-branch                # merge it in
git push origin main
git branch -d my-branch            # delete the local branch afterwards
git push origin --delete my-branch # and the GitHub one
```

### If a merge or pull reports a conflict

1. `git status` lists the conflicted files.
2. Open each file. Keep the right side of every block between `<<<<<<<`,
   `=======` and `>>>>>>>`, and delete the marker lines.
3. Then:

   ```powershell
   git add -A
   git commit          # finishes the merge
   git push origin main
   ```

To give up on the merge instead: `git merge --abort`.

For a conflict in `package-lock.json` or anything under `prisma/migrations/`,
ask Claude rather than editing it by hand.

---

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| *Can't reach database server at localhost:5432* | Postgres is not running; see §2 |
| *Port 3110 is already in use* | Another copy is still running. Find it with `netstat -ano \| findstr :3110`, then stop it with `taskkill /PID <number> /F` |
| A new menu answers *403* / *tidak diizinkan* | `npm run db:seed`, then sign out and in again |
| After a reset the app is empty: no provinces, no sign-in, no settings | The seed did not run. `npm run db:seed` (add `npm run db:seed-showcase` for demo data). `db:reset` and `db:fresh` now do this for you |
| `db:seed-showcase` says *System data is missing* or *Region not found* | Run `npm run db:seed` first, then the showcase again |
| Error about `@/generated/prisma` or `findMany` of undefined | `npx prisma generate` (or `npm run build`) |
| After a pull, a page errors on a missing column | `npx prisma migrate deploy` |
| `npm` blocked by PowerShell | Use `npm.cmd` / `npx.cmd`, see the top of this file |
| Files show as changed but you did not touch them (line endings) | The repository forces LF endings (`.gitattributes`); `git restore .` puts them back |
| A Customer Order shows no **Setujui / Tolak** or **Tutup Pesanan** button | The role needs the permission *Setujui / Tolak Customer Order* or *Tutup Customer Order* (Pengaturan › Role). The administrator gets every permission from `npm run db:seed`; sign out and in again afterwards |
| A Sales Order shows no **Setujui / Tolak**, **Konfirmasi** or **Tutup** button | The role needs *Setujui / Tolak Sales Order*, *Konfirmasi Sales Order* or *Tutup Sales Order* (Pengaturan › Role); run `npm run db:seed` for the administrator, then sign out and in again |
| **Tutup Pesanan** on a Customer Order says a Sales Order is still running | Close, reject or cancel each Sales Order it names first (P79) |
| Posting a Penerimaan says *account belum diatur atau tidak dapat dipakai* | Fill Accounting › Pengaturan › Account Mapping (Uang Muka Penjualan, PPN Keluaran, Beban Bank) and the PPh Dibayar Dimuka account on each Jenis PPh the bills use (Master › Referensi › Jenis PPh). `npm run db:seed-showcase` fills them on a dev database |
| Umur Piutang shows only Uang Muka, no invoices | Expected for now: Invoice AR items are created by the Faktur Penjualan, which is not built yet |
| A Penerimaan shows *Tidak ada tagihan terbuka* | The customer has no **issued** Uang Muka Penjualan bill left unpaid. Issue one (Terbitkan) first |
| Saving a taxable Customer Order says *Tarif PPN belum diatur* | Fill the Pajak card in Pengaturan › System Default (or run `npm run db:seed`) |

---

## 8. Where things are

| File | What it is |
| --- | --- |
| `Claude-ERP.md` | The project guideline: every decision (P-numbers) and open question |
| `IMPLEMENTATION-PLAN.md` | What has been built and what comes next |
| `tax_concept.md` | How tax works in the system |
| `DBML/erp.dbml.md` | The database schema; paste it into <https://dbdiagram.io> to see it drawn |
| `Initialization/` | Source material: the simulation and the concept documents (read-only) |
| `.env` | Your local passwords and database address (never committed) |
