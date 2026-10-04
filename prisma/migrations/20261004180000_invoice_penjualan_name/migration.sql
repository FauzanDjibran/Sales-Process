-- P99: the sales invoice is named Invoice Penjualan in the application, so
-- the faktur pajak alone is called a Faktur. Its document type follows; the
-- table, the prefix INV/ and every posted record are unchanged.
UPDATE "sys_doc_type" SET "doc_label" = 'Invoice Penjualan', "doc_name" = 'Invoice Penjualan' WHERE "doc_table" = 'sal_invoice';
