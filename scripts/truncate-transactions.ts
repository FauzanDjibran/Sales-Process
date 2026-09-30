/**
 * Empties every transaction store, leaving master and system data standing.
 *
 * A hand-run script, deliberately outside install, migrate, reset and CI — the
 * same standing SIBA gave it.
 * It is what clears a database that has been used for trying things out, so the
 * people who own it can start entering real documents against a chart of
 * accounts, a partner list and a fiscal calendar they have already set up.
 *
 * This is **not** `db:reset`. Nothing is dropped, no migration is replayed, and
 * the seed is not re-run: the schema, the system tables and every master record
 * are untouched.
 *
 * WHAT IT DELETES
 *   fin_ar_ledger, fin_ar_item                     Buku Piutang and its AR items
 *   fin_cash_bank_tx(_line, _line_wht)             Penerimaan / Pengeluaran Kas & Bank
 *   acc_journal_line, acc_journal                  the books' journals
 *   cash_bank_ledger                               the Cash Bank Book
 *   sal_advance                                    Uang Muka Penjualan bills
 *   sal_order_line, sal_order                      Sales Orders
 *   audit_log rows belonging to those documents
 *
 * WHAT IT KEEPS
 *   every sys_* table and every ref_* master (currency, satuan, termin, gudang,
 *   Jenis PPh), m_partner with its addresses and contacts, m_item, m_cash_bank,
 *   the whole chart of accounts, acc_fiscal_year / acc_fiscal_period, the
 *   settings (System Default, Account Mapping), and the master records' own
 *   audit history.
 *
 * WHY THE RECEIPTS GO FIRST
 *   A receipt names the journal it posted and, by the weak pair, the advance
 *   bills it settled; its lines and their PPh rows cascade with it.
 *
 * WHY THE SALES DOCUMENTS GO IN THIS ORDER
 *   The foreign keys decide it: an advance bill names its Sales Order, and an
 *   order line names its order, so advances go first, then lines, then orders.
 *   With them gone, the customer addresses the orders named are free to be
 *   removed again (P53).
 *
 * WHY cash_bank_balance IS RESET RATHER THAN DELETED
 *   A Cash & Bank resource has a book from the moment it is registered, even at
 *   zero — `openCashBankBook` writes the balance row unconditionally and the
 *   rest of the application reads it without checking. Deleting those rows
 *   would leave a master record the reports cannot answer for, so every row is
 *   set back to zero instead, and any resource somehow missing one is given it.
 *
 * WHAT YOU DO NOT GET BACK
 *   Opening balances go with the book. Saldo Awal is a create-only field, so a
 *   resource cleared here cannot be given its opening figure again through the
 *   GUI — it would have to be deactivated and re-registered. That was chosen
 *   deliberately over keeping the Opening entries; it is stated here because it
 *   is the one consequence that is not reversible from inside the application.
 *
 * Document numbering restarts on its own: `nextDocumentNumber` reads the
 * highest row still in the table, so the series starts again at 0001. The
 * primary-key sequences are left alone — nothing in the application reads an
 * id as a number, and resetting them by hand buys only tidier integers.
 *
 * Everything happens in one transaction: either the database is clear or it is
 * exactly as it was.
 *
 * Run with:  npm run db:truncate-transactions -- --confirm
 * Without --confirm it only reports what it would delete, and deletes nothing.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

/** Audit rows follow the documents they describe; master history stays. */
const DOCUMENT_ENTITY_KEYS = ["acc_journal", "sal_order", "sal_advance", "fin_cash_bank_tx"];

async function main() {
  const confirmed = process.argv.includes("--confirm");

  const counts = {
    fin_ar_ledger: await prisma.finArLedger.count(),
    fin_ar_item: await prisma.finArItem.count(),
    fin_cash_bank_tx_line_wht: await prisma.finCashBankTxLineWht.count(),
    fin_cash_bank_tx_line: await prisma.finCashBankTxLine.count(),
    fin_cash_bank_tx: await prisma.finCashBankTx.count(),
    acc_journal_line: await prisma.accJournalLine.count(),
    acc_journal: await prisma.accJournal.count(),
    cash_bank_ledger: await prisma.cashBankLedger.count(),
    sal_advance: await prisma.salAdvance.count(),
    sal_order_line: await prisma.salOrderLine.count(),
    sal_order: await prisma.salOrder.count(),
    audit_log: await prisma.auditLog.count({
      where: { entity_key: { in: DOCUMENT_ENTITY_KEYS } },
    }),
  };

  const resources = await prisma.mCashBank.count();
  const total = Object.values(counts).reduce((t, n) => t + n, 0);

  console.log("\nData transaksi yang akan dihapus:\n");
  for (const [table, n] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(32)} ${String(n).padStart(7)}`);
  }
  console.log(`\n  ${"cash_bank_balance".padEnd(32)} ${String(resources).padStart(7)}  (direset ke nol, tidak dihapus)`);

  if (!total) {
    console.log("\nTidak ada data transaksi. Tidak ada yang dihapus.");
    return;
  }

  if (!confirmed) {
    console.log(
      `\n${total} baris akan dihapus, dan saldo ${resources} Cash & Bank direset ke nol.` +
        "\nMaster data (Partner, Item, Cash & Bank, Bagan Akun, Tahun Buku, pengaturan) tidak tersentuh." +
        "\nSaldo awal Cash & Bank ikut terhapus dan tidak dapat diisi ulang dari GUI." +
        "\n\nJalankan ulang dengan --confirm untuk benar-benar menghapus:" +
        "\n  npm run db:truncate-transactions -- --confirm\n"
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Buku Piutang and its AR items first: they record what the receipts and
    // invoices below created.
    await tx.finArLedger.deleteMany();
    await tx.finArItem.deleteMany();

    // Receipts next: each names the journal it posted. Their lines and PPh
    // rows cascade.
    await tx.finCashBankTx.deleteMany();

    // Order follows the foreign keys: lines before their documents.
    await tx.accJournalLine.deleteMany();
    await tx.accJournal.deleteMany();

    await tx.cashBankLedger.deleteMany();

    // Sales documents, children before what they name: an advance bill names
    // its order, a line its order.
    await tx.salAdvance.deleteMany();
    await tx.salOrderLine.deleteMany();
    await tx.salOrder.deleteMany();

    // Reset rather than delete — see the note at the top of this file.
    await tx.cashBankBalance.updateMany({
      data: {
        balance: 0,
        base_balance: 0,
        entry_count: 0,
        last_entry_id: null,
        last_entry_date: null,
      },
    });

    // A resource registered before this script existed always has one; this is
    // for the case where something went wrong earlier and left one without.
    const withBooks = new Set(
      (await tx.cashBankBalance.findMany({ select: { cash_bank_id: true } })).map(
        (b) => b.cash_bank_id
      )
    );
    const missing = (await tx.mCashBank.findMany({ select: { id: true } }))
      .map((r) => r.id)
      .filter((id) => !withBooks.has(id));
    if (missing.length) {
      await tx.cashBankBalance.createMany({
        data: missing.map((cash_bank_id) => ({ cash_bank_id })),
      });
    }

    await tx.auditLog.deleteMany({
      where: { entity_key: { in: DOCUMENT_ENTITY_KEYS } },
    });
  });

  console.log(
    `\n${total} baris dihapus. Saldo ${resources} Cash & Bank direset ke nol.` +
      "\nMaster data dan data sistem tidak tersentuh. Penomoran dokumen dimulai " +
      "kembali dari 0001.\n"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
