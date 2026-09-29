-- CreateEnum
CREATE TYPE "ActiveStatus" AS ENUM ('Active', 'Inactive');

-- CreateEnum
CREATE TYPE "CashBankType" AS ENUM ('Cash', 'Bank');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('Debit', 'Kredit');

-- CreateEnum
CREATE TYPE "AccountSection" AS ENUM ('BalanceSheet', 'ProfitLoss');

-- CreateEnum
CREATE TYPE "ProfitLossGroup" AS ENUM ('OperatingRevenue', 'CostOfSales', 'OperatingExpense', 'OtherIncome', 'OtherExpense');

-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('Draft', 'Open', 'Closed');

-- CreateEnum
CREATE TYPE "FiscalClosingStatus" AS ENUM ('Open', 'Closed');

-- CreateEnum
CREATE TYPE "FlowDirection" AS ENUM ('In', 'Out');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('TAMBAH', 'UPDATE', 'HAPUS');

-- CreateEnum
CREATE TYPE "CashBankEntryType" AS ENUM ('Opening', 'Transaction', 'Adjustment');

-- CreateEnum
CREATE TYPE "CashBankLayerStatus" AS ENUM ('Open', 'Exhausted', 'ClosedByRevaluation');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- CreateTable
CREATE TABLE "sys_user" (
    "id" SERIAL NOT NULL,
    "user_code" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_role" (
    "id" SERIAL NOT NULL,
    "role_code" TEXT NOT NULL,
    "role_label" TEXT NOT NULL,
    "role_name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_permission" (
    "id" SERIAL NOT NULL,
    "permission_code" TEXT NOT NULL,
    "permission_name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_setting" (
    "id" SERIAL NOT NULL,
    "setting_key" TEXT NOT NULL,
    "setting_value" TEXT,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_user_role" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_role_permission" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_session" (
    "id" SERIAL NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_account_type" (
    "id" SERIAL NOT NULL,
    "type_code" TEXT NOT NULL,
    "type_label" TEXT NOT NULL,
    "type_name" TEXT NOT NULL,
    "section" "AccountSection" NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_account_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_doc_type" (
    "id" SERIAL NOT NULL,
    "doc_code" TEXT NOT NULL,
    "doc_label" TEXT NOT NULL,
    "doc_name" TEXT NOT NULL,
    "doc_table" TEXT NOT NULL,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_doc_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_partner_category" (
    "id" SERIAL NOT NULL,
    "category_code" TEXT NOT NULL,
    "category_label" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_partner_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ref_currency" (
    "id" SERIAL NOT NULL,
    "currency_code" TEXT NOT NULL,
    "currency_label" TEXT NOT NULL,
    "currency_name" TEXT NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ref_currency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_partner" (
    "id" SERIAL NOT NULL,
    "partner_code" TEXT NOT NULL,
    "partner_label" TEXT NOT NULL,
    "partner_name" TEXT NOT NULL,
    "category_id" INTEGER NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_cash_bank" (
    "id" SERIAL NOT NULL,
    "cash_bank_code" TEXT NOT NULL,
    "cash_bank_label" TEXT NOT NULL,
    "cash_bank_name" TEXT NOT NULL,
    "cash_bank_type" "CashBankType" NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_cash_bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_bank_ledger" (
    "id" SERIAL NOT NULL,
    "entry_no" TEXT NOT NULL,
    "cash_bank_id" INTEGER NOT NULL,
    "entry_date" DATE NOT NULL,
    "entry_type" "CashBankEntryType" NOT NULL,
    "direction" "FlowDirection" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "movement" DECIMAL(18,2) NOT NULL,
    "balance_after" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "base_amount" DECIMAL(18,2) NOT NULL,
    "base_movement" DECIMAL(18,2) NOT NULL,
    "base_balance_after" DECIMAL(18,2) NOT NULL,
    "source_doc_type_id" INTEGER,
    "source_doc_id" INTEGER,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_bank_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_bank_balance" (
    "cash_bank_id" INTEGER NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "entry_count" INTEGER NOT NULL DEFAULT 0,
    "last_entry_id" INTEGER,
    "last_entry_date" DATE,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_bank_balance_pkey" PRIMARY KEY ("cash_bank_id")
);

-- CreateTable
CREATE TABLE "cash_bank_layer" (
    "id" SERIAL NOT NULL,
    "layer_no" TEXT NOT NULL,
    "cash_bank_id" INTEGER NOT NULL,
    "acquisition_date" DATE NOT NULL,
    "acquisition_seq" INTEGER NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "foreign_original" DECIMAL(18,2) NOT NULL,
    "base_original" DECIMAL(18,2) NOT NULL,
    "foreign_remaining" DECIMAL(18,2) NOT NULL,
    "base_remaining" DECIMAL(18,2) NOT NULL,
    "status" "CashBankLayerStatus" NOT NULL DEFAULT 'Open',
    "source_doc_type_id" INTEGER,
    "source_doc_id" INTEGER,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_bank_layer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_account_category" (
    "id" SERIAL NOT NULL,
    "account_type_id" INTEGER NOT NULL,
    "category_code" TEXT NOT NULL,
    "category_label" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "pl_group" "ProfitLossGroup",
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_account_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_account_subcategory" (
    "id" SERIAL NOT NULL,
    "account_category_id" INTEGER NOT NULL,
    "subcategory_code" TEXT NOT NULL,
    "subcategory_label" TEXT NOT NULL,
    "subcategory_name" TEXT NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_account_subcategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_account" (
    "id" SERIAL NOT NULL,
    "account_subcategory_id" INTEGER NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_label" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "parent_account" INTEGER,
    "is_postable" BOOLEAN NOT NULL DEFAULT true,
    "normal_balance" "NormalBalance" NOT NULL,
    "require_partner" BOOLEAN NOT NULL DEFAULT false,
    "partner_category_id" INTEGER,
    "is_control_account" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_fiscal_year" (
    "id" SERIAL NOT NULL,
    "year_code" TEXT NOT NULL,
    "year_label" TEXT NOT NULL,
    "year_name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "note" TEXT,
    "status" "FiscalStatus" NOT NULL DEFAULT 'Draft',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_fiscal_year_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_fiscal_period" (
    "id" SERIAL NOT NULL,
    "fiscal_year_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "period_code" TEXT NOT NULL,
    "period_label" TEXT NOT NULL,
    "period_name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "note" TEXT,
    "status" "FiscalStatus" NOT NULL DEFAULT 'Draft',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_fiscal_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_fiscal_closing" (
    "id" SERIAL NOT NULL,
    "fiscal_year_id" INTEGER NOT NULL,
    "status" "FiscalClosingStatus" NOT NULL DEFAULT 'Open',
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" INTEGER,
    "closing_journal_id" INTEGER,
    "opening_balance_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_fiscal_closing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_opening_balance" (
    "id" SERIAL NOT NULL,
    "opening_no" TEXT NOT NULL,
    "posting_date" DATE NOT NULL,
    "fiscal_year_id" INTEGER NOT NULL,
    "source_fiscal_year_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_opening_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_opening_balance_line" (
    "id" SERIAL NOT NULL,
    "opening_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "partner_id" INTEGER,
    "debit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "kredit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_opening_balance_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_journal" (
    "id" SERIAL NOT NULL,
    "journal_no" TEXT NOT NULL,
    "posting_date" DATE,
    "source_doc_type_id" INTEGER,
    "source_doc_id" INTEGER,
    "description" TEXT NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'Posted',
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_journal_line" (
    "id" SERIAL NOT NULL,
    "journal_id" INTEGER NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "partner_id" INTEGER,
    "currency_id" INTEGER NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "debit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "kredit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "trx_amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_journal_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "entity_key" TEXT NOT NULL,
    "row_id" INTEGER NOT NULL,
    "action" "AuditAction" NOT NULL,
    "event" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by" INTEGER NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sys_user_user_code_key" ON "sys_user"("user_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_user_email_key" ON "sys_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sys_role_role_code_key" ON "sys_role"("role_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_role_role_label_key" ON "sys_role"("role_label");

-- CreateIndex
CREATE UNIQUE INDEX "sys_permission_permission_code_key" ON "sys_permission"("permission_code");

-- CreateIndex
CREATE INDEX "sys_permission_module_idx" ON "sys_permission"("module");

-- CreateIndex
CREATE UNIQUE INDEX "sys_setting_setting_key_key" ON "sys_setting"("setting_key");

-- CreateIndex
CREATE INDEX "sys_user_role_user_id_idx" ON "sys_user_role"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_user_role_user_id_role_id_key" ON "sys_user_role"("user_id", "role_id");

-- CreateIndex
CREATE INDEX "sys_role_permission_role_id_idx" ON "sys_role_permission"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_role_permission_role_id_permission_id_key" ON "sys_role_permission"("role_id", "permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_session_token_hash_key" ON "sys_session"("token_hash");

-- CreateIndex
CREATE INDEX "sys_session_user_id_idx" ON "sys_session"("user_id");

-- CreateIndex
CREATE INDEX "sys_session_expires_at_idx" ON "sys_session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sys_account_type_type_code_key" ON "sys_account_type"("type_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_account_type_type_label_key" ON "sys_account_type"("type_label");

-- CreateIndex
CREATE UNIQUE INDEX "sys_doc_type_doc_code_key" ON "sys_doc_type"("doc_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_partner_category_category_code_key" ON "sys_partner_category"("category_code");

-- CreateIndex
CREATE UNIQUE INDEX "ref_currency_currency_code_key" ON "ref_currency"("currency_code");

-- CreateIndex
CREATE UNIQUE INDEX "m_partner_partner_code_key" ON "m_partner"("partner_code");

-- CreateIndex
CREATE INDEX "m_partner_category_id_idx" ON "m_partner"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "m_cash_bank_cash_bank_code_key" ON "m_cash_bank"("cash_bank_code");

-- CreateIndex
CREATE UNIQUE INDEX "cash_bank_ledger_entry_no_key" ON "cash_bank_ledger"("entry_no");

-- CreateIndex
CREATE INDEX "cash_bank_ledger_cash_bank_id_entry_date_idx" ON "cash_bank_ledger"("cash_bank_id", "entry_date");

-- CreateIndex
CREATE INDEX "cash_bank_ledger_source_doc_type_id_source_doc_id_idx" ON "cash_bank_ledger"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_bank_layer_layer_no_key" ON "cash_bank_layer"("layer_no");

-- CreateIndex
CREATE INDEX "cash_bank_layer_cash_bank_id_status_acquisition_date_acquis_idx" ON "cash_bank_layer"("cash_bank_id", "status", "acquisition_date", "acquisition_seq");

-- CreateIndex
CREATE INDEX "cash_bank_layer_source_doc_type_id_source_doc_id_idx" ON "cash_bank_layer"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_account_category_category_code_key" ON "acc_account_category"("category_code");

-- CreateIndex
CREATE UNIQUE INDEX "acc_account_category_category_label_key" ON "acc_account_category"("category_label");

-- CreateIndex
CREATE INDEX "acc_account_category_account_type_id_idx" ON "acc_account_category"("account_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_account_subcategory_subcategory_code_key" ON "acc_account_subcategory"("subcategory_code");

-- CreateIndex
CREATE UNIQUE INDEX "acc_account_subcategory_subcategory_label_key" ON "acc_account_subcategory"("subcategory_label");

-- CreateIndex
CREATE INDEX "acc_account_subcategory_account_category_id_idx" ON "acc_account_subcategory"("account_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_account_account_code_key" ON "acc_account"("account_code");

-- CreateIndex
CREATE INDEX "acc_account_account_subcategory_id_idx" ON "acc_account"("account_subcategory_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_account_account_label_key" ON "acc_account"("account_label");

-- CreateIndex
CREATE UNIQUE INDEX "acc_fiscal_year_year_code_key" ON "acc_fiscal_year"("year_code");

-- CreateIndex
CREATE UNIQUE INDEX "acc_fiscal_period_period_code_key" ON "acc_fiscal_period"("period_code");

-- CreateIndex
CREATE INDEX "acc_fiscal_period_fiscal_year_id_idx" ON "acc_fiscal_period"("fiscal_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_fiscal_closing_fiscal_year_id_key" ON "acc_fiscal_closing"("fiscal_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "acc_opening_balance_opening_no_key" ON "acc_opening_balance"("opening_no");

-- CreateIndex
CREATE UNIQUE INDEX "acc_opening_balance_fiscal_year_id_key" ON "acc_opening_balance"("fiscal_year_id");

-- CreateIndex
CREATE INDEX "acc_opening_balance_line_opening_id_idx" ON "acc_opening_balance_line"("opening_id");

-- CreateIndex
-- NULLS NOT DISTINCT: one line per (account, partner?) pair, where a null
-- partner is a value of its own. Postgres would otherwise treat two
-- null-partner lines for one account as distinct. Prisma cannot express this.
CREATE UNIQUE INDEX "acc_opening_balance_line_opening_id_account_id_partner_id_key" ON "acc_opening_balance_line"("opening_id", "account_id", "partner_id") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "acc_journal_journal_no_key" ON "acc_journal"("journal_no");

-- CreateIndex
CREATE INDEX "acc_journal_posting_date_idx" ON "acc_journal"("posting_date");

-- CreateIndex
CREATE INDEX "acc_journal_source_doc_type_id_source_doc_id_idx" ON "acc_journal"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE INDEX "acc_journal_line_journal_id_idx" ON "acc_journal_line"("journal_id");

-- CreateIndex
CREATE INDEX "acc_journal_line_account_id_idx" ON "acc_journal_line"("account_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_key_row_id_idx" ON "audit_log"("entity_key", "row_id");

-- AddForeignKey
ALTER TABLE "sys_user_role" ADD CONSTRAINT "sys_user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_user_role" ADD CONSTRAINT "sys_user_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "sys_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_role_permission" ADD CONSTRAINT "sys_role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "sys_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_role_permission" ADD CONSTRAINT "sys_role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "sys_permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_session" ADD CONSTRAINT "sys_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_partner" ADD CONSTRAINT "m_partner_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "sys_partner_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_cash_bank" ADD CONSTRAINT "m_cash_bank_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_cash_bank" ADD CONSTRAINT "m_cash_bank_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bank_ledger" ADD CONSTRAINT "cash_bank_ledger_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bank_ledger" ADD CONSTRAINT "cash_bank_ledger_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bank_balance" ADD CONSTRAINT "cash_bank_balance_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bank_layer" ADD CONSTRAINT "cash_bank_layer_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bank_layer" ADD CONSTRAINT "cash_bank_layer_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_account_category" ADD CONSTRAINT "acc_account_category_account_type_id_fkey" FOREIGN KEY ("account_type_id") REFERENCES "sys_account_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_account_subcategory" ADD CONSTRAINT "acc_account_subcategory_account_category_id_fkey" FOREIGN KEY ("account_category_id") REFERENCES "acc_account_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_account" ADD CONSTRAINT "acc_account_account_subcategory_id_fkey" FOREIGN KEY ("account_subcategory_id") REFERENCES "acc_account_subcategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_account" ADD CONSTRAINT "acc_account_partner_category_id_fkey" FOREIGN KEY ("partner_category_id") REFERENCES "sys_partner_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_account" ADD CONSTRAINT "acc_account_parent_account_fkey" FOREIGN KEY ("parent_account") REFERENCES "acc_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_fiscal_period" ADD CONSTRAINT "acc_fiscal_period_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "acc_fiscal_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_fiscal_closing" ADD CONSTRAINT "acc_fiscal_closing_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "acc_fiscal_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_opening_balance" ADD CONSTRAINT "acc_opening_balance_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "acc_fiscal_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_opening_balance" ADD CONSTRAINT "acc_opening_balance_source_fiscal_year_id_fkey" FOREIGN KEY ("source_fiscal_year_id") REFERENCES "acc_fiscal_year"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_opening_balance_line" ADD CONSTRAINT "acc_opening_balance_line_opening_id_fkey" FOREIGN KEY ("opening_id") REFERENCES "acc_opening_balance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_opening_balance_line" ADD CONSTRAINT "acc_opening_balance_line_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_opening_balance_line" ADD CONSTRAINT "acc_opening_balance_line_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_journal" ADD CONSTRAINT "acc_journal_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_journal_line" ADD CONSTRAINT "acc_journal_line_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "acc_journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_journal_line" ADD CONSTRAINT "acc_journal_line_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_journal_line" ADD CONSTRAINT "acc_journal_line_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_journal_line" ADD CONSTRAINT "acc_journal_line_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
