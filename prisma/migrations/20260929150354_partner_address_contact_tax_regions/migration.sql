-- CreateEnum
CREATE TYPE "TaxpayerType" AS ENUM ('Badan', 'OrangPribadi', 'InstansiPemerintah');

-- CreateEnum
CREATE TYPE "TaxIdType" AS ENUM ('NPWP', 'NIK');

-- CreateEnum
CREATE TYPE "VatCollector" AS ENUM ('None', 'Government');

-- AlterTable
ALTER TABLE "m_partner" ADD COLUMN     "collects_pph22" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_pkp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tax_id" TEXT,
ADD COLUMN     "tax_id_type" "TaxIdType",
ADD COLUMN     "tax_name" TEXT,
ADD COLUMN     "taxpayer_type" "TaxpayerType",
ADD COLUMN     "vat_collector" "VatCollector",
ADD COLUMN     "withholds_pph23" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "m_partner_address" (
    "id" SERIAL NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "village_id" INTEGER NOT NULL,
    "street" TEXT NOT NULL,
    "note" TEXT,
    "is_billing" BOOLEAN NOT NULL DEFAULT false,
    "is_shipping" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_partner_address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m_partner_contact" (
    "id" SERIAL NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "contact_name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m_partner_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_region_province" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "sys_region_province_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_region_city" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "province_id" INTEGER NOT NULL,

    CONSTRAINT "sys_region_city_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_region_district" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city_id" INTEGER NOT NULL,

    CONSTRAINT "sys_region_district_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_region_village" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "district_id" INTEGER NOT NULL,
    "postal_code" TEXT,

    CONSTRAINT "sys_region_village_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "m_partner_address_partner_id_idx" ON "m_partner_address"("partner_id");

-- CreateIndex
CREATE INDEX "m_partner_address_village_id_idx" ON "m_partner_address"("village_id");

-- CreateIndex
CREATE INDEX "m_partner_contact_partner_id_idx" ON "m_partner_contact"("partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_region_province_code_key" ON "sys_region_province"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_region_city_code_key" ON "sys_region_city"("code");

-- CreateIndex
CREATE INDEX "sys_region_city_province_id_idx" ON "sys_region_city"("province_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_region_district_code_key" ON "sys_region_district"("code");

-- CreateIndex
CREATE INDEX "sys_region_district_city_id_idx" ON "sys_region_district"("city_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_region_village_code_key" ON "sys_region_village"("code");

-- CreateIndex
CREATE INDEX "sys_region_village_district_id_idx" ON "sys_region_village"("district_id");

-- AddForeignKey
ALTER TABLE "m_partner_address" ADD CONSTRAINT "m_partner_address_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_partner_address" ADD CONSTRAINT "m_partner_address_village_id_fkey" FOREIGN KEY ("village_id") REFERENCES "sys_region_village"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "m_partner_contact" ADD CONSTRAINT "m_partner_contact_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_region_city" ADD CONSTRAINT "sys_region_city_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "sys_region_province"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_region_district" ADD CONSTRAINT "sys_region_district_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "sys_region_city"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_region_village" ADD CONSTRAINT "sys_region_village_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "sys_region_district"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sales comes first, and a supplier's tax treatment is not designed yet, so
-- the seeded Supplier category is switched off (Claude-ERP.md P41). One-time:
-- the seed never changes it back, so an installation can turn it on again
-- through Partner Category when purchasing arrives.
UPDATE "sys_partner_category" SET "status" = 'Inactive', "updated_at" = now()
WHERE "category_label" = 'Supplier';
