-- P83 / U27: Penerimaan Uang Muka Penjualan becomes Penerimaan dari Customer,
-- one purpose settling advance bills and Fakturs. The catalogue lives in code;
-- the rows that name the old key are renamed so one purpose reads everywhere.
-- Their postings are unchanged.
UPDATE "fin_cash_bank_tx" SET "purpose" = 'customer_receipt' WHERE "purpose" = 'sales_advance';
