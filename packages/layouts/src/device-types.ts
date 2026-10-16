export const FORM_FACTORS = ["till", "phone-portrait", "tablet-landscape", "kds"] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

export type DeviceKind = "kds_station" | "handheld" | "till";

export function kindOfFormFactor(ff: FormFactor): DeviceKind {
  const kinds = {
    till: "till",
    "phone-portrait": "handheld",
    "tablet-landscape": "handheld",
    kds: "kds_station",
  } satisfies Record<FormFactor, DeviceKind>;
  return kinds[ff];
}

/** Carried by a device profile. Each flag is either a {@link ProfileAction}, which
 * the server checks on the routes the map in `apps/server/src/till-api.profile-actions.test.ts`
 * lists, or a {@link ProfileScreen}, which only decides what the till shows. */
export const CAPABILITY_FLAGS = [
  "integrated-card-payment",
  "open-cash-drawer",
  "act-as-kds",
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
  "clock-in",
] as const;
export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number];

/** What a profile lets its device do (`profileAllows`; the server's `assertProfileAction`). */
export const PROFILE_ACTIONS = [
  "take-orders",
  "take-cash",
  "integrated-card-payment",
  "hand-keyed-card-payment",
  "prepare-orders",
  "hand-over-orders",
  "print-receipt",
  "open-cash-drawer",
  "clock-in",
] as const satisfies readonly CapabilityFlag[];
export type ProfileAction = (typeof PROFILE_ACTIONS)[number];

/** What a profile's till offers to look at. `act-as-kds` shows the kitchen board card;
 * `run-the-pass` decides whether a pass screen draws Fire, Ready and Away, whose routes check the
 * action each one takes. */
export const PROFILE_SCREENS = [
  "act-as-kds",
  "show-station",
  "show-expo",
  "show-schedule",
  "run-the-pass",
] as const satisfies readonly CapabilityFlag[];
export type ProfileScreen = (typeof PROFILE_SCREENS)[number];

/** The screens the till can open on its own, so the ones a profile may start on. */
export const NAVIGATION_SCREENS = [
  "show-station",
  "show-expo",
  "show-schedule",
] as const satisfies readonly ProfileScreen[];
export type NavigationScreen = (typeof NAVIGATION_SCREENS)[number];
