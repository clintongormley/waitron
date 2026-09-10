ALTER TABLE "working_line_contexts" ADD COLUMN "pricing_unit" text NOT NULL;--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD COLUMN "vat_class" text NOT NULL;--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD COLUMN "allergens" jsonb;--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD COLUMN "diet" jsonb;--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD COLUMN "diet_derivation" jsonb;--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD COLUMN "diet_override" jsonb;--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD CONSTRAINT "working_line_contexts_pricing_unit_ck" CHECK ("working_line_contexts"."pricing_unit" in ('each','weight'));--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD CONSTRAINT "working_line_contexts_vat_class_ck" CHECK ("working_line_contexts"."vat_class" in ('general','reduced','super_reduced','zero'));