-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('Barang', 'Jasa');

-- CreateTable
CREATE TABLE "sys_item_category" (
    "id" SERIAL NOT NULL,
    "category_code" TEXT NOT NULL,
    "category_label" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "item_type" "ItemType" NOT NULL,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_item_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_item" (
    "id" SERIAL NOT NULL,
    "item_code" TEXT NOT NULL,
    "item_label" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "item_type" "ItemType" NOT NULL,
    "category_id" INTEGER NOT NULL,
    "base_uom_id" INTEGER NOT NULL,
    "can_sell" BOOLEAN NOT NULL DEFAULT true,
    "can_buy" BOOLEAN NOT NULL DEFAULT false,
    "track_stock" BOOLEAN NOT NULL DEFAULT false,
    "has_expiry" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_item_uom" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "factor" DECIMAL(18,4) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_item_uom_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sys_item_category_category_code_key" ON "sys_item_category"("category_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_item_category_category_label_key" ON "sys_item_category"("category_label");

-- CreateIndex
CREATE INDEX "sys_item_category_item_type_idx" ON "sys_item_category"("item_type");

-- CreateIndex
CREATE UNIQUE INDEX "m_item_item_code_key" ON "m_item"("item_code");

-- CreateIndex
CREATE INDEX "m_item_category_id_idx" ON "m_item"("category_id");

-- CreateIndex
CREATE INDEX "m_item_base_uom_id_idx" ON "m_item"("base_uom_id");

-- CreateIndex
CREATE INDEX "m_item_uom_uom_id_idx" ON "m_item_uom"("uom_id");

-- CreateIndex
CREATE UNIQUE INDEX "m_item_uom_item_id_uom_id_key" ON "m_item_uom"("item_id", "uom_id");

-- AddForeignKey
ALTER TABLE "m_item" ADD CONSTRAINT "m_item_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "sys_item_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_item" ADD CONSTRAINT "m_item_base_uom_id_fkey" FOREIGN KEY ("base_uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_item_uom" ADD CONSTRAINT "m_item_uom_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_item_uom" ADD CONSTRAINT "m_item_uom_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
