CREATE TABLE `tenant_credentials` (
	`purpose` text PRIMARY KEY NOT NULL,
	`ciphertext` blob NOT NULL,
	`iv` blob NOT NULL,
	`auth_tag` blob NOT NULL,
	`key_version` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "tenant_credentials_key_version_ck" CHECK("tenant_credentials"."key_version" >= 1),
	CONSTRAINT "tenant_credentials_iv_len_ck" CHECK(octet_length("tenant_credentials"."iv") = 12),
	CONSTRAINT "tenant_credentials_auth_tag_len_ck" CHECK(octet_length("tenant_credentials"."auth_tag") = 16),
	CONSTRAINT "tenant_credentials_purpose_ck" CHECK(length("tenant_credentials"."purpose") > 0)
);
