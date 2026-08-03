ALTER TABLE "payments" DROP CONSTRAINT "payments_node_id_nodes_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;