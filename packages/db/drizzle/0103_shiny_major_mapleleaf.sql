CREATE TABLE "tenant_receipts" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"receipt" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_receipts" ADD CONSTRAINT "tenant_receipts_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;