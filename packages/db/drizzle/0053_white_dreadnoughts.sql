CREATE TYPE "public"."floor_table_shape" AS ENUM('round', 'square', 'rect');--> statement-breakpoint
ALTER TABLE "dining_tables" ADD COLUMN "pos_x" smallint;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD COLUMN "pos_y" smallint;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD COLUMN "shape" "floor_table_shape";--> statement-breakpoint
ALTER TABLE "dining_tables" ADD COLUMN "rotation" smallint;