CREATE TABLE "station_printers" (
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"printer_id" uuid NOT NULL,
	CONSTRAINT "station_printers_pk" PRIMARY KEY("tenant_id","station_id","printer_id")
);
--> statement-breakpoint
ALTER TABLE "station_printers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "station_printers" ADD CONSTRAINT "station_printers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;