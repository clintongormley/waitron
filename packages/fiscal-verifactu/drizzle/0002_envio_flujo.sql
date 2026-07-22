CREATE TABLE "envio_flujo" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"proximo_envio_en" timestamp with time zone NOT NULL,
	"tiempo_espera_seg" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "envio_flujo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "envio_flujo" ADD CONSTRAINT "envio_flujo_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;