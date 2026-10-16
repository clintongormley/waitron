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

export const PROFILE_SCREENS = [
  "act-as-kds",
  "show-station",
  "show-expo",
  "show-schedule",
  "run-the-pass",
] as const satisfies readonly CapabilityFlag[];

/** The screens a profile may start on. */
export const NAVIGATION_SCREENS = [
  "show-station",
  "show-expo",
  "show-schedule",
] as const satisfies readonly CapabilityFlag[];

export const FORM_FACTORS = ["till", "phone-portrait", "tablet-landscape", "kds"] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

/** A `kds` profile is a shared display: nobody signs in on it. */
export function isSharedDisplay(formFactor: FormFactor): boolean {
  return formFactor === "kds";
}

/** The actions a shared display can be given: every other one needs a named person signed in. */
const SHARED_DISPLAY_ACTIONS: readonly CapabilityFlag[] = [
  "prepare-orders",
  "take-orders",
  "hand-over-orders",
];

/** Whether a shared display may hold `flag`: any screen, and only its own actions. */
export function sharedDisplayMay(flag: CapabilityFlag): boolean {
  return (
    !(PROFILE_ACTIONS as readonly CapabilityFlag[]).includes(flag) ||
    SHARED_DISPLAY_ACTIONS.includes(flag)
  );
}
