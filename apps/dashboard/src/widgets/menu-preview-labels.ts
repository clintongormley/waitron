import type { SetMenuChangeField } from "@waitron/shared";
import type { MenuChange, ProductChangeField, SectionChangeField } from "../api/client.js";
import type { StringKey } from "../i18n/strings.js";

export const CHANGE_GROUP_ORDER = [
  "menu",
  "added",
  "removed",
  "moved",
  "prices",
  "order",
  "details",
  "home",
] as const;
export type ChangeGroup = (typeof CHANGE_GROUP_ORDER)[number];
export const CHANGE_GROUPS: Record<MenuChange["kind"], ChangeGroup> = {
  menu_renamed: "menu",
  section_added: "added",
  section_removed: "removed",
  section_changed: "details",
  product_added: "added",
  product_removed: "removed",
  product_deleted: "removed",
  product_moved: "moved",
  set_menu_added: "added",
  set_menu_removed: "removed",
  set_menu_changed: "details",
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
  added: "menu_preview.group_added",
  removed: "menu_preview.group_removed",
  moved: "menu_preview.group_moved",
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
  names: "menu_preview.field_names",
  lines: "menu_preview.field_included",
  allergens: "menu_preview.field_allergens",
  diet: "menu_preview.field_diet",
  dishes: "menu_preview.field_dishes",
};
