-- A Unit's Kartu Produksi reads its own rows of a period (P327).
CREATE INDEX "prd_ledger_unit_id_posting_date_idx" ON "prd_ledger"("unit_id", "posting_date");
