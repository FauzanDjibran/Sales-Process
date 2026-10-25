-- A lot may be split over several boxes (N5, M127): one source bucket can feed
-- several lines of a hand-over, once per box. The module checks that a box takes
-- a bucket once and that the lines together never exceed it.
DROP INDEX "prd_handover_line_handover_id_source_bucket_id_key";
CREATE INDEX "prd_handover_line_handover_id_source_bucket_id_idx" ON "prd_handover_line"("handover_id", "source_bucket_id");
