CREATE UNIQUE INDEX "persons_tenant_live_display_name_uq"
  ON "persons" ("tenant_id", lower(btrim("display_name")))
  WHERE "status" <> 'suspended';
