-- A Tagihan Biaya Produksi never records more paid than it asks, nor less than
-- nothing (P132's rule for the documents that keep what they were paid).
ALTER TABLE "prd_cost_bill" ADD CONSTRAINT "prd_cost_bill_paid_within_total"
  CHECK ("paid_amount" >= 0 AND "paid_amount" <= "total_amount");
