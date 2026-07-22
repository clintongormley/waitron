CREATE TABLE "acks" (
	"registro_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"csv" text,
	"state" text NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "acks_state_ck" CHECK ("acks"."state" in ('accepted', 'accepted_with_errors', 'rejected', 'halted'))
);
--> statement-breakpoint
ALTER TABLE "acks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "acks" ADD CONSTRAINT "acks_registro_id_registros_facturacion_id_fk" FOREIGN KEY ("registro_id") REFERENCES "public"."registros_facturacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acks" ADD CONSTRAINT "acks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;