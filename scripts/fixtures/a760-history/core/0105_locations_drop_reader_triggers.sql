-- Reader triggers are restored after the locations rebuild.
DROP TRIGGER IF EXISTS "working_order_lines_check_locales_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "working_order_lines_check_locales_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "working_order_lines_check_variant_locales_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "working_order_lines_check_variant_locales_update";
