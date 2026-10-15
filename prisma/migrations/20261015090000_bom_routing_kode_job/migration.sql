-- Walet build step 1 (production_project.md M117, M122, M126; walet/build-plan.md):
-- the Workstation's Kode Job, the Item's output type and value weight, and the
-- Bill of Materials and Routing masters. Nothing here posts.

-- CreateEnum
CREATE TYPE "ItemOutputType" AS ENUM ('Utama', 'Turunan', 'BJL');

-- CreateEnum
CREATE TYPE "RoutingStepMode" AS ENUM ('MixTransform', 'Transform', 'PassThrough');

-- AlterTable
ALTER TABLE "m_item" ADD COLUMN     "output_type" "ItemOutputType",
ADD COLUMN     "value_weight" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "ref_workstation" ADD COLUMN     "job_code" TEXT;

-- CreateTable
CREATE TABLE "prd_bom" (
    "id" SERIAL NOT NULL,
    "bom_code" TEXT NOT NULL,
    "bom_label" TEXT NOT NULL,
    "bom_name" TEXT NOT NULL,
    "item_id" INTEGER NOT NULL,
    "base_qty" DECIMAL(18,6) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_bom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_bom_line" (
    "id" SERIAL NOT NULL,
    "bom_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "step_no" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_bom_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_routing" (
    "id" SERIAL NOT NULL,
    "routing_code" TEXT NOT NULL,
    "routing_label" TEXT NOT NULL,
    "routing_name" TEXT NOT NULL,
    "item_id" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_routing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_routing_step" (
    "id" SERIAL NOT NULL,
    "routing_id" INTEGER NOT NULL,
    "step_no" INTEGER NOT NULL,
    "workstation_id" INTEGER NOT NULL,
    "mode" "RoutingStepMode" NOT NULL,
    "bom_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_routing_step_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prd_bom_bom_code_key" ON "prd_bom"("bom_code");

-- CreateIndex
CREATE INDEX "prd_bom_item_id_idx" ON "prd_bom"("item_id");

-- CreateIndex
CREATE INDEX "prd_bom_line_item_id_idx" ON "prd_bom_line"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_bom_line_bom_id_item_id_key" ON "prd_bom_line"("bom_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_routing_routing_code_key" ON "prd_routing"("routing_code");

-- CreateIndex
CREATE INDEX "prd_routing_item_id_idx" ON "prd_routing"("item_id");

-- CreateIndex
CREATE INDEX "prd_routing_step_workstation_id_idx" ON "prd_routing_step"("workstation_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_routing_step_routing_id_step_no_key" ON "prd_routing_step"("routing_id", "step_no");

-- CreateIndex
CREATE UNIQUE INDEX "ref_workstation_job_code_key" ON "ref_workstation"("job_code");

-- AddForeignKey
ALTER TABLE "prd_bom" ADD CONSTRAINT "prd_bom_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_bom_line" ADD CONSTRAINT "prd_bom_line_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "prd_bom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_bom_line" ADD CONSTRAINT "prd_bom_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_routing" ADD CONSTRAINT "prd_routing_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_routing_step" ADD CONSTRAINT "prd_routing_step_routing_id_fkey" FOREIGN KEY ("routing_id") REFERENCES "prd_routing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_routing_step" ADD CONSTRAINT "prd_routing_step_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_routing_step" ADD CONSTRAINT "prd_routing_step_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "prd_bom"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Figures the forms also check.
ALTER TABLE "m_item" ADD CONSTRAINT "m_item_value_weight_check" CHECK ("value_weight" IS NULL OR "value_weight" >= 0);
ALTER TABLE "prd_bom" ADD CONSTRAINT "prd_bom_base_qty_check" CHECK ("base_qty" > 0);
ALTER TABLE "prd_bom_line" ADD CONSTRAINT "prd_bom_line_qty_check" CHECK ("qty" > 0);
ALTER TABLE "prd_bom_line" ADD CONSTRAINT "prd_bom_line_step_no_check" CHECK ("step_no" IS NULL OR "step_no" > 0);
ALTER TABLE "prd_routing_step" ADD CONSTRAINT "prd_routing_step_step_no_check" CHECK ("step_no" > 0);
