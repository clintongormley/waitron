import { formatMoney } from "@waitron/shared";
import { currentContentLanguages } from "@waitron/ui";
import { unitPresentation } from "@waitron/menu/src/unit-presentation.js";
import type { MenuChange } from "../api/client.js";
import { conjunctionList } from "../i18n/list.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { PATH_SEPARATOR } from "./category-form.js";
import { PRODUCT_FIELDS, SECTION_FIELDS, SET_MENU_FIELDS } from "./menu-preview-labels.js";

function place(path: readonly string[]): string {
  return path.length === 0 ? t("menu_preview.top_level") : path.join(PATH_SEPARATOR);
}

function places(paths: readonly (readonly string[])[]): string {
  return conjunctionList(paths.map((path) => place(path)));
}

export function changeWords(change: MenuChange, subject: (name: string) => unknown): unknown {
  const words = (key: StringKey, values: Record<string, string>, link = "name") =>
    t(key)
      .split(/(\{\w+\})/)
      .map((part) => {
        const name = part.slice(1, -1);
        if (!part.startsWith("{") || !(name in values)) return part;
        return name === link ? subject(values[name]!) : values[name];
      });
  switch (change.kind) {
    case "set_menu_changed":
      return change.fields.length === 0
        ? words("menu_preview.set_menu_saved_again", { name: change.setMenu.name })
        : words("menu_preview.changed_fields", {
            name: change.setMenu.name,
            fields: change.fields.map((field) => t(SET_MENU_FIELDS[field])).join(", "),
          });
    case "set_menu_added":
    case "set_menu_removed":
    case "product_added":
    case "product_removed":
    case "section_added":
    case "section_removed": {
      const name = "setMenu" in change ? change.setMenu.name : change.name;
      return subject([...change.under, name].join(PATH_SEPARATOR));
    }
    case "product_deleted":
      return words("menu_preview.product_deleted", { name: change.name });
    case "product_moved":
      return words("menu_preview.product_moved", {
        name: change.name,
        from: places(change.from),
        to: places(change.to),
      });
    case "price_changed": {
      const name = change.variant
        ? `${change.name}${PATH_SEPARATOR}${change.variant.name}`
        : change.name;
      if (change.override)
        return words(
          change.override === "set" ? "menu_preview.override_set" : "menu_preview.override_cleared",
          { name },
        );
      return words("menu_preview.price_changed", {
        name,
        from: formatMoney(change.from, currentLocale()),
        to: formatMoney(change.to, currentLocale()),
      });
    }
    case "product_changed":
      return words("menu_preview.changed_fields", {
        name: change.name,
        fields: change.fields.map((field) => t(PRODUCT_FIELDS[field])).join(", "),
      });
    case "extra_unit_changed": {
      const describe = (unit: typeof change.from) => {
        const { name, abbreviation } = unitPresentation(
          unit,
          currentLocale(),
          currentContentLanguages(),
        );
        return abbreviation && name !== abbreviation ? `${name} · ${abbreviation}` : name;
      };
      const from = describe(change.from),
        to = describe(change.to);
      if (from === to && change.from.precision === change.to.precision)
        return words("menu_preview.extra_unit_details_changed", {
          list: change.listName,
          name: change.name,
        });
      return words("menu_preview.extra_unit_changed", {
        list: change.listName,
        name: change.name,
        from,
        fromPrecision: String(change.from.precision),
        to,
        toPrecision: String(change.to.precision),
      });
    }
    case "extra_portion_changed": {
      const locale = currentLocale().slice(0, 2);
      const unit = (abbreviations: Record<string, string>) =>
        abbreviations[locale] ?? abbreviations.en ?? Object.values(abbreviations)[0] ?? "";
      return words("menu_preview.extra_portion_changed", {
        list: change.listName,
        name: change.name,
        from: `${change.from.portion} ${unit(change.from.abbreviation)}`.trim(),
        to: `${change.to.portion} ${unit(change.to.abbreviation)}`.trim(),
      });
    }
    case "extra_max_quantity_changed":
      return words("menu_preview.extra_max_quantity_changed", {
        list: change.listName,
        name: change.name,
        from: change.from === null ? t("menu_preview.no_limit") : String(change.from),
        to: change.to === null ? t("menu_preview.no_limit") : String(change.to),
      });
    case "section_changed":
      return change.fields.length === 1 && change.fields[0] === "names"
        ? words("menu_preview.section_renamed", { name: change.name })
        : words("menu_preview.changed_fields", {
            name: change.name,
            fields: change.fields.map((field) => t(SECTION_FIELDS[field])).join(", "),
          });
    case "order_changed":
      return subject(change.list.length ? place(change.list) : t("menus.tab_structure"));
    case "home_shortcuts_changed":
      return subject(t("menu_preview.home_shortcuts_changed"));
    case "home_display_changed":
      return subject(t("menu_preview.home_display_changed"));
    case "menu_renamed":
      return words("menu_preview.menu_renamed", { from: change.from, to: change.to }, "to");
  }
}

export function changeSource(change: MenuChange): string {
  const source =
    change.kind === "extra_portion_changed" || change.kind === "extra_max_quantity_changed"
      ? t("menu_preview.changed_in_modifiers")
      : (change.includedMenu?.name ??
        (change.source === "shared_product"
          ? t("menu_preview.changed_in_products")
          : change.source === "included_menu"
            ? t("menu_preview.source_included_menu")
            : ""));
  return change.alsoOn?.length
    ? [source, fill("menu_preview.also_on", { menus: conjunctionList(change.alsoOn) })]
        .filter(Boolean)
        .join(", ")
    : source;
}
