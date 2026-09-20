ALTER TABLE "working_order_lines" ALTER COLUMN "unit_price" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "working_order_lines" ALTER COLUMN "unit_price_gross" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "working_order_lines" ALTER COLUMN "line_total" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "option_group_items" ALTER COLUMN "price_delta" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "unit_price" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "purchase_invoice_vat" ALTER COLUMN "base" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "purchase_invoice_vat" ALTER COLUMN "tax" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ALTER COLUMN "total" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sale_lines" ALTER COLUMN "unit_price" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sale_lines" ALTER COLUMN "line_total" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "total" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "tenders" ALTER COLUMN "amount" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "tenders" ALTER COLUMN "cash_tendered" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "tenders" ALTER COLUMN "tip_amount" SET DATA TYPE bigint;