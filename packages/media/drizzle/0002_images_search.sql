CREATE FUNCTION media_text_config(language text) RETURNS regconfig
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE split_part(language, '-', 1)
    WHEN 'ar' THEN 'pg_catalog.arabic'
    WHEN 'hy' THEN 'pg_catalog.armenian'
    WHEN 'eu' THEN 'pg_catalog.basque'
    WHEN 'ca' THEN 'pg_catalog.catalan'
    WHEN 'da' THEN 'pg_catalog.danish'
    WHEN 'nl' THEN 'pg_catalog.dutch'
    WHEN 'en' THEN 'pg_catalog.english'
    WHEN 'et' THEN 'pg_catalog.estonian'
    WHEN 'fi' THEN 'pg_catalog.finnish'
    WHEN 'fr' THEN 'pg_catalog.french'
    WHEN 'de' THEN 'pg_catalog.german'
    WHEN 'el' THEN 'pg_catalog.greek'
    WHEN 'hi' THEN 'pg_catalog.hindi'
    WHEN 'hu' THEN 'pg_catalog.hungarian'
    WHEN 'id' THEN 'pg_catalog.indonesian'
    WHEN 'ga' THEN 'pg_catalog.irish'
    WHEN 'it' THEN 'pg_catalog.italian'
    WHEN 'lt' THEN 'pg_catalog.lithuanian'
    WHEN 'ne' THEN 'pg_catalog.nepali'
    WHEN 'no' THEN 'pg_catalog.norwegian'
    WHEN 'nb' THEN 'pg_catalog.norwegian'
    WHEN 'nn' THEN 'pg_catalog.norwegian'
    WHEN 'pt' THEN 'pg_catalog.portuguese'
    WHEN 'ro' THEN 'pg_catalog.romanian'
    WHEN 'ru' THEN 'pg_catalog.russian'
    WHEN 'sr' THEN 'pg_catalog.serbian'
    WHEN 'es' THEN 'pg_catalog.spanish'
    WHEN 'sv' THEN 'pg_catalog.swedish'
    WHEN 'ta' THEN 'pg_catalog.tamil'
    WHEN 'tr' THEN 'pg_catalog.turkish'
    WHEN 'yi' THEN 'pg_catalog.yiddish'
    ELSE 'pg_catalog.simple'
  END::regconfig
$$;
--> statement-breakpoint
CREATE FUNCTION media_search_vector(names jsonb, alt_text jsonb, labels text[]) RETURNS tsvector
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE result tsvector := ''::tsvector; translation record;
BEGIN
  FOR translation IN SELECT * FROM jsonb_each_text(names) ORDER BY key LOOP
    result := result || setweight(to_tsvector(public.media_text_config(translation.key), translation.value), 'A');
  END LOOP;
  FOR translation IN SELECT * FROM jsonb_each_text(alt_text) ORDER BY key LOOP
    result := result || setweight(to_tsvector(public.media_text_config(translation.key), translation.value), 'C');
  END LOOP;
  RETURN result || setweight(to_tsvector('pg_catalog.simple', array_to_string(labels, ' ')), 'B');
END
$$;
--> statement-breakpoint
CREATE FUNCTION media_search_query(query text) RETURNS tsquery
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE result tsquery := websearch_to_tsquery('pg_catalog.simple', query); language text;
BEGIN
  FOREACH language IN ARRAY ARRAY['ar','hy','eu','ca','da','nl','en','et','fi','fr','de','el','hi','hu','id','ga','it','lt','ne','no','pt','ro','ru','sr','es','sv','ta','tr','yi'] LOOP
    result := result || websearch_to_tsquery(public.media_text_config(language), query);
  END LOOP;
  RETURN result;
END
$$;
--> statement-breakpoint
CREATE INDEX media_images_search_idx ON media_images USING gin (public.media_search_vector(names, alt_text, labels));
