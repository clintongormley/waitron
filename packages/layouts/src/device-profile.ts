import "./errors.js";
import { AppError } from "@waitron/shared";
import {
  CAPABILITY_FLAGS,
  NAVIGATION_SCREENS,
  PROFILE_ACTIONS,
  type CapabilityFlag,
  type FormFactor,
  type NavigationScreen,
  type ProfileAction,
} from "./canvas.js";

/** A `kds` profile is a shared display: nobody signs in on it. */
export function isSharedDisplay(formFactor: FormFactor): boolean {
  return formFactor === "kds";
}

/** The actions a shared display can be given: every other one needs a named person signed in.
 * Taking is for a kitchen display's pass-screen Fire and its station screen's Move to station;
 * handing over is for its pass screen. */
const SHARED_DISPLAY_ACTIONS: readonly ProfileAction[] = [
  "prepare-orders",
  "take-orders",
  "hand-over-orders",
];

function sharedDisplayMay(flag: CapabilityFlag): boolean {
  const action = (PROFILE_ACTIONS as readonly CapabilityFlag[]).includes(flag);
  return !action || SHARED_DISPLAY_ACTIONS.includes(flag as ProfileAction);
}

/** Whether the profile permits `action`. A shared display is refused every action but its own, even
 * one its stored list names, because that list is not validated when a row is written directly. */
export function profileAllows(
  profile: { formFactor: FormFactor; capabilities: readonly string[] },
  action: ProfileAction,
): boolean {
  if (isSharedDisplay(profile.formFactor) && !SHARED_DISPLAY_ACTIONS.includes(action)) return false;
  return profile.capabilities.includes(action);
}

/** Refuses an unknown flag rather than dropping it: some capabilities gate server routes. With a
 * form factor, a shared display is also refused the actions only a named person may take. */
export function validateCapabilities(input: unknown, formFactor?: FormFactor): CapabilityFlag[] {
  if (!Array.isArray(input)) {
    throw new AppError("device_profile.invalid", { reason: "bad_capabilities" });
  }
  const out: CapabilityFlag[] = [];
  for (const raw of input) {
    if (typeof raw !== "string" || !(CAPABILITY_FLAGS as readonly string[]).includes(raw)) {
      throw new AppError("device_profile.invalid", { reason: "bad_capabilities" });
    }
    const flag = raw as CapabilityFlag;
    if (formFactor !== undefined && isSharedDisplay(formFactor) && !sharedDisplayMay(flag)) {
      throw new AppError("device_profile.invalid", { reason: "shared_display_action" });
    }
    if (!out.includes(flag)) out.push(flag);
  }
  return out;
}

/** `null` leaves the till on its canvas's first view; otherwise one of the navigation screens the
 * profile's `capabilities` show. */
export function validateStartingScreen(
  value: unknown,
  capabilities: readonly string[],
): NavigationScreen | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !(NAVIGATION_SCREENS as readonly string[]).includes(value) ||
    !capabilities.includes(value)
  ) {
    throw new AppError("device_profile.invalid", { reason: "bad_starting_screen" });
  }
  return value as NavigationScreen;
}

/**
 * The auto-logout idle timeout in seconds. `null` already means never, so zero is refused rather
 * than read as "log out at once". A `kds` profile always gets `null`: a kitchen display has no
 * signed-in operator.
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

export const DEFAULT_PROFILE_CAPABILITIES: Record<FormFactor, CapabilityFlag[]> = {
  till: [
    "integrated-card-payment",
    "open-cash-drawer",
    "print-receipt",
    "show-station",
    "show-expo",
    "show-schedule",
    "take-cash",
    "take-orders",
    "hand-keyed-card-payment",
    "prepare-orders",
    "hand-over-orders",
    "run-the-pass",
  ],
  "phone-portrait": [
    "take-orders",
    "hand-keyed-card-payment",
    "prepare-orders",
    "hand-over-orders",
  ],
  "tablet-landscape": [],
  kds: ["act-as-kds", "prepare-orders", "take-orders", "hand-over-orders"],
};

/** No `canvasId`: a seeded profile binds no canvas, so its canvas is resolved by form factor
 * (`getCanvasForFormFactor`). */
export interface DefaultDeviceProfile {
  formFactor: FormFactor;
  capabilities: CapabilityFlag[];
  /** Seconds; `null` or omitted means never. The operator-facing profiles carry one so the next
   * operator does not inherit the last one's session. */
  inactivityTimeoutSeconds?: number | null;
  /** Keyed by bare language subtag (`"es"`). */
  nameByLocale: Record<string, string>;
}

/** Seeded by provisioning's `planVenue`, which `dev:setup` also runs. */
export const DEFAULT_DEVICE_PROFILES: readonly DefaultDeviceProfile[] = [
  {
    formFactor: "till",
    capabilities: DEFAULT_PROFILE_CAPABILITIES.till,
    nameByLocale: { es: "Mostrador", en: "Counter" },
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
    inactivityTimeoutSeconds: 300,
  },
];

const DEFAULT_PROFILE_LANGUAGE = "es";

/** `locale` is a full tag such as `"es-ES"`; only its language subtag is read. */
export function defaultProfileName(profile: DefaultDeviceProfile, locale: string): string {
  const language = locale.split("-")[0]!.toLowerCase();
  return profile.nameByLocale[language] ?? profile.nameByLocale[DEFAULT_PROFILE_LANGUAGE]!;
}
