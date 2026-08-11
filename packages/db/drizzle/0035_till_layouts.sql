CREATE TABLE "till_layouts" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"definition" jsonb NOT NULL,
	"receipt" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "till_layouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "till_layouts" ADD CONSTRAINT "till_layouts_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;