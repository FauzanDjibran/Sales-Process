-- A Stock Issue no Unit receives (Pemusnahan, Pengambilan Sampel) ends as Posted (P324).
ALTER TYPE "StockIssueStatus" ADD VALUE 'Posted' BEFORE 'Cancelled';
