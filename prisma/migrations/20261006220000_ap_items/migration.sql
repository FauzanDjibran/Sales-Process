-- P127: AP items and Buku Hutang (Purchasing-Concept.md B32), the AR items mirrored.

-- CreateTable
CREATE TABLE "fin_ap_item" (
    "id" SERIAL NOT NULL,
    "ap_item_no" TEXT NOT NULL,
    "item_type" "ArItemType" NOT NULL,
    "direction" "ArDirection" NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "item_date" DATE NOT NULL,
    "due_date" DATE,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "purchase_order_id" INTEGER,
    "current_balance" DECIMAL(18,2) NOT NULL,
    "original_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_ap_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_ap_ledger" (
    "id" SERIAL NOT NULL,
    "ledger_no" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "event" "ArEvent" NOT NULL,
    "entry_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "movement" DECIMAL(18,2) NOT NULL,
    "balance_after" DECIMAL(18,2) NOT NULL,
    "doc_type_id" INTEGER NOT NULL,
    "doc_id" INTEGER NOT NULL,
    "doc_no" TEXT NOT NULL,
    "counter_item_id" INTEGER,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_ap_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_ap_item_ap_item_no_key" ON "fin_ap_item"("ap_item_no");

-- CreateIndex
CREATE INDEX "fin_ap_item_partner_id_item_type_idx" ON "fin_ap_item"("partner_id", "item_type");

-- CreateIndex
CREATE INDEX "fin_ap_item_purchase_order_id_idx" ON "fin_ap_item"("purchase_order_id");

-- CreateIndex
CREATE INDEX "fin_ap_item_source_doc_type_id_source_doc_id_idx" ON "fin_ap_item"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE INDEX "fin_ap_ledger_item_id_entry_date_idx" ON "fin_ap_ledger"("item_id", "entry_date");

-- CreateIndex
CREATE INDEX "fin_ap_ledger_doc_type_id_doc_id_idx" ON "fin_ap_ledger"("doc_type_id", "doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_ap_ledger_ledger_no_line_no_key" ON "fin_ap_ledger"("ledger_no", "line_no");

-- AddForeignKey
ALTER TABLE "fin_ap_item" ADD CONSTRAINT "fin_ap_item_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ap_item" ADD CONSTRAINT "fin_ap_item_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ap_item" ADD CONSTRAINT "fin_ap_item_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ap_ledger" ADD CONSTRAINT "fin_ap_ledger_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "fin_ap_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ap_ledger" ADD CONSTRAINT "fin_ap_ledger_counter_item_id_fkey" FOREIGN KEY ("counter_item_id") REFERENCES "fin_ap_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ap_ledger" ADD CONSTRAINT "fin_ap_ledger_doc_type_id_fkey" FOREIGN KEY ("doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

