import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { runFoldCli } from "./lib/fold-inserts.mjs";

export const rules = [
  {
    child: "zoneServicePolicies",
    parent: "floorZones",
    key: "zoneId",
    fields: {
      departmentId: "departmentId",
      isCounterDefault: "isCounterDefault",
      locationId: null,
    },
    raw: {
      childTable: "zone_service_policies",
      parentTable: "floor_zones",
      key: "zone_id",
      columns: {
        department_id: "department_id",
        is_counter_default: "is_counter_default",
        location_id: null,
      },
    },
  },
  {
    child: "zoneSalePolicies",
    parent: "floorZones",
    key: "zoneId",
    fields: {
      orderStart: "orderStart",
      paidWhen: "paidWhen",
      collectionNumber: "collectionNumber",
      receiptPrintMode: "receiptPrintMode",
    },
    raw: {
      childTable: "zone_sale_policies",
      parentTable: "floor_zones",
      key: "zone_id",
      columns: {
        order_start: "order_start",
        paid_when: "paid_when",
        collection_number: "collection_number",
        receipt_print_mode: "receipt_print_mode",
      },
    },
  },
];

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  await runFoldCli(rules);
