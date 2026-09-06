/**
 * What `app_user` may do on every table, captured from the schema BEFORE the RLS drop
 * (2026-09-05 base 7873b7ce) with `has_table_privilege`. Letters: S=SELECT I=INSERT U=UPDATE
 * D=DELETE T=TRUNCATE. This is the receipt that dropping row-level security and the helper roles
 * changed nothing about the app role's reach (spec §1): the suite beside it reads the live catalog
 * and expects exactly this. A deliberate grant change edits this file in the same commit, with the
 * reason in the message — the four `sync_*` rows are the ones already scheduled to go, with the
 * outbox tables themselves (spec §1, "Gone").
 *
 * Scope is TABLE-level privilege only, which is what `has_table_privilege` answers: a column-level
 * grant such as `GRANT UPDATE ("next_number") ON invoice_series` (packages/db 0003) does NOT show a
 * `U` here, so this matrix does not pin column grants. `scripts/schema-equivalence.sh` diffs the
 * dumped ACLs and does cover them, but it is a one-shot proof of the squash rather than a standing
 * guard; the suite beside this file carries the column-level facts that need one.
 *
 * The capture returned 82 rows (`__drizzle_migrations_*` excluded by the query): every migration in
 * `packages/migrations/migrations.manifest.json` order, applied from a worktree at that base commit
 * to a postgres:18-alpine container as a non-superuser owner.
 */
export const PRIVILEGES: Record<string, string> = {
  absences: "SIUD",
  acks: "SIUD",
  availability: "SIUD",
  bookings: "SIU",
  cadenas: "SIU",
  canvases: "SIUD",
  catalogues: "SIU",
  categories: "SIU",
  contadores_instalacion: "SIU",
  convenio_config: "SIU",
  daily_close_chain: "SIU",
  daily_closes: "SI",
  deployment: "S",
  device_pairing_codes: "SID",
  device_profiles: "SIUD",
  devices: "SIU",
  dining_tables: "SIU",
  drawer_opens: "SI",
  employments: "SIU",
  envio_flujo: "SIU",
  envios: "SIU",
  floor_zones: "SIU",
  incidents: "SI",
  ingredients: "SIU",
  invoice_series: "SI",
  kitchen_courses: "SIU",
  kitchen_stations: "SIU",
  location_catalogues: "SID",
  locations: "SIU",
  management_sessions: "SIU",
  mirror_config: "S",
  node_membership: "SIU",
  nodes: "S",
  option_group_items: "SIUD",
  option_groups: "SIUD",
  order_amendments: "SI",
  payment_policy: "SIU",
  payment_refunds: "SIU",
  payments: "SIU",
  persons: "SIU",
  print_agent_pairing_codes: "SID",
  print_agents: "SIU",
  print_jobs: "SIU",
  printers: "SIU",
  product_option_groups: "SIUD",
  products: "SIU",
  purchase_invoice_vat: "SIUD",
  purchase_invoices: "SIUD",
  recipe_lines: "SIUD",
  registro_sif: "SIU",
  registros_facturacion: "SI",
  roster_versions: "SIUD",
  sale_lines: "SI",
  sale_settlements: "SI",
  sale_substitutions: "SI",
  sale_voids: "SI",
  sales: "SI",
  scheduled_runs: "SIU",
  sessions: "SIU",
  shift_swaps: "SIUD",
  shift_templates: "SIUD",
  shifts: "SIUD",
  station_printers: "SID",
  sync_config_conflicts: "I",
  sync_cursor: "",
  sync_log: "I",
  sync_peers: "",
  table_service_statuses: "SIU",
  tenant_credentials: "SIUD",
  tenant_receipts: "SIU",
  tenant_themes: "SIU",
  tenants: "S",
  tenders: "SI",
  ticket_items: "SIU",
  tills: "SIU",
  time_entries: "SI",
  webauthn_challenges: "SIUD",
  webauthn_credentials: "SIUD",
  workforce_chains: "SIU",
  working_order_counters: "SIU",
  working_order_lines: "SIUD",
  working_orders: "SIUD",
};
