-- A workstation knows how it works, and a BoM knows where it is used (P166).
-- The mode moves from the routing step to the workstation; the BoM names its
-- workstation, and a BoM line no longer names a routing step. Routing and
-- Perintah steps become stations in order.

-- 1. Each workstation takes the mode routings use it with most (else Transformasi).
ALTER TABLE "ref_workstation" ADD COLUMN "mode" "RoutingStepMode" NOT NULL DEFAULT 'Transform';
UPDATE "ref_workstation" w
   SET "mode" = m."mode"
  FROM (SELECT DISTINCT ON ("workstation_id") "workstation_id", "mode"
          FROM "prd_routing_step"
         GROUP BY "workstation_id", "mode"
         ORDER BY "workstation_id", COUNT(*) DESC, "mode") m
 WHERE m."workstation_id" = w."id";

-- 2. Each BoM line's station: the step it named in the first routing that uses
--    the BoM, else that routing's first step naming the BoM.
ALTER TABLE "prd_bom" ADD COLUMN "workstation_id" INTEGER;

CREATE TEMP TABLE bom_home AS
SELECT b."id" AS bom_id,
       COALESCE(
         (SELECT s."workstation_id" FROM "prd_routing_step" s WHERE s."bom_id" = b."id" ORDER BY s."routing_id", s."step_no" LIMIT 1),
         -- A BoM no routing names: the last station of its item's routing.
         (SELECT s."workstation_id" FROM "prd_routing" r JOIN "prd_routing_step" s ON s."routing_id" = r."id"
           WHERE r."item_id" = b."item_id" ORDER BY r."is_default" DESC, r."id", s."step_no" DESC LIMIT 1)
       ) AS ws,
       (SELECT s."routing_id" FROM "prd_routing_step" s WHERE s."bom_id" = b."id" ORDER BY s."routing_id", s."step_no" LIMIT 1) AS routing_id
  FROM "prd_bom" b;

DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(b."bom_label", ', ') INTO missing FROM "prd_bom" b JOIN bom_home h ON h.bom_id = b."id" WHERE h.ws IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'BoM without any workstation to place it at: %. Name it on a routing step first.', missing;
  END IF;
END $$;

UPDATE "prd_bom" b SET "workstation_id" = h.ws FROM bom_home h WHERE h.bom_id = b."id";

CREATE TEMP TABLE bom_line_ws AS
SELECT l."id" AS line_id, l."bom_id",
       COALESCE((SELECT s."workstation_id" FROM "prd_routing_step" s WHERE s."routing_id" = h.routing_id AND s."step_no" = l."step_no"), h.ws) AS ws
  FROM "prd_bom_line" l JOIN bom_home h ON h.bom_id = l."bom_id";

-- 3. Lines used at another station than their BoM's move to a BoM of their own
--    there: the same item, base quantity and default flag, labelled <BoM>-<station>.
DO $$
DECLARE
  g RECORD;
  next_no INTEGER;
  new_id INTEGER;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace("bom_code", '\D', '', 'g'), '')::INTEGER), 0) INTO next_no FROM "prd_bom";
  FOR g IN
    SELECT DISTINCT x.bom_id, x.ws FROM bom_line_ws x JOIN "prd_bom" b ON b."id" = x.bom_id WHERE x.ws <> b."workstation_id"
  LOOP
    next_no := next_no + 1;
    INSERT INTO "prd_bom" ("bom_code", "bom_label", "bom_name", "item_id", "workstation_id", "base_qty", "is_default", "note", "status", "created_by", "updated_at")
    SELECT 'bom.' || lpad(next_no::TEXT, 4, '0'), b."bom_label" || '-' || w."workstation_label", b."bom_name" || ' — ' || w."workstation_label",
           b."item_id", g.ws, b."base_qty", b."is_default", b."note", b."status", b."created_by", now()
      FROM "prd_bom" b JOIN "ref_workstation" w ON w."id" = g.ws WHERE b."id" = g.bom_id
    RETURNING "id" INTO new_id;
    UPDATE "prd_bom_line" l SET "bom_id" = new_id
      FROM bom_line_ws x WHERE x.line_id = l."id" AND x.bom_id = g.bom_id AND x.ws = g.ws;
  END LOOP;
END $$;

ALTER TABLE "prd_bom" ALTER COLUMN "workstation_id" SET NOT NULL;
CREATE INDEX "prd_bom_workstation_id_idx" ON "prd_bom"("workstation_id");
ALTER TABLE "prd_bom" ADD CONSTRAINT "prd_bom_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Steps are stations in order; a BoM line names no step.
ALTER TABLE "prd_bom_line" DROP COLUMN "step_no";
ALTER TABLE "prd_routing_step" DROP CONSTRAINT "prd_routing_step_bom_id_fkey";
ALTER TABLE "prd_routing_step" DROP COLUMN "bom_id", DROP COLUMN "mode";
ALTER TABLE "prd_order_step" DROP CONSTRAINT "prd_order_step_bom_id_fkey";
ALTER TABLE "prd_order_step" DROP COLUMN "bom_id", DROP COLUMN "mode";
