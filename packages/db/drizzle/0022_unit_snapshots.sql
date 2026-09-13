ALTER TABLE "working_order_lines" ADD COLUMN "unit_name" jsonb;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD COLUMN "unit_precision" integer;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "unit_name" jsonb;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "unit_precision" integer;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD CONSTRAINT "working_order_lines_unit_precision_ck" CHECK ("working_order_lines"."unit_precision" is null or "working_order_lines"."unit_precision" between 0 and 3);--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_unit_precision_ck" CHECK ("sale_lines"."unit_precision" is null or "sale_lines"."unit_precision" between 0 and 3);