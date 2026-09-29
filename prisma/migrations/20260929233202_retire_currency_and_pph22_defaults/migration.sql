-- P61: Currency Default gives way to the base currency, and the Jenis PPh
-- pointer for PPh 22 collectors is retired (Jenis PPh is a plain master).
-- Neither key is in the settings catalogue any more; their stored rows would
-- only ever be ignored, so they are removed rather than left behind.
DELETE FROM "sys_setting" WHERE "setting_key" IN ('default_currency', 'pph22_withholding_tax');
