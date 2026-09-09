import "./errors.js";
import { AppError } from "@waitron/shared";
import { CAPABILITY_FLAGS, type CapabilityFlag, type FormFactor } from "./canvas.js";

/**
 * Fail-closed validation of a device profile's capability set (design §7). Rejects a non-array or any
 * element not in CAPABILITY_FLAGS with `device_profile.invalid` — the server-authoritative gate, since
 * capabilities drive the /api/pay + /api/drawer firewall. Deduplicates; preserves first-seen order.
 */
export function validateCapabilities(input: unknown): CapabilityFlag[] {
  if (!Array.isArray(input)) {
    throw new AppError("device_profile.invalid", { reason: "bad_capabilities" });
  }
  const out: CapabilityFlag[] = [];
  for (const raw of input) {
    if (typeof raw !== "string" || !(CAPABILITY_FLAGS as readonly string[]).includes(raw)) {
      throw new AppError("device_profile.invalid", { reason: "bad_capabilities" });
    }
    const flag = raw as CapabilityFlag;
    if (!out.includes(flag)) out.push(flag);
  }
  return out;
}

/**
 * Fail-closed validation of a profile's auto-logout idle timeout (seconds). NULL means "never log
 * out". A `kds` profile is FORCED to NULL — a kitchen display is not a logged-in operator, so it is
 * exempt from auto-logout regardless of what a caller passes. A non-null value must be a POSITIVE
 * integer; NULL is already the "never log out" sentinel, so 0 (any value < 1, or a non-integer)
 * throws `device_profile.invalid` {reason: "bad_inactivity_timeout"} — 0 would mean "log out
 * immediately", which Task 7's auto-logout would turn into an unusable device. Returns the value to
 * store.
 */
export function validateInactivityTimeout(
  value: number | null,
  formFactor: FormFactor,
): number | null {
  if (formFactor === "kds") return null;
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1) {
    throw new AppError("device_profile.invalid", { reason: "bad_inactivity_timeout" });
  }
  return value;
}

/**
 * The default capabilities a device of each form factor should get when a profile is seeded from the
 * built-in defaults (design §5.3/§10). These are the values that used to live on DEFAULT_CANVASES,
 * relocated here as capabilities leave the canvas record (Task 9).
 */
export const DEFAULT_PROFILE_CAPABILITIES: Record<FormFactor, CapabilityFlag[]> = {
  till: ["integrated-card-payment", "open-cash-drawer"],
  "phone-portrait": [],
  "tablet-landscape": [],
  kds: ["act-as-kds"],
};
// The `Record<FormFactor, …>` annotation makes this map exhaustive: a new FORM_FACTORS member fails
// to compile until it is added here.

/** One entry of the starter device-profile set: which form factor it targets, the capabilities it
 * seeds (the form-factor defaults), and its localized name. `canvasId` is deliberately absent — every
 * seeded profile binds `canvasId: null`, so the resolver falls back to the form-factor default canvas
 * at runtime (design §5.3), and no canvas row need exist for the venue to render. */
export interface DefaultDeviceProfile {
  formFactor: FormFactor;
  capabilities: CapabilityFlag[];
  /** The auto-logout idle timeout (seconds) the profile is seeded with; NULL/omitted = never. Both
   * operator-facing form factors — `till` (Counter) and `phone-portrait` (Handheld) — carry one so the
   * next operator does not inherit the last one's session; `kds` (a kitchen display, no logged-in
   * operator) is exempt. The 300 s (five-minute) default is owner-confirmed at review. */
  inactivityTimeoutSeconds?: number | null;
  /**
   * The seeded name per BARE language subtag (`"es"`, `"en"`). These names are LOCALE CONTENT — the
   * tenant renames them freely — NOT schema tokens, so the Spanish literals live here, in an
   * isolated map, rather than in the guard's base list or a module's `vocabulary` declaration; the
   * english-only guard (which scans this package) does not flag them because none is a Spanish word
   * it knows. `defaultProfileName` resolves a full invoice-locale tag against this map.
   */
  nameByLocale: Record<string, string>;
}

/**
 * The starter device-profile set every new tenant is seeded with at provisioning (task-3 follow-on b,
 * owner decision 2026-09-05): Counter (till), Kitchen (kds), Handheld (phone-portrait). Provisioning
 * (`applyVenue`) and `dev:setup` both read THIS list, so dev and production seed the identical set.
 * Each profile carries `DEFAULT_PROFILE_CAPABILITIES[formFactor]` and binds no canvas.
 */
export const DEFAULT_DEVICE_PROFILES: readonly DefaultDeviceProfile[] = [
  {
    formFactor: "till",
    capabilities: DEFAULT_PROFILE_CAPABILITIES.till,
    nameByLocale: { es: "Mostrador", en: "Counter" },
    // A shared counter till auto-logs-out after five minutes idle so the next operator does not
    // inherit the last one's session; still editable per profile.
    inactivityTimeoutSeconds: 300,
  },
  {
    formFactor: "kds",
    capabilities: DEFAULT_PROFILE_CAPABILITIES.kds,
    nameByLocale: { es: "Cocina", en: "Kitchen" },
  },
  {
    formFactor: "phone-portrait",
    capabilities: DEFAULT_PROFILE_CAPABILITIES["phone-portrait"],
    nameByLocale: { es: "Móvil", en: "Handheld" },
    // A shared handheld auto-logs-out after five minutes idle (as the counter till does); kds is exempt.
    inactivityTimeoutSeconds: 300,
  },
];

/** The language a seeded profile name falls back to when the venue's locale has no mapping — Spanish,
 * as Waitron is a Spanish POS (task-3 owner decision: "default to es"). */
const DEFAULT_PROFILE_LANGUAGE = "es";

/**
 * Resolve a seeded profile's name for a venue's primary invoice locale (a full tag such as `"es-ES"`
 * or `"en-GB"`): keys off the lowercased LANGUAGE subtag, falling back to Spanish for any locale the
 * map does not cover. Pure.
 */
export function defaultProfileName(profile: DefaultDeviceProfile, locale: string): string {
  const language = locale.split("-")[0]!.toLowerCase();
  return profile.nameByLocale[language] ?? profile.nameByLocale[DEFAULT_PROFILE_LANGUAGE]!;
}
