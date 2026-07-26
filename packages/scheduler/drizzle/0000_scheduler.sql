CREATE TABLE "scheduled_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"duty" text NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"summary" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_runs_state_ck" CHECK ("scheduled_runs"."state" in ('pending', 'running', 'succeeded', 'failed', 'parked')),
	CONSTRAINT "scheduled_runs_period_ck" CHECK ("scheduled_runs"."period_from" < "scheduled_runs"."period_to"),
	CONSTRAINT "scheduled_runs_generation_ck" CHECK ("scheduled_runs"."generation" >= 0),
	CONSTRAINT "scheduled_runs_attempts_ck" CHECK ("scheduled_runs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "scheduled_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_runs_key" ON "scheduled_runs" USING btree ("tenant_id","duty","period_from","generation");