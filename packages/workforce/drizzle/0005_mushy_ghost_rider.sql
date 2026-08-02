CREATE TABLE "workforce_chains" (
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"sequence_no" integer DEFAULT 0 NOT NULL,
	"last_entry_id" uuid,
	"last_entry_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workforce_chains_tenant_id_location_id_pk" PRIMARY KEY("tenant_id","location_id"),
	CONSTRAINT "workforce_chains_pointer_ck" CHECK (("workforce_chains"."last_entry_id" is null) = ("workforce_chains"."last_entry_hash" is null))
);
--> statement-breakpoint
ALTER TABLE "workforce_chains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "entry_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "prev_entry_hash" text;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "sequence_no" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "is_first_entry" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "workforce_chains" ADD CONSTRAINT "workforce_chains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_chains" ADD CONSTRAINT "workforce_chains_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_chains" ADD CONSTRAINT "workforce_chains_last_entry_id_time_entries_id_fk" FOREIGN KEY ("last_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_chain_position_uq" ON "time_entries" USING btree ("tenant_id","location_id","sequence_no");--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_entry_hash_ck" CHECK ("time_entries"."entry_hash" ~ '^[0-9A-F]{64}$');--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_sequence_no_ck" CHECK ("time_entries"."sequence_no" > 0);--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_chaining_ck" CHECK (("time_entries"."is_first_entry" and "time_entries"."prev_entry_hash" is null)
          or (not "time_entries"."is_first_entry" and "time_entries"."prev_entry_hash" is not null));--> statement-breakpoint
-- Defence-in-depth for the hash chain (whole-branch review fix): event_at must carry NO sub-second
-- component. The chain hashes the absolute instant but every read-back projects event_at at SECOND
-- precision, so a stored fractional second would recompute to a different hash and read as tampered.
-- appendToChain truncates to whole seconds at the write choke point (../src/chain.ts); this CHECK
-- backstops any writer that bypasses it. Folded into this migration (pre-production, no bwc).
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_event_at_second_ck" CHECK (date_trunc('second', "time_entries"."event_at") = "time_entries"."event_at");