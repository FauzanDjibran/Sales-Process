-- P111: unit prices are kept unrounded, Decimal(18,6); every amount stays
-- whole rupiah. The Invoice stores its own gross and discount, line and header,
-- with the discount type and value copied from its order line.

ALTER TABLE "sal_customer_order_line" ALTER COLUMN "price" TYPE DECIMAL(18,6);
ALTER TABLE "fin_ar_invoice_line" ALTER COLUMN "price" TYPE DECIMAL(18,6);
ALTER TABLE "tax_faktur_line" ALTER COLUMN "price" TYPE DECIMAL(18,6);

ALTER TABLE "fin_ar_invoice_line" ADD COLUMN "gross_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fin_ar_invoice_line" ADD COLUMN "discount_type" "DiscountType";
ALTER TABLE "fin_ar_invoice_line" ADD COLUMN "discount_value" DECIMAL(18,4);
ALTER TABLE "fin_ar_invoice_line" ADD COLUMN "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fin_ar_invoice" ADD COLUMN "gross_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fin_ar_invoice" ADD COLUMN "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- Existing lines: gross is qty × price rounded, the discount what separates it
-- from the amount already stored, so gross − discount = amount still holds.
UPDATE "fin_ar_invoice_line" l SET
  "gross_amount" = ROUND(l."qty" * l."price", 0),
  "discount_amount" = ROUND(l."qty" * l."price", 0) - l."amount",
  "discount_type" = c."discount_type",
  "discount_value" = c."discount_value"
FROM "sal_customer_order_line" c
WHERE c."id" = l."customer_order_line_id";

UPDATE "fin_ar_invoice" v SET
  "gross_amount" = s.gross, "discount_amount" = s.discount
FROM (SELECT invoice_id, SUM(gross_amount) AS gross, SUM(discount_amount) AS discount FROM "fin_ar_invoice_line" GROUP BY invoice_id) s
WHERE s.invoice_id = v."id";
