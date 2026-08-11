// A bare side-effect import so TypeScript augments the real "@waitron/shared" module rather than
// declaring a fresh ambient one — the idiom packages/identity, packages/catalogue use.
import "@waitron/shared";
import type { WidgetType } from "./types.js";

// @waitron/layouts's contribution to the shared error registry, by declaration merging — the
// DOMAIN-CONCEPT, lowercase, dot-namespaced convention, never the package name (CLAUDE.md §3). Grep
// receipt for minting these two fresh families: on 2026-08-11
//   grep -rn '"layout\.\|"receipt\.\|"till\.' packages/**/src/errors.ts apps/server/src/errors.ts
// printed no match, so `layout.invalid` and `receipt.invalid` collide with no existing sibling.
//
// PARAM RULE (CLAUDE.md §1, the house's dominant defect class): every param NAMES the problem and
// NEVER echoes the offending user value. `reason` is a fixed enum of what went wrong; `widget` only
// ever carries a valid WidgetType enum value (so an *unknown* widget's arbitrary `type` string can
// never reach it — it stays `undefined` in that case); `configKey` / `field` carry a key/field NAME,
// never its value; `maxLength` is the policy cap, never the length that breached it. A config VALUE
// never enters these params.
declare module "@waitron/shared" {
  interface ErrorParams {
    // A LayoutDef failed validateLayout. `reason` says which rule:
    //   not_array        — the input was not an array;
    //   unknown_widget   — an item was not an object, or its `type` was not one of the six
    //                      WidgetTypes (the offending `type` is NOT echoed — `widget` stays absent);
    //   bad_region       — an item's `region` was not "main" | "aside";
    //   bad_config       — an item's `config` was not an object, carried a key outside that widget's
    //                      WIDGET_CONFIG schema, or a value its validator rejected (design D8);
    //   duplicate        — two items shared a `type` (design D5);
    //   missing_required — a sale-critical widget was absent (design D4).
    // `widget` names the widget the problem concerns when it is a valid WidgetType; `configKey`
    // names the offending config key for a bad_config.
    "layout.invalid": {
      reason:
        | "not_array"
        | "unknown_widget"
        | "bad_region"
        | "bad_config"
        | "duplicate"
        | "missing_required";
      widget?: WidgetType;
      configKey?: string;
    };
    // A ReceiptConfig failed validateReceiptConfig. `reason`:
    //   not_object    — the input was not a plain object;
    //   not_string    — a present field was not a string;
    //   too_long      — a field exceeded `maxLength` characters (the length is NOT echoed);
    //   unknown_field — a field outside headerSubtitle / footerMessage was present (fail-closed: a
    //                   silently-stripped field could suppress the fiscal core, design §8).
    // `field` names the offending field; `maxLength` is the policy cap for too_long.
    "receipt.invalid": {
      reason: "not_object" | "not_string" | "too_long" | "unknown_field";
      field?: "headerSubtitle" | "footerMessage";
      maxLength?: number;
    };
  }
}
