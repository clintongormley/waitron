ALTER TABLE "working_order_lines" DROP CONSTRAINT "working_order_lines_vat_rate_ck";--> statement-breakpoint
ALTER TABLE "purchase_invoice_vat" DROP CONSTRAINT "purchase_invoice_vat_rate_ck";--> statement-breakpoint
ALTER TABLE "purchase_invoices" DROP CONSTRAINT "purchase_invoices_deductible_proportion_ck";--> statement-breakpoint
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_vat_rate_ck";--> statement-breakpoint
ALTER TABLE "working_order_lines" ALTER COLUMN "quantity" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "working_order_lines" ALTER COLUMN "vat_rate" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "purchase_invoice_vat" ALTER COLUMN "rate" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ALTER COLUMN "deductible_proportion" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ALTER COLUMN "deductible_proportion" SET DEFAULT 10000;--> statement-breakpoint
ALTER TABLE "sale_lines" ALTER COLUMN "quantity" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sale_lines" ALTER COLUMN "vat_rate" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD CONSTRAINT "working_order_lines_vat_rate_ck" CHECK ("working_order_lines"."vat_rate" >= 0 and "working_order_lines"."vat_rate" <= 10000);--> statement-breakpoint
ALTER TABLE "purchase_invoice_vat" ADD CONSTRAINT "purchase_invoice_vat_rate_ck" CHECK ("purchase_invoice_vat"."rate" >= 0 and "purchase_invoice_vat"."rate" <= 10000);--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_deductible_proportion_ck" CHECK ("purchase_invoices"."deductible_proportion" >= 0 and "purchase_invoices"."deductible_proportion" <= 10000);--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_vat_rate_ck" CHECK ("sale_lines"."vat_rate" >= 0 and "sale_lines"."vat_rate" <= 10000);