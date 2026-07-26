CREATE TABLE "tenant_credentials" (
	"tenant_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"key_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_credentials_pk" PRIMARY KEY("tenant_id","purpose"),
	CONSTRAINT "tenant_credentials_key_version_ck" CHECK ("tenant_credentials"."key_version" >= 1),
	CONSTRAINT "tenant_credentials_iv_len_ck" CHECK (octet_length("tenant_credentials"."iv") = 12),
	CONSTRAINT "tenant_credentials_auth_tag_len_ck" CHECK (octet_length("tenant_credentials"."auth_tag") = 16),
	CONSTRAINT "tenant_credentials_purpose_ck" CHECK (length("tenant_credentials"."purpose") > 0)
);
--> statement-breakpoint
ALTER TABLE "tenant_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_credentials" ADD CONSTRAINT "tenant_credentials_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;