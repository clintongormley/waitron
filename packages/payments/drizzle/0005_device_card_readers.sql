CREATE TABLE "device_card_readers" (
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"reader_id" uuid NOT NULL,
	CONSTRAINT "device_card_readers_tenant_id_device_id_pk" PRIMARY KEY("tenant_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "device_card_readers" ADD CONSTRAINT "device_card_readers_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_card_readers" ADD CONSTRAINT "device_card_readers_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_card_readers" ADD CONSTRAINT "device_card_readers_reader_fk" FOREIGN KEY ("tenant_id","reader_id") REFERENCES "public"."card_readers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;