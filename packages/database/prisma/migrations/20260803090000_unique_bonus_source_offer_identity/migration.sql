-- Fail closed rather than choosing a winner if existing non-null source keys
-- are already ambiguous within a casino.
DO $$
DECLARE
  duplicate_pair_count INTEGER;
  duplicate_pair_sample TEXT;
BEGIN
  SELECT COUNT(*)
  INTO duplicate_pair_count
  FROM (
    SELECT "casino_id", "source_offer_key"
    FROM "Bonus"
    WHERE "source_offer_key" IS NOT NULL
    GROUP BY "casino_id", "source_offer_key"
    HAVING COUNT(*) > 1
  ) AS duplicate_pairs;

  IF duplicate_pair_count > 0 THEN
    SELECT STRING_AGG(
      FORMAT(
        'casino_id=%s source_offer_key=%s rows=%s',
        duplicate_pairs."casino_id",
        duplicate_pairs."source_offer_key",
        duplicate_pairs.row_count
      ),
      '; '
    )
    INTO duplicate_pair_sample
    FROM (
      SELECT "casino_id", "source_offer_key", COUNT(*) AS row_count
      FROM "Bonus"
      WHERE "source_offer_key" IS NOT NULL
      GROUP BY "casino_id", "source_offer_key"
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, "casino_id", "source_offer_key"
      LIMIT 20
    ) AS duplicate_pairs;

    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = FORMAT(
        'Cannot enforce Bonus source identity uniqueness: %s duplicate (casino_id, source_offer_key) pair(s) exist',
        duplicate_pair_count
      ),
      DETAIL = duplicate_pair_sample,
      HINT = 'Resolve the reported duplicate identities deliberately before retrying this migration; no rows were changed.';
  END IF;
END $$;

DROP INDEX "Bonus_source_offer_key_idx";

CREATE UNIQUE INDEX "Bonus_casino_id_source_offer_key_key"
  ON "Bonus"("casino_id", "source_offer_key");
