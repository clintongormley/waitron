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
    // After both parents its keys name: the menu item above and the variant's `products` row.
    { name: "menu_item_variant_overrides" },
    // Each list before its rows: `importConfigurationTables` inserts in this order and deletes in
    // its reverse, so the parent has to be written before the rows whose foreign key names it.
    { name: "option_lists" },
    { name: "option_labels" },
    { name: "extra_lists" },
    { name: "extra_list_items" },
    // A menu offer's extras publication, after both parents it names — the menu item above and the
    // list two lines up — and its per-item overrides after the publication itself.
    { name: "menu_item_extra_lists" },
    { name: "menu_item_extra_items" },
    // A product's attachment list last of all: a row names an extras list or an options list,
    // so both of those have to exist before one can be written.
    { name: "product_modifiers" },
  ],
} as const;
