import "./errors.js";
import { AppError } from "@waitron/shared";
import { CAPABILITY_FLAGS, type CapabilityFlag, type FormFactor } from "./canvas.js";

/** Refuses an unknown flag rather than dropping it: capabilities gate server routes. */
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
  till: ["integrated-card-payment", "open-cash-drawer", "print-receipt"],
  "phone-portrait": [],
  "tablet-landscape": [],
  kds: ["act-as-kds"],
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
