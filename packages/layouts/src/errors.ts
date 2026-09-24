// A bare import, so the block below augments the real "@waitron/shared" module rather than
// declaring a new ambient one.
import "@waitron/shared";
import type { CardType } from "./canvas.js";

// No param ever echoes a caller-supplied value: `reason` is a fixed enum, `field` and `configKey`
// carry a key's name and never its value, `maxLength` is the policy cap, `tabIndex` locates a tab
// by position, `card` is only ever a valid CardType, and `token` only ever an allowlisted token.
declare module "@waitron/shared" {
  interface ErrorParams {
    "receipt.invalid": {
      reason: "not_object" | "not_string" | "too_long" | "unknown_field";
      field?: "headerSubtitle" | "footerMessage";
      maxLength?: number;
    };
    // `bad_capabilities` is no longer thrown: a bad capability set is `device_profile.invalid`.
    "canvas.invalid": {
      reason:
        | "not_object"
        | "bad_capabilities"
        | "bad_form_factor"
        | "no_tabs"
        | "bad_tab"
        | "duplicate_tab"
        | "bad_columns"
        | "unknown_card"
        | "bad_span"
        | "bad_config"
        | "bad_visible_when"
        | "missing_required";
      tabIndex?: number;
      card?: CardType;
      configKey?: string;
    };
    "canvas.not_found": Record<string, never>;
    "canvas.name_taken": Record<string, never>;
    "canvas.in_use": Record<string, never>;
    "device_profile.invalid": {
      reason: "bad_capabilities" | "bad_canvas_ref" | "bad_inactivity_timeout";
    };
    "device_profile.not_found": Record<string, never>;
    "device_profile.name_taken": Record<string, never>;
    "device_profile.in_use": Record<string, never>;
    "theme.invalid": {
      reason: "not_object" | "bad_tokens" | "unknown_token" | "bad_value" | "too_long";
      token?: string;
      maxLength?: number;
    };
  }
}
