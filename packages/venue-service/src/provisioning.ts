import { sql } from "drizzle-orm";
import type { ModuleProvisioning } from "@waitron/module";

export const VENUE_SERVICE_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create the default department and counter zone",
    async run(tx, node) {
      await tx.execute(sql`
        insert into departments
          (location_id, name, trading_name, default_service_mode, is_default)
        select ${node.locationId}, 'Venue', 'Venue', 'prepay', true
        where not exists (
          select 1 from departments
          where location_id = ${node.locationId}
            and is_default)`);
      const department = await tx.execute<{ id: string }>(sql`
        select id from departments
        where location_id = ${node.locationId}
          and is_default
        limit 1`);
      const departmentId = department.rows[0]!.id;

      const existing = await tx.execute<{ zone_id: string }>(sql`
        select zone_id from zone_service_policies
        where location_id = ${node.locationId}
          and is_counter_default
        limit 1`);
      if (existing.rows.length === 0) {
        const zone = await tx.execute<{ id: string }>(sql`
          insert into floor_zones (location_id, name, display_order, active) values (${node.locationId}, 'Counter', 0, true)
          on conflict (location_id, name)
          do update set name = excluded.name
          returning id`);
        const zoneId = zone.rows[0]!.id;
        await tx.execute(sql`
          insert into zone_service_policies
            (location_id, zone_id, department_id, service_mode, is_counter_default)
          values (${node.locationId}, ${zoneId}, ${departmentId}, null, true)
          on conflict (zone_id)
          do update set is_counter_default = true`);
      }
      const policy = await tx.execute<{ zone_id: string }>(sql`
        select zone_id from zone_service_policies
        where location_id = ${node.locationId}
          and is_counter_default
        limit 1`);
      const menu = await tx.execute<{ catalogue_id: string | null }>(sql`
        select catalogue_id from locations
        where id = ${node.locationId}`);
      const zoneId = policy.rows[0]!.zone_id;
      const menuId = menu.rows[0]!.catalogue_id;
      if (menuId !== null) {
        await tx.execute(sql`
          insert into zone_menus (zone_id, menu_id, display_order)
          values (${zoneId}, ${menuId}, 0)
          on conflict (zone_id, menu_id) do nothing`);
        await tx.execute(sql`
          update zone_service_policies set default_menu_id = ${menuId}
          where zone_id = ${zoneId}
            and default_menu_id is null`);
      }
      return "default department and counter zone ready";
    },
  },
};
