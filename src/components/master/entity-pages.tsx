import { notFound } from "next/navigation";
import { AccountTree } from "@/components/master/account-tree";
import { FiscalPeriods } from "@/components/accounting/fiscal-periods";
import { FiscalYearActions } from "@/components/accounting/fiscal-year-actions";
import { CashBankBookCard } from "@/components/master/cash-bank-book-card";
import { EntityForm } from "@/components/master/entity-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { can as actorHas, requirePermission } from "@/lib/erp/auth";
import { abilitiesFor, entityPermissions } from "@/lib/erp/entity-access";
import { entityBySlug, type Entity } from "@/lib/erp/entities";
import {
  accountTree,
  checkAccountIsLeaf,
  columnRefOptions,
  computedValues,
  getRow,
  listRows,
  refOptions,
} from "@/lib/erp/records";
import { cashBankBookSummary } from "@/lib/erp/cash-bank";
import { fiscalYearPeriods } from "@/lib/erp/fiscal";
import { defaultCurrencyId } from "@/lib/erp/system-settings";
import {
  fiscalYearAbilities,
  availableActions as availableFiscalActions,
  type FiscalYearStatus,
} from "@/lib/erp/fiscal-workflow";
import type { ActionTone } from "@/lib/erp/header-actions";
import { EntityList } from "@/components/master/entity-list";

/**
 * The four registry pages, written once and mounted under each module that owns
 * registry entities (`/master/[entity]`, `/accounting/[entity]`).
 *
 * The route's own module is passed in and checked: `/accounting/partner` is not
 * a second way into Partner, it is a 404. Without that, one entity would have
 * two URLs and two sets of breadcrumbs.
 */
function resolve(moduleKey: string, slug: string): Entity {
  const entity = entityBySlug(slug);
  if (!entity || entity.module !== moduleKey) notFound();
  return entity;
}

export async function EntityListPage({
  module: moduleKey,
  slug,
}: {
  module: string;
  slug: string;
}) {
  const entity = resolve(moduleKey, slug);

  // Reading the list is its own permission, checked before a single row is read.
  const actor = await requirePermission(
    entityPermissions(entity.key).view,
    `/${entity.module}/${entity.slug}`
  );
  const can = abilitiesFor(entity.key, actor.permissions);

  if (entity.view === "tree") {
    const tree = await accountTree();
    return (
      <AccountTree
        entity={entity}
        categories={tree.categories}
        accounts={tree.accounts}
        can={can}
      />
    );
  }

  const rows = await listRows(entity);
  const computed = await computedValues(entity, rows);
  // Columns can reference entities the form never edits, so top those up.
  const refs = await columnRefOptions(entity, await refOptions(entity));

  return (
    <EntityList
      entity={entity}
      rows={rows}
      refs={refs}
      computed={computed}
      can={can}
    />
  );
}

export async function EntityNewPage({
  module: moduleKey,
  slug,
}: {
  module: string;
  slug: string;
}) {
  const entity = resolve(moduleKey, slug);

  const create = entityPermissions(entity.key).create;
  if (!create) notFound();
  const actor = await requirePermission(create, `/${entity.module}/${entity.slug}/new`);

  const refs = await refOptions(entity);

  return (
    <EntityForm
      entity={entity}
      mode="new"
      row={null}
      refs={refs}
      can={abilitiesFor(entity.key, actor.permissions)}
      defaults={{ default_currency: await defaultCurrencyId() }}
    />
  );
}

export async function EntityDetailPage({
  module: moduleKey,
  slug,
  id,
}: {
  module: string;
  slug: string;
  id: string;
}) {
  const entity = resolve(moduleKey, slug);

  const actor = await requirePermission(
    entityPermissions(entity.key).view,
    `/${entity.module}/${entity.slug}/${id}`
  );

  const row = await getRow(entity, Number(id));
  if (!row) notFound();

  const refs = await refOptions(entity);

  // A Fiscal Year has a lifecycle rather than a status field: it is activated,
  // which is what generates its periods. Everything else here is registry-driven.
  const fiscalStatus = String(row.status ?? "Draft") as FiscalYearStatus;
  const fiscalCan = fiscalYearAbilities(actor.permissions);
  const headerActions =
    entity.key === "acc_fiscal_year" ? (
      <FiscalYearActions
        id={row.id}
        subject={`${row.year_label} – ${row.year_name}`}
        status={fiscalStatus}
        can={fiscalCan}
      />
    ) : undefined;

  // A header carries one primary and it is the rightmost button. Activating a
  // Fiscal Year is the chief thing that screen is for, so where it is offered
  // Ubah steps down to neutral and sits to its left — the arrangement every
  // document uses for Ubah beside a lifecycle action. With nothing to activate, Ubah is the primary again.
  const editTone: ActionTone =
    entity.key === "acc_fiscal_year" &&
    availableFiscalActions(fiscalStatus, fiscalCan).length > 0
      ? "neutral"
      : "primary";

  const parentLock = await accountParentLock(entity, row);

  const form = (
    <EntityForm
      entity={entity}
      mode="view"
      row={row}
      refs={refs}
      can={abilitiesFor(entity.key, actor.permissions)}
      headerActions={headerActions}
      editTone={editTone}
      {...parentLock}
    />
  );

  // A Fiscal Year owns its twelve months, and they are visible nowhere else —
  // Fiscal Period has no menu and no form of its own.
  if (entity.key === "acc_fiscal_year") {
    return (
      <>
        {form}
        <FiscalPeriods
          periods={await fiscalYearPeriods(row.id)}
          yearLabel={String(row.year_label ?? "")}
          yearStatus={String(row.status ?? "")}
        />
        <RecordHistoryCard entityKey={entity.key} rowId={row.id} />
      </>
    );
  }

  // A Cash & Bank resource is the one master with a book behind it, so its
  // detail says what that book adds up to and shows the way into it. The book
  // itself is a report, not a property of the master — see `CashBankBookCard`.
  if (entity.key !== "m_cash_bank") {
    return (
      <>
        {form}
        <RecordHistoryCard entityKey={entity.key} rowId={row.id} />
      </>
    );
  }

  const summary = await cashBankBookSummary(row.id);
  const currencyLabel =
    refs.currency_id?.find((o) => o.id === row.currency_id)?.label ?? "IDR";

  return (
    <>
      {form}
      <CashBankBookCard
        cashBankId={row.id}
        balance={summary.balance}
        entries={summary.entries}
        lastEntryDate={summary.lastEntryDate}
        currencyLabel={currencyLabel}
        canViewReport={await actorHas("REPORT_CASH_BANK_LEDGER_VIEW")}
      />
      <RecordHistoryCard entityKey={entity.key} rowId={row.id} />
    </>
  );
}

export async function EntityEditPage({
  module: moduleKey,
  slug,
  id,
}: {
  module: string;
  slug: string;
  id: string;
}) {
  const entity = resolve(moduleKey, slug);

  const edit = entityPermissions(entity.key).edit;
  if (!edit) notFound();
  const actor = await requirePermission(edit, `/${entity.module}/${entity.slug}/${id}/edit`);

  const row = await getRow(entity, Number(id));
  if (!row) notFound();

  const refs = await refOptions(entity);

  return (
    <>
      <EntityForm
        entity={entity}
        mode="edit"
        row={row}
        refs={refs}
        can={abilitiesFor(entity.key, actor.permissions)}
        {...(await accountParentLock(entity, row))}
      />
      <RecordHistoryCard entityKey={entity.key} rowId={row.id} />
    </>
  );
}

/**
 * Why an account that has gained a sub-account no longer receives postings.
 *
 * There is no control to lock any more — whether an account may be posted to
 * is decided by the shape of the chart and by what reconciles against it, and
 * the form offers neither flag. What is left is the explanation, which still
 * has to be on the screen: the account simply stops appearing in every picker
 * that names somewhere money goes, and a reader who is not told why will go
 * looking for the setting that did it.
 *
 * Per-row rather than per-entity, which is why it cannot live in the registry:
 * `entities.ts` describes what an Account *is*, and this depends on what has
 * been created underneath this one.
 */
async function accountParentLock(
  entity: Entity,
  row: { id: number }
): Promise<{ lockNote?: string }> {
  if (entity.key !== "acc_account") return {};
  if (!(await checkAccountIsLeaf(row.id))) return {};
  return {
    lockNote:
      "Account ini memiliki sub-account, sehingga tidak lagi menerima posting: " +
      "saldonya adalah jumlah dari account di bawahnya. Hak posting tidak dapat " +
      "dikembalikan — posting dilakukan pada salah satu sub-accountnya.",
  };
}
