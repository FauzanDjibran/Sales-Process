-- CreateEnum
CREATE TYPE "PermitCategory" AS ENUM ('Regulatory', 'Laboratory', 'Certification', 'IntellectualProperty');

-- CreateTable
CREATE TABLE "ref_permit_type" (
    "id" SERIAL NOT NULL,
    "permit_code" TEXT NOT NULL,
    "permit_label" TEXT NOT NULL,
    "permit_name" TEXT NOT NULL,
    "category" "PermitCategory" NOT NULL,
    "default_description" TEXT,
    "standard_estimate" DECIMAL(18,2),
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ref_permit_type_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ref_permit_type_permit_code_key" ON "ref_permit_type"("permit_code");
