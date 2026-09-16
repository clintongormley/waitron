-- Fiscal grants and enumeration depend on the earlier core baseline.
-- reject_mutation() is defined by core.

REVOKE ALL ON "registros_facturacion" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "registros_facturacion" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "cadenas" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "cadenas" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "registro_sif" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "registro_sif" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "envios" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "envios" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "contadores_instalacion" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "contadores_instalacion" TO app_user;
--> statement-breakpoint
CREATE TRIGGER "registros_facturacion_enforce_immutability"
  BEFORE UPDATE OR DELETE ON "registros_facturacion"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER "registros_facturacion_block_truncate"
  BEFORE TRUNCATE ON "registros_facturacion"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
REVOKE ALL ON "envio_flujo" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "envio_flujo" TO app_user;
--> statement-breakpoint
-- Is there anything to send right now? Read before the drain opens its own transaction, with the
-- caller's grants. Lone stale claims count, so a drain can recover them even with no pending row;
-- the interval below matches RECUPERACION_ENVIANDO_MS in drain.ts, and migrations.test.ts checks
-- both sides of that threshold.
CREATE FUNCTION envios_work_due(p_now timestamptz)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM envios
    WHERE (estado = 'pendiente' AND proximo_intento_en <= p_now)
       OR (estado = 'enviando' AND enviado_en < p_now - interval '300000 milliseconds')
  )
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION envios_work_due(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION envios_work_due(timestamptz) TO app_user;
--> statement-breakpoint
REVOKE ALL ON "acks" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "acks" TO app_user;
--> statement-breakpoint
GRANT DELETE ON "acks" TO app_user;
--> statement-breakpoint

-- Append-only records reject UPDATE, DELETE and TRUNCATE during replication too.
ALTER TABLE registros_facturacion ENABLE ALWAYS TRIGGER registros_facturacion_enforce_immutability;
--> statement-breakpoint
ALTER TABLE registros_facturacion ENABLE ALWAYS TRIGGER registros_facturacion_block_truncate;
