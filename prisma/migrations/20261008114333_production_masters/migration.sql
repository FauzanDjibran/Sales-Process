-- CreateEnum
CREATE TYPE "ProductionCostGroup" AS ENUM ('DirectLabor', 'IndirectLabor', 'Utility', 'Depreciation', 'Maintenance', 'OtherOverhead');

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
CREATE TABLE "acc_production_cost_element" (
    "id" SERIAL NOT NULL,
    "element_code" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "element_group" "ProductionCostGroup" NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_production_cost_element_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ref_workstation_workstation_code_key" ON "ref_workstation"("workstation_code");

-- CreateIndex
CREATE UNIQUE INDEX "acc_production_cost_element_element_code_key" ON "acc_production_cost_element"("element_code");

-- CreateIndex
CREATE UNIQUE INDEX "acc_production_cost_element_account_id_key" ON "acc_production_cost_element"("account_id");

-- AddForeignKey
ALTER TABLE "acc_production_cost_element" ADD CONSTRAINT "acc_production_cost_element_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
