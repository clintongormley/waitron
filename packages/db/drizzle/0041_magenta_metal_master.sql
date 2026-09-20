ALTER TABLE "sale_lines" ADD COLUMN "option_snapshots" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" DROP COLUMN "modifier_snapshots";