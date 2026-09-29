-- CreateTable
CREATE TABLE "ref_uom" (
    "id" SERIAL NOT NULL,
    "uom_code" TEXT NOT NULL,
    "uom_label" TEXT NOT NULL,
    "uom_name" TEXT NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ref_uom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ref_payment_term" (
    "id" SERIAL NOT NULL,
    "term_code" TEXT NOT NULL,
    "term_label" TEXT NOT NULL,
    "term_name" TEXT NOT NULL,
    "due_days" INTEGER NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ref_payment_term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ref_warehouse" (
    "id" SERIAL NOT NULL,
    "warehouse_code" TEXT NOT NULL,
    "warehouse_label" TEXT NOT NULL,
    "warehouse_name" TEXT NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ref_warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ref_withholding_tax" (
    "id" SERIAL NOT NULL,
    "wht_code" TEXT NOT NULL,
    "wht_label" TEXT NOT NULL,
    "wht_name" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "tax_object" TEXT,
    "prepaid_account_id" INTEGER,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ref_withholding_tax_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ref_uom_uom_code_key" ON "ref_uom"("uom_code");

-- CreateIndex
CREATE UNIQUE INDEX "ref_payment_term_term_code_key" ON "ref_payment_term"("term_code");

-- CreateIndex
CREATE UNIQUE INDEX "ref_warehouse_warehouse_code_key" ON "ref_warehouse"("warehouse_code");

-- CreateIndex
CREATE UNIQUE INDEX "ref_withholding_tax_wht_code_key" ON "ref_withholding_tax"("wht_code");

-- CreateIndex
CREATE INDEX "ref_withholding_tax_prepaid_account_id_idx" ON "ref_withholding_tax"("prepaid_account_id");

-- AddForeignKey
ALTER TABLE "ref_withholding_tax" ADD CONSTRAINT "ref_withholding_tax_prepaid_account_id_fkey" FOREIGN KEY ("prepaid_account_id") REFERENCES "acc_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
