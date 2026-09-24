CREATE TABLE `node_sealed_state` (
	`node_id` text PRIMARY KEY NOT NULL,
	`sealed` blob NOT NULL,
	`updated_at` text NOT NULL
);
