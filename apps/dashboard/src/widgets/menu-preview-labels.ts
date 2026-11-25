import type { SetMenuChangeField } from "@waitron/shared";
import type { MenuChange, ProductChangeField, SectionChangeField } from "../api/client.js";
import type { StringKey } from "../i18n/strings.js";

export const CHANGE_GROUP_ORDER = [
  "menu",
  "sections_added",
  "sections_removed",
  "sections_changed",
  "products_added",
  "products_removed",
  "products_moved",
  "set_menus",
  "prices",
  "details",
  "order",
  "home",
] as const;
export type ChangeGroup = (typeof CHANGE_GROUP_ORDER)[number];
export const CHANGE_GROUPS: Record<MenuChange["kind"], ChangeGroup> = {
  menu_renamed: "menu",
  section_added: "sections_added",
  section_removed: "sections_removed",
  section_changed: "sections_changed",
  product_added: "products_added",
  product_removed: "products_removed",
  product_deleted: "products_removed",
  product_moved: "products_moved",
  set_menu_added: "set_menus",
  set_menu_removed: "set_menus",
  set_menu_changed: "set_menus",
  price_changed: "prices",
  product_changed: "details",
  extra_unit_changed: "details",
  extra_portion_changed: "details",
  extra_max_quantity_changed: "details",
  order_changed: "order",
  home_shortcuts_changed: "home",
  home_display_changed: "home",
};
export const GROUP_LABELS: Record<ChangeGroup, StringKey> = {
  menu: "menu_preview.group_menu",
  sections_added: "menu_preview.group_sections_added",
  sections_removed: "menu_preview.group_sections_removed",
  sections_changed: "menu_preview.group_sections_changed",
  products_added: "menu_preview.group_products_added",
  products_removed: "menu_preview.group_products_removed",
  products_moved: "menu_preview.group_products_moved",
  set_menus: "menu_preview.group_set_menus",
  prices: "menu_preview.group_prices",
  details: "menu_preview.group_details",
  order: "menu_preview.group_order",
  home: "menu_preview.group_home",
};

export const PRODUCT_FIELDS: Record<ProductChangeField, StringKey> = {
  names: "menu_preview.field_names",
  description: "menu_preview.field_description",
  image: "menu_preview.field_image",
  color: "menu_preview.field_color",
  unit: "menu_preview.field_unit",
  allergens: "menu_preview.field_allergens",
  diet: "menu_preview.field_diet",
  vat: "menu_preview.field_vat",
  ordering: "menu_preview.field_ordering",
  variants: "menu_preview.field_variants",
  extras: "menu_preview.field_extras",
  options: "menu_preview.field_options",
};

export const SECTION_FIELDS: Record<SectionChangeField, StringKey> = {
  names: "menu_preview.field_name",
  image: "menu_preview.field_image",
  color: "menu_preview.field_color",
  direct: "menu_preview.field_direct",
};

export const SET_MENU_FIELDS: Record<SetMenuChangeField, StringKey> = {
  price: "menu_preview.field_price",
  vat: "menu_preview.field_vat",
  names: "menu_preview.field_names",
  lines: "menu_preview.field_included",
  allergens: "menu_preview.field_allergens",
  diet: "menu_preview.field_diet",
  dishes: "menu_preview.field_dishes",
};

export const SOURCES: Record<MenuChange["source"], StringKey> = {
  this_menu: "menu_preview.source_this_menu",
  shared_product: "menu_preview.source_shared_product",
  included_menu: "menu_preview.source_included_menu",
  set_menu: "menu_preview.source_set_menu",
};
