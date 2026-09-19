export const CATALOGUE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "category_details" },
    { name: "product_categories" },
    { name: "content_languages" },
    { name: "unit_seed_states" },
    { name: "units" },
    { name: "product_units" },
    { name: "product_variants" },
    { name: "menu_sections" },
    { name: "menu_items" },
    { name: "menu_item_variants" },
    { name: "menu_item_option_groups" },
    { name: "menu_item_options" },
    // The list before its labels: `importConfigurationTables` inserts in this order and deletes in
    // its reverse, so the parent has to be written before the rows whose foreign key names it.
    { name: "option_lists" },
    { name: "option_labels" },
  ],
} as const;
