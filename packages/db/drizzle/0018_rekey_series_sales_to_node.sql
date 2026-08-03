ALTER TABLE "invoice_series" DROP CONSTRAINT "invoice_series_till_code_key";--> statement-breakpoint
ALTER TABLE "invoice_series" DROP CONSTRAINT "invoice_series_till_id_tills_id_fk";
--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_node_id_nodes_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_series" ALTER COLUMN "node_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "node_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_series" DROP COLUMN "till_id";--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_node_code_key" UNIQUE("tenant_id","node_id","code");