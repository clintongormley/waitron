CREATE TYPE "public"."purchase_regime" AS ENUM('general', 'equivalence_surcharge');--> statement-breakpoint
CREATE TYPE "public"."purchase_vat_kind" AS ENUM('ordinary', 'capital');--> statement-breakpoint
CREATE TABLE "purchase_invoice_vat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_invoice_id" uuid NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"base" numeric(12, 2) NOT NULL,
	"tax" numeric(12, 2) NOT NULL,
	"kind" "purchase_vat_kind" DEFAULT 'ordinary' NOT NULL,
	CONSTRAINT "purchase_invoice_vat_rate_ck" CHECK ("purchase_invoice_vat"."rate" >= 0 and "purchase_invoice_vat"."rate" <= 100)
);
--> statement-breakpoint
ALTER TABLE "purchase_invoice_vat" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_tax_id" text NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_invoice_number" text NOT NULL,
	"issued_on" date NOT NULL,
	"received_on" date NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"regime" "purchase_regime" DEFAULT 'general' NOT NULL,
	"deductible_proportion" numeric(5, 2) DEFAULT '100.00' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_invoices_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_invoices_supplier_number_key" UNIQUE("tenant_id","supplier_tax_id","supplier_invoice_number"),
	CONSTRAINT "purchase_invoices_deductible_proportion_ck" CHECK ("purchase_invoices"."deductible_proportion" >= 0 and "purchase_invoices"."deductible_proportion" <= 100)
);
--> statement-breakpoint
ALTER TABLE "purchase_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_invoice_vat" ADD CONSTRAINT "purchase_invoice_vat_invoice_fk" FOREIGN KEY ("tenant_id","purchase_invoice_id") REFERENCES "public"."purchase_invoices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_invoice_vat_invoice_idx" ON "purchase_invoice_vat" USING btree ("tenant_id","purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "purchase_invoices_tenant_received_idx" ON "purchase_invoices" USING btree ("tenant_id","received_on");