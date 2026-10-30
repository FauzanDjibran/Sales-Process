-- AlterTable
ALTER TABLE "acc_item_category_account" ADD COLUMN     "wip_account_id" INTEGER;

-- AlterTable
ALTER TABLE "m_item" ADD COLUMN     "value_weight" DECIMAL(18,6);

-- CreateTable
CREATE TABLE "ref_workstation" (
    "id" SERIAL NOT NULL,
    "workstation_code" TEXT NOT NULL,
    "workstation_label" TEXT NOT NULL,
    "workstation_name" TEXT NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ref_workstation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acc_cost_type" (
    "id" SERIAL NOT NULL,
    "cost_type_code" TEXT NOT NULL,
    "cost_type_label" TEXT NOT NULL,
    "cost_type_name" TEXT NOT NULL,
    "expense_account_id" INTEGER NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_cost_type_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ref_workstation_workstation_code_key" ON "ref_workstation"("workstation_code");

-- CreateIndex
CREATE UNIQUE INDEX "acc_cost_type_cost_type_code_key" ON "acc_cost_type"("cost_type_code");

-- CreateIndex
CREATE INDEX "acc_cost_type_expense_account_id_idx" ON "acc_cost_type"("expense_account_id");

-- AddForeignKey
ALTER TABLE "acc_item_category_account" ADD CONSTRAINT "acc_item_category_account_wip_account_id_fkey" FOREIGN KEY ("wip_account_id") REFERENCES "acc_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acc_cost_type" ADD CONSTRAINT "acc_cost_type_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
