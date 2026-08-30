CREATE TABLE "location_catalogues" (
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	CONSTRAINT "location_catalogues_pk" PRIMARY KEY("tenant_id","location_id","catalogue_id")
);
--> statement-breakpoint
ALTER TABLE "location_catalogues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "location_catalogues" ADD CONSTRAINT "location_catalogues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogues" ADD CONSTRAINT "catalogues_tenant_id_key" UNIQUE("tenant_id","id");