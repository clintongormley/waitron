ALTER TABLE "invoice_series" ADD COLUMN "node_id" uuid;--> statement-breakpoint
ALTER TABLE "working_orders" ADD COLUMN "node_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "node_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_orders" ADD CONSTRAINT "working_orders_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;