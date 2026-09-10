import { sql } from "drizzle-orm";
import type { ModuleProvisioning } from "@waitron/module";

export const CATALOGUE_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create the venue's initial menu",
    async run(tx, node) {
      const location = await tx.execute<{ catalogue_id: string | null }>(sql`
        select catalogue_id from locations
        where tenant_id = ${node.tenantId} and id = ${node.locationId}`);
      let catalogueId = location.rows[0]?.catalogue_id ?? null;
      if (catalogueId === null) {
        const created = await tx.execute<{ id: string }>(sql`
          insert into catalogues (tenant_id, name)
          values (${node.tenantId}, 'Menu') returning id`);
        catalogueId = created.rows[0]!.id;
        await tx.execute(sql`
          update locations set catalogue_id = ${catalogueId}
          where tenant_id = ${node.tenantId} and id = ${node.locationId}`);
      }
      await tx.execute(sql`
        insert into location_catalogues (tenant_id, location_id, catalogue_id)
        values (${node.tenantId}, ${node.locationId}, ${catalogueId})
        on conflict (tenant_id, location_id, catalogue_id) do nothing`);
      return "initial menu ready";
    },
  },
};
