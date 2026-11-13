interface Options {
  read(
    types: readonly string[],
    onEvent: (event: string, data: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

const DEVICE_TYPES = [
  "devices",
  "device_profiles",
  "device_profile_service_access",
  "device_profile_zones",
  "device_profile_admission_roles",
];
const ORDER_TYPES = [
  "working_orders",
  "working_order_lines",
  "order_groups",
  "ticket_items",
  "order_service_contexts",
  "line_service_cancellations",
  "order_drafts",
  "order_draft_lines",
];
const MENU_TYPES = [
  "products",
  "product_units",
  "units",
  "catalogues",
  "menu_items",
  "menu_item_variant_overrides",
  "menu_publications",
  "menu_versions",
  "menu_details",
  "menu_scheduled_publications",
  "option_labels",
  "option_lists",
  "extra_lists",
  "extra_list_items",
  "product_modifiers",
  "categories",
  "category_details",
  "sections",
  "section_members",
];

const KITCHEN_TYPES = [
  "ticket_item_moves",
  "locations",
  "categories",
  "category_details",
  ...DEVICE_TYPES,
  ...ORDER_TYPES,
  "persons",
  "products",
  "product_units",
  "units",
  "kitchen_stations",
  "kitchen_courses",
  "station_printers",
  "routing_cells",
  "routing_cell_periods",
  "device_made_here_stations",
  "device_kitchen_screens",
  "device_kitchen_screen_stations",
  "device_kitchen_screen_zones",
  "device_kitchen_screen_removals",
  "device_profile_kitchen_screens",
  "device_profile_kitchen_screen_stations",
  "device_profile_kitchen_screen_zones",
  "parties",
  "party_tables",
  "dining_tables",
  "dining_tables.today",
  "departments",
  "floor_zones",
  "floor_today_joins",
  "floor_today_join_tables",
  "printers",
  "print_jobs",
  "kitchen_notices",
  "menu_periods",
  "settings.venue",
  "party_allergy",
  "party_allergy_guests",
  "allergy_line_ticks",
];

export const TILL_LIVE_TYPES: Readonly<Record<string, readonly string[]>> = {
  station: KITCHEN_TYPES,
  pass: KITCHEN_TYPES,
  deliveries: [
    ...DEVICE_TYPES,
    "persons",
    "working_orders",
    "sales",
    "invoice_deliveries",
    "print_jobs",
    "outgoing_mail",
    "printers",
    "page_printers",
    "printer_holders",
    "device_profile_printers",
    "settings.venue",
  ],
  billDraft: [
    ...DEVICE_TYPES,
    ...ORDER_TYPES,
    ...MENU_TYPES,
    "persons",
    "parties",
    "party_tables",
    "dining_tables",
    "floor_zones",
    "departments",
    "menu_periods",
    "menu_period_staff_menus",
    "kitchen_courses",
    "order_draft_events",
    "bill_edit_states",
    "working_line_portions",
    "order_portions",
    "kitchen_stations",
    "bill_payment_lines",
    "bill_payments",
    "bill_payment_refunds",
    "tenders",
    "sales",
    "invoice_series",
    "sale_substitutions",
    "settings.venue",
  ],
  clocking: [
    ...DEVICE_TYPES,
    "persons",
    "time_entries",
    "locations",
    "settings.venue",
    "attendance_day_work",
    "attendance_operation_facts",
    "attendance_source_state",
  ],
  menu: [
    ...DEVICE_TYPES,
    ...MENU_TYPES,
    "settings.venue",
    "locations",
    "departments",
    "floor_zones",
    "menu_periods",
    "menu_period_staff_menus",
    "department_sale_policies",
    "device_zone_selections",
    "device_zone_selection_zones",
    "kitchen_courses",
    "custom_themes",
    "media_images",
  ],
  equipment: [...DEVICE_TYPES, "printers", "printer_holders", "device_profile_printers", "persons"],
  floor: [
    ...DEVICE_TYPES,
    ...ORDER_TYPES,
    "floor_zones",
    "floor_zones.today",
    "dining_tables",
    "dining_tables.today",
    "floor_today_joins",
    "floor_today_join_tables",
    "floor_plan_tables",
    "floor_plans",
    "floor_reset_tables",
    "parties",
    "party_tables",
    "service_steps",
    "service_step_completions",
    "kitchen_stations",
    "bill_payments",
  ],
  transfers: [
    ...DEVICE_TYPES,
    ...ORDER_TYPES,
    "department_transfer_requests",
    "department_transfer_desks",
    "department_transfer_destinations",
    "departments",
    "parties",
    "party_tables",
    "dining_tables",
    "persons",
    "product_units",
    "products",
    "units",
  ],
  allergy: [
    ...DEVICE_TYPES,
    "persons",
    ...ORDER_TYPES,
    ...MENU_TYPES,
    "party_allergy",
    "party_allergy_guests",
    "allergy_line_ticks",
    "parties",
    "party_tables",
    "dining_tables",
    "menu_periods",
    "menu_period_staff_menus",
    "floor_zones",
  ],
};

export class TillLiveConnection extends EventTarget {
  readonly #interests = new Map<string, readonly string[]>();
  #active = false;
  #up = false;
  #key = "";
  #read?: AbortController;
  #silence?: ReturnType<typeof setTimeout>;
  #retry?: ReturnType<typeof setTimeout>;
  #retryMs = 1000;

  constructor(private readonly options: Options) {
    super();
  }
  get up(): boolean {
    return this.#up;
  }
  addInterests(owner: string, types: readonly string[]): void {
    this.#interests.set(owner, types);
    this.#sync();
  }
  removeInterests(owner: string): void {
    this.#interests.delete(owner);
    this.#sync();
  }
  start(): void {
    if (this.#active) return;
    this.#active = true;
    this.#retryMs = 1000;
    this.#sync();
  }
  stop(): void {
    this.#active = false;
    this.#close(false);
    this.#up = false;
    this.#key = "";
  }
  #setUp(up: boolean): void {
    if (up === this.#up) return;
    this.#up = up;
    this.dispatchEvent(new Event(up ? "up" : "down"));
  }
  #close(down = true): void {
    const read = this.#read;
    this.#read = undefined;
    clearTimeout(this.#silence);
    clearTimeout(this.#retry);
    read?.abort();
    if (down) this.#setUp(false);
  }
  #sync(): void {
    if (!this.#active) return;
    const types = [...new Set([...this.#interests.values()].flat())].sort();
    const key = JSON.stringify(types);
    if (key === this.#key) return;
    this.#close(types.length === 0);
    this.#key = key;
    if (types.length > 0) this.#connect(types);
  }
  #connect(types: readonly string[]): void {
    if (!this.#active) return;
    const read = new AbortController();
    this.#read = read;
    const current = () => this.#active && this.#read === read;
    const reconnect = () => {
      if (!current()) return;
      this.#close();
      this.#retry = setTimeout(() => this.#connect(types), this.#retryMs);
      this.#retryMs = Math.min(this.#retryMs * 2, 30_000);
    };
    const heard = () => {
      clearTimeout(this.#silence);
      this.#silence = setTimeout(reconnect, 30_000);
    };
    heard();
    void this.options
      .read(
        types,
        (event, data) => {
          if (!current()) return;
          heard();
          if (event === "ready") {
            this.#retryMs = 1000;
            this.#setUp(true);
          } else if (event === "change") {
            const resources = JSON.parse(data) as { type: string }[];
            this.dispatchEvent(
              new CustomEvent("change", { detail: { types: resources.map(({ type }) => type) } }),
            );
          } else if (
            event === "session-invalid" &&
            (JSON.parse(data) as { code?: string }).code === "device.unauthorized"
          ) {
            this.stop();
            this.dispatchEvent(new Event("unauthorized"));
          }
        },
        read.signal,
      )
      .catch((error: unknown) => {
        if (current() && (error as { code?: string } | null)?.code === "device.unauthorized") {
          this.stop();
          this.dispatchEvent(new Event("unauthorized"));
        }
      })
      .finally(reconnect);
  }
}
