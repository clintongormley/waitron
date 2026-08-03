ALTER TABLE "invoice_series" DROP CONSTRAINT "invoice_series_node_id_nodes_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;