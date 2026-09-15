ALTER TABLE "scheduled_runs" DROP CONSTRAINT "scheduled_runs_tenant_fk";
--> statement-breakpoint
DROP INDEX "scheduled_runs_key";--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_runs_key" ON "scheduled_runs" USING btree ("duty","period_from","generation");--> statement-breakpoint
ALTER TABLE "scheduled_runs" DROP COLUMN "tenant_id";