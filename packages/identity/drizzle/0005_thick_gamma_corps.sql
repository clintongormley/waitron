CREATE TABLE "management_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "management_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "management_sessions" ADD CONSTRAINT "management_sessions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_sessions" ADD CONSTRAINT "management_sessions_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "management_sessions_tenant_id_idx" ON "management_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "management_sessions_open_idx" ON "management_sessions" USING btree ("tenant_id","person_id");