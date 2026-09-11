ALTER TABLE "print_agents" ADD COLUMN "node_id" uuid;--> statement-breakpoint
ALTER TABLE "print_agents" ADD CONSTRAINT "print_agents_tenant_node_key" UNIQUE("tenant_id","node_id");