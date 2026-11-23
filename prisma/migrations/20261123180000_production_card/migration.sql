-- P315: Kartu No. Stok became a part of Kartu Produksi; the permission is renamed in place, so roles keep it.
UPDATE "sys_permission"
   SET "permission_code" = 'REPORT_PRODUCTION_CARD_VIEW', "permission_name" = 'Lihat Kartu Produksi',
       "description" = 'Mutasi jumlah per barang per unit, atau per No. Stok.', "updated_at" = now()
 WHERE "permission_code" = 'REPORT_LOT_CARD_VIEW';
