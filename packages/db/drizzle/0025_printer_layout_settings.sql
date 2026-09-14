CREATE TYPE "public"."print_character_set" AS ENUM('wpc1252', 'pc858', 'plain');--> statement-breakpoint
CREATE TYPE "public"."print_paper_width" AS ENUM('58mm', '80mm');--> statement-breakpoint
CREATE TYPE "public"."print_resolution" AS ENUM('180dpi', '203dpi');--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "paper_width" "print_paper_width" DEFAULT '80mm' NOT NULL;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "resolution" "print_resolution" DEFAULT '180dpi' NOT NULL;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "character_set" "print_character_set" DEFAULT 'wpc1252' NOT NULL;