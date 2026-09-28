-- Hand-written in place of drizzle-kit's output, which rebuilt the six tables whose columns or keys
-- the rename touches and failed on a fresh database. SQLite's RENAME rewrites the foreign keys, CHECK
-- bodies and trigger bodies naming what it renames; the CHECK names and the stored scope value
-- 'visit' stay until a rebuild of those two tables.
DROP TRIGGER visits_clear_table_status;--> statement-breakpoint
ALTER TABLE `visits` RENAME TO `parties`;--> statement-breakpoint
ALTER TABLE `visit_tables` RENAME TO `party_tables`;--> statement-breakpoint
ALTER TABLE `parties` RENAME COLUMN `merged_into_visit_id` TO `merged_into_party_id`;--> statement-breakpoint
ALTER TABLE `party_tables` RENAME COLUMN `visit_id` TO `party_id`;--> statement-breakpoint
ALTER TABLE `working_orders` RENAME COLUMN `visit_id` TO `party_id`;--> statement-breakpoint
ALTER TABLE `order_groups` RENAME COLUMN `visit_id` TO `party_id`;--> statement-breakpoint
ALTER TABLE `order_group_events` RENAME COLUMN `visit_id` TO `party_id`;--> statement-breakpoint
ALTER TABLE `order_drafts` RENAME COLUMN `visit_id` TO `party_id`;--> statement-breakpoint
DROP INDEX `visits_merged_into_idx`;--> statement-breakpoint
CREATE INDEX `parties_merged_into_idx` ON `parties` (`merged_into_party_id`);--> statement-breakpoint
DROP INDEX `visit_tables_active_table_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `party_tables_active_table_uq` ON `party_tables` (`table_id`) WHERE "party_tables"."left_at" is null;--> statement-breakpoint
DROP INDEX `visit_tables_visit_idx`;--> statement-breakpoint
CREATE INDEX `party_tables_party_idx` ON `party_tables` (`party_id`);--> statement-breakpoint
DROP INDEX `working_orders_visit_idx`;--> statement-breakpoint
CREATE INDEX `working_orders_party_idx` ON `working_orders` (`party_id`);--> statement-breakpoint
DROP INDEX `order_groups_visit_idx`;--> statement-breakpoint
CREATE INDEX `order_groups_party_idx` ON `order_groups` (`party_id`);--> statement-breakpoint
DROP INDEX `order_group_events_visit_idx`;--> statement-breakpoint
CREATE INDEX `order_group_events_party_idx` ON `order_group_events` (`party_id`);--> statement-breakpoint
DROP INDEX `order_drafts_visit_idx`;--> statement-breakpoint
CREATE INDEX `order_drafts_party_idx` ON `order_drafts` (`party_id`);--> statement-breakpoint
CREATE TRIGGER parties_clear_table_status
AFTER UPDATE ON parties
FOR EACH ROW
WHEN old.state = 'open' AND new.state <> 'open'
BEGIN
  UPDATE dining_tables SET status_id = NULL
   WHERE id IN (
     SELECT table_id FROM party_tables WHERE party_id = new.id AND left_at IS NULL
   );
END;
