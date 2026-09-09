import { sql } from "drizzle-orm";
import type { ModuleProvisioning } from "@waitron/module";

export const VENUE_SERVICE_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create the default department and counter zone",
    async run(tx, node) {
      await tx.execute(sql`
        insert into departments
          (tenant_id, location_id, name, trading_name, default_service_mode, is_default)
        select ${node.tenantId}, ${node.locationId}, 'Venue', 'Venue', 'prepay', true
        where not exists (
          select 1 from departments
          where tenant_id = ${node.tenantId}
            and location_id = ${node.locationId}
            and is_default)`);
      const department = await tx.execute<{ id: string }>(sql`
        select id from departments
        where tenant_id = ${node.tenantId}
          and location_id = ${node.locationId}
          and is_default
        limit 1`);
      const departmentId = department.rows[0]!.id;

      const existing = await tx.execute<{ zone_id: string }>(sql`
        select zone_id from zone_service_policies
        where tenant_id = ${node.tenantId}
          and location_id = ${node.locationId}
          and is_counter_default
        limit 1`);
      if (existing.rows.length === 0) {
        const zone = await tx.execute<{ id: string }>(sql`
          insert into floor_zones (tenant_id, location_id, name, display_order, active)
          values (${node.tenantId}, ${node.locationId}, 'Counter', 0, true)
          on conflict (tenant_id, location_id, name)
          do update set name = excluded.name
          returning id`);
        const zoneId = zone.rows[0]!.id;
        await tx.execute(sql`
          insert into zone_service_policies
            (tenant_id, location_id, zone_id, department_id, service_mode, is_counter_default)
          values (${node.tenantId}, ${node.locationId}, ${zoneId}, ${departmentId}, null, true)
          on conflict (tenant_id, zone_id)
          do update set is_counter_default = true`);
      }
      return "default department and counter zone ready";
    },
  },
};
