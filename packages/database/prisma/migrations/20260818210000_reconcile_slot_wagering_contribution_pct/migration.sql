-- Reconcile a column omitted when the initial migration was baselined.
DO $$
DECLARE
    column_type OID;
    column_not_null BOOLEAN;
    column_default TEXT;
BEGIN
    SELECT
        attribute.atttypid,
        attribute.attnotnull,
        pg_get_expr(default_value.adbin, default_value.adrelid)
    INTO
        column_type,
        column_not_null,
        column_default
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation
        ON relation.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef AS default_value
        ON default_value.adrelid = attribute.attrelid
        AND default_value.adnum = attribute.attnum
    WHERE namespace.nspname = 'public'
        AND relation.relname = 'Slot'
        AND attribute.attname = 'wagering_contribution_pct'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped;

    IF NOT FOUND THEN
        ALTER TABLE public."Slot"
        ADD COLUMN "wagering_contribution_pct"
        DOUBLE PRECISION NOT NULL DEFAULT 100;
    ELSIF column_type <> 'pg_catalog.float8'::pg_catalog.regtype
        OR NOT column_not_null
        OR column_default IS NULL
        OR regexp_replace(column_default, '[[:space:]]+', '', 'g') NOT IN (
            '100',
            '100::doubleprecision',
            '100::float8',
            '100::pg_catalog.float8',
            '''100''::doubleprecision',
            '''100''::float8',
            '''100''::pg_catalog.float8'
        )
    THEN
        RAISE EXCEPTION
            'Unexpected definition for public."Slot"."wagering_contribution_pct" (type OID %, not null %, default %)',
            column_type,
            column_not_null,
            column_default;
    END IF;
END
$$;
