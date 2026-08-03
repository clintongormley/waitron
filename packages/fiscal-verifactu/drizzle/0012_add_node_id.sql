ALTER TABLE "cadenas" ADD COLUMN "node_id" uuid;--> statement-breakpoint
ALTER TABLE "registro_sif" ADD COLUMN "node_id" uuid;--> statement-breakpoint
ALTER TABLE "registros_facturacion" ADD COLUMN "node_id" uuid;--> statement-breakpoint
ALTER TABLE "cadenas" ADD CONSTRAINT "cadenas_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registro_sif" ADD CONSTRAINT "registro_sif_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registros_facturacion" ADD CONSTRAINT "registros_facturacion_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;