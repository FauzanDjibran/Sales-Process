-- AR items and Buku Piutang (Claude-ERP.md P71–P75).

-- CreateEnum
CREATE TYPE "ArItemType" AS ENUM ('Advance', 'Invoice');

-- CreateEnum
CREATE TYPE "ArDirection" AS ENUM ('Increase', 'Decrease');

-- CreateEnum
CREATE TYPE "ArEvent" AS ENUM ('Create', 'Payment', 'AdvanceUsed');

-- CreateTable
CREATE TABLE "fin_ar_item" (
    "id" SERIAL NOT NULL,
    "item_type" "ArItemType" NOT NULL,
    "direction" "ArDirection" NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "item_date" DATE NOT NULL,
    "due_date" DATE,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "ref_doc_type_id" INTEGER,
    "ref_doc_id" INTEGER,
    "ref_no" TEXT,
    "order_id" INTEGER,
    "order_no" TEXT,
    "current_balance" DECIMAL(18,2) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_ar_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_ar_ledger" (
    "id" SERIAL NOT NULL,
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

    CONSTRAINT "fin_ar_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_ar_item_partner_id_item_type_idx" ON "fin_ar_item"("partner_id", "item_type");

-- CreateIndex
CREATE INDEX "fin_ar_item_order_id_idx" ON "fin_ar_item"("order_id");

-- CreateIndex
CREATE INDEX "fin_ar_item_source_doc_type_id_source_doc_id_idx" ON "fin_ar_item"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE INDEX "fin_ar_item_ref_doc_type_id_ref_doc_id_idx" ON "fin_ar_item"("ref_doc_type_id", "ref_doc_id");

-- CreateIndex
CREATE INDEX "fin_ar_ledger_item_id_entry_date_idx" ON "fin_ar_ledger"("item_id", "entry_date");

-- CreateIndex
CREATE INDEX "fin_ar_ledger_doc_type_id_doc_id_idx" ON "fin_ar_ledger"("doc_type_id", "doc_id");

-- AddForeignKey
ALTER TABLE "fin_ar_item" ADD CONSTRAINT "fin_ar_item_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_item" ADD CONSTRAINT "fin_ar_item_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_item" ADD CONSTRAINT "fin_ar_item_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_item" ADD CONSTRAINT "fin_ar_item_ref_doc_type_id_fkey" FOREIGN KEY ("ref_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_ledger" ADD CONSTRAINT "fin_ar_ledger_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "fin_ar_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_ledger" ADD CONSTRAINT "fin_ar_ledger_counter_item_id_fkey" FOREIGN KEY ("counter_item_id") REFERENCES "fin_ar_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_ledger" ADD CONSTRAINT "fin_ar_ledger_doc_type_id_fkey" FOREIGN KEY ("doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: every receipt already posted for an advance bill received an Uang
-- Muka — one AR item per bill line, at its DPP part (P73), with the CREATE
-- entry naming the receipt. Nothing else has touched those items yet.
INSERT INTO "fin_ar_item" (
  "item_type", "direction", "partner_id", "currency_id", "item_date",
  "source_doc_type_id", "source_doc_id", "source_no",
  "ref_doc_type_id", "ref_doc_id", "ref_no", "order_id", "order_no",
  "current_balance", "created_by", "created_at", "updated_at"
)
SELECT 'Advance', 'Decrease', t."partner_id", cb."currency_id", t."tx_date",
       st."id", t."id", t."tx_no",
       l."doc_type_id", l."doc_id", a."advance_no", a."order_id", o."order_no",
       l."dpp_part", t."created_by", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "fin_cash_bank_tx" t
JOIN "fin_cash_bank_tx_line" l ON l."tx_id" = t."id"
JOIN "m_cash_bank" cb ON cb."id" = t."cash_bank_id"
JOIN "sys_doc_type" st ON st."doc_table" = 'fin_cash_bank_tx'
JOIN "sys_doc_type" lt ON lt."id" = l."doc_type_id" AND lt."doc_table" = 'sal_advance'
JOIN "sal_advance" a ON a."id" = l."doc_id"
JOIN "sal_order" o ON o."id" = a."order_id"
WHERE t."status" = 'Posted' AND t."purpose" = 'sales_advance' AND l."dpp_part" > 0
ORDER BY t."id", l."line_no";

INSERT INTO "fin_ar_ledger" (
  "item_id", "event", "entry_date", "amount", "movement", "balance_after",
  "doc_type_id", "doc_id", "doc_no", "note", "created_by", "created_at"
)
SELECT i."id", 'Create', i."item_date", i."current_balance", i."current_balance", i."current_balance",
       i."source_doc_type_id", i."source_doc_id", i."source_no",
       'Uang muka ' || i."ref_no" || ' diterima', i."created_by", CURRENT_TIMESTAMP
FROM "fin_ar_item" i
ORDER BY i."id";
