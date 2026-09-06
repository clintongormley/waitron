-- Fiscal grants, enumeration and capture depend on the earlier core and sync baselines.
-- reject_mutation() is defined by core; sync_capture() is defined by sync.

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
CREATE FUNCTION envios_tenants_with_work(p_now timestamptz)
  RETURNS setof uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT tenant_id
  FROM envios
  WHERE (estado = 'pendiente' AND proximo_intento_en <= p_now)
     OR (estado = 'enviando' AND enviado_en < p_now - interval '300000 milliseconds')
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION envios_tenants_with_work(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION envios_tenants_with_work(timestamptz) TO app_user;
--> statement-breakpoint
REVOKE ALL ON "acks" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "acks" TO app_user;
--> statement-breakpoint
GRANT DELETE ON "acks" TO app_user;
--> statement-breakpoint
CREATE TRIGGER registros_facturacion_capture AFTER INSERT ON registros_facturacion
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER registro_sif_capture AFTER INSERT OR UPDATE ON registro_sif
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER cadenas_capture AFTER INSERT OR UPDATE ON cadenas
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER envios_capture AFTER INSERT OR UPDATE ON envios
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER envio_flujo_capture AFTER INSERT OR UPDATE ON envio_flujo
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER acks_capture AFTER INSERT OR UPDATE OR DELETE ON acks
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint

-- Append-only records reject UPDATE, DELETE and TRUNCATE during replication too.
ALTER TABLE registros_facturacion ENABLE ALWAYS TRIGGER registros_facturacion_enforce_immutability;
--> statement-breakpoint
ALTER TABLE registros_facturacion ENABLE ALWAYS TRIGGER registros_facturacion_block_truncate;
