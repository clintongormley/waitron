-- Hand-written (--custom; drizzle-kit has no concept of policies, FORCE, or privileges), same as
-- packages/credentials/drizzle/0001_credentials_rls.sql. current_tenant_id() already exists
-- (packages/db 0001_tenancy_rls.sql). ingredients: no DELETE (deactivate via `active`); recipe_lines:
-- DELETE granted (setProductRecipe replaces a product's lines).
--> statement-breakpoint
ALTER TABLE "ingredients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "ingredients_tenant_isolation" ON "ingredients"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

REVOKE ALL ON "ingredients" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "ingredients" TO app_user;--> statement-breakpoint

ALTER TABLE "recipe_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "recipe_lines_tenant_isolation" ON "recipe_lines"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

REVOKE ALL ON "recipe_lines" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "recipe_lines" TO app_user;
