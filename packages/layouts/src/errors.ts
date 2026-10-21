import "@waitron/shared";
import type { ThemeNameRefusal, ThemeRefusalReason } from "@waitron/ui-core/theme";

// Receipt params name known fields and approved languages, never authored text or unknown keys.
declare module "@waitron/shared" {
  interface ErrorParams {
    "receipt.invalid": {
      reason:
        | "not_object"
        | "not_string"
        | "invalid_language"
        | "too_long"
        | "unknown_field"
        | "invalid_phone"
        | "invalid_description"
        | "invalid_email"
        | "not_boolean"
        | "invalid_logo"
        | "image_not_found";
      field?:
        | "headerSubtitle"
        | "footerMessage"
        | "phone"
        | "email"
        | "printAddress"
        | "logo"
        | "operationDescription";
      language?: string;
      maxLength?: number;
    };
    "device_profile.invalid": {
      reason:
        | "bad_capabilities"
        | "bad_inactivity_timeout"
        | "shared_display_action"
        | "bad_starting_screen"
        | "default_not_listed"
        | "no_cash_drawer";
      /** The printer list or default field a `default_not_listed` or `no_cash_drawer` names. */
      field?: string;
    };
    /** `field` names the request field that held the id, where that is not the path's own. */
    "device_profile.not_found": { field?: "approvedProfileIds" };
    "device_profile.name_taken": Record<string, never>;
    "device_profile.in_use": Record<string, never>;
    "theme.invalid": { field: string; reason: ThemeRefusalReason | ThemeNameRefusal };
    "theme.name_taken": { field: "name" };
    "theme.not_found": Record<string, never>;
  }
}
