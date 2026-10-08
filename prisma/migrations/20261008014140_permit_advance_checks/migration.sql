-- What a Uang Muka Perizinan was paid never goes below 0 or above its total (P132).
ALTER TABLE "fin_ar_permit_advance"
  ADD CONSTRAINT "fin_ar_permit_advance_paid_amount_range" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "total_amount");
