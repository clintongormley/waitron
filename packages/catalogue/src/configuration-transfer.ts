export const CATALOGUE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "category_details" },
    { name: "product_categories" },
    { name: "content_languages" },
    { name: "unit_seed_states" },
    { name: "units" },
    { name: "product_units" },
    { name: "menu_sections" },
    { name: "menu_items" },
    { name: "menu_item_option_groups" },
    { name: "menu_item_options" },
  ],
} as const;
