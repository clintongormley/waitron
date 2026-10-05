import { storeProductNameKeys } from "./product-names.js";

export const CATALOGUE_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    { name: "category_details" },
    { name: "content_languages" },
    { name: "unit_seed_states" },
    { name: "units" },
    { name: "product_units" },
    { name: "menu_items" },
    { name: "menu_item_variant_overrides" },
    { name: "option_lists", references: ["default_label_id"] },
    { name: "option_labels" },
    { name: "extra_lists" },
    { name: "extra_list_items" },
    { name: "product_modifiers" },
    { name: "sections" },
    { name: "section_members" },
    { name: "menu_details" },
    { name: "device_profile_home_layouts", references: ["layout_id"] },
  ],
  afterImport: storeProductNameKeys,
} as const;
