import type { FormFactor } from "./layout.js";

export type BuiltInScreen = "counter" | "floor" | "order" | "kitchen";

const SCREENS = {
  till: ["counter", "floor"],
  "phone-portrait": ["floor", "order"],
  "tablet-landscape": ["floor", "order"],
  kds: ["kitchen"],
} as const satisfies Record<FormFactor, readonly BuiltInScreen[]>;

export function builtInScreensFor(formFactor: FormFactor): readonly BuiltInScreen[] {
  return SCREENS[formFactor];
}

export function homeScreenFor(formFactor: FormFactor): BuiltInScreen {
  return SCREENS[formFactor][0];
}

export function resolveBuiltInScreen(
  formFactor: FormFactor,
  requested: string | null,
): BuiltInScreen {
  return (
    builtInScreensFor(formFactor).find((screen) => screen === requested) ??
    homeScreenFor(formFactor)
  );
}
