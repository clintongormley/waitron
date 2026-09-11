ALTER TABLE "payments" ADD COLUMN "card_scheme" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "card_last4" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "card_entry_mode" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "card_auth_code" text;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_card_last4_ck" CHECK ("payments"."card_last4" is null or length("payments"."card_last4") = 4);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_card_entry_mode_ck" CHECK ("payments"."card_entry_mode" is null or "payments"."card_entry_mode" in ('contactless','chip','swipe','unknown'));