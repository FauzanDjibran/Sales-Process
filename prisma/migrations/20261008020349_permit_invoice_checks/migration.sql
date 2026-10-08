ALTER TABLE "fin_ar_permit_invoice" ADD CONSTRAINT "fin_ar_permit_invoice_paid_within_total" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "total_amount");
