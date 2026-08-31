ALTER TABLE "kitchen_stations" ADD COLUMN "warm_after_minutes" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD COLUMN "overdue_after_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD COLUMN "forgotten_after_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_thresholds_ordered" CHECK ("warm_after_minutes" < "overdue_after_minutes" AND "overdue_after_minutes" < "forgotten_after_minutes");