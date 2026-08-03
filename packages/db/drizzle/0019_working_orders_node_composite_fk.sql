ALTER TABLE "working_orders" DROP CONSTRAINT "working_orders_node_id_nodes_id_fk";
--> statement-breakpoint
ALTER TABLE "working_orders" ADD CONSTRAINT "working_orders_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;