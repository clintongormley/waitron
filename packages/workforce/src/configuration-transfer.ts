export const WORKFORCE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "employments" },
    { name: "availability" },
    { name: "pay_period_settings" },
    { name: "shift_templates", locationColumns: ["location_id"] },
  ],
} as const;
