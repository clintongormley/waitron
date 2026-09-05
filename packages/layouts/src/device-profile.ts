import "./errors.js";
import { AppError } from "@waitron/shared";
import { CAPABILITY_FLAGS, type CapabilityFlag, FORM_FACTORS, type FormFactor } from "./canvas.js";

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

// Referenced so a future FORM_FACTORS change forces this map to be revisited (exhaustive keys above).
void FORM_FACTORS;
