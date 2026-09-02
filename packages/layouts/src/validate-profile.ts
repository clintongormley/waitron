// packages/layouts/src/validate-profile.ts
import { AppError } from "@waitron/shared";
import "./errors.js";
import { CARD_CONTRACTS, GRID_MAX_COLUMNS, SALE_CRITICAL_CARDS } from "./card-contract.js";
import { CARD_TYPES, CAPABILITY_FLAGS, FORM_FACTORS } from "./profile.js";
import type {
  CapabilityFlag,
  CardInstance,
  CardType,
  FormFactor,
  ProfileDef,
  TabDef,
} from "./profile.js";

/** Tab-title cap (design §4). Carried nowhere in an error param — a blank/over-long title is `bad_tab`. */
export const MAX_TAB_TITLE_LENGTH = 60;

/** Selling form factors must place every sale-critical card (§13). Till only for now; extend later. */
const SELLING_FORM_FACTORS: readonly FormFactor[] = ["till"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isFormFactor(v: unknown): v is FormFactor {
  return typeof v === "string" && (FORM_FACTORS as readonly string[]).includes(v);
}
function isCardType(v: unknown): v is CardType {
  return typeof v === "string" && (CARD_TYPES as readonly string[]).includes(v);
}
function isCapabilityFlag(v: unknown): v is CapabilityFlag {
  return typeof v === "string" && (CAPABILITY_FLAGS as readonly string[]).includes(v);
}

/**
 * Validate an untrusted profile (design §4/§6). Returns it on success; throws `profile.invalid` naming
 * the first rule broken, never echoing an author value (a tab is identified by its numeric index).
 */
export function validateProfile(input: unknown): ProfileDef {
  if (!isPlainObject(input)) throw new AppError("profile.invalid", { reason: "not_object" });
  if (!isFormFactor(input.formFactor))
    throw new AppError("profile.invalid", { reason: "bad_form_factor" });
  const capabilities = validateCapabilities(input.capabilities);
  if (!Array.isArray(input.tabs) || input.tabs.length === 0) {
    throw new AppError("profile.invalid", { reason: "no_tabs" });
  }
  const seenKeys = new Set<string>();
  const tabs: TabDef[] = input.tabs.map((raw, tabIndex) => validateTab(raw, tabIndex, seenKeys));
  const profile: ProfileDef = { formFactor: input.formFactor, capabilities, tabs };
  assertSaleCritical(profile, SELLING_FORM_FACTORS);
  return profile;
}

function validateCapabilities(input: unknown): CapabilityFlag[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || !input.every(isCapabilityFlag)) {
    throw new AppError("profile.invalid", { reason: "bad_capabilities" });
  }
  return input as CapabilityFlag[];
}

function validateTab(raw: unknown, tabIndex: number, seenKeys: Set<string>): TabDef {
  if (!isPlainObject(raw)) throw new AppError("profile.invalid", { reason: "bad_tab", tabIndex });
  const { key, title, columns } = raw;
  if (typeof key !== "string" || key.length === 0) {
    throw new AppError("profile.invalid", { reason: "bad_tab", tabIndex });
  }
  if (seenKeys.has(key))
    throw new AppError("profile.invalid", { reason: "duplicate_tab", tabIndex });
  seenKeys.add(key);
  if (typeof title !== "string" || title.length === 0 || title.length > MAX_TAB_TITLE_LENGTH) {
    throw new AppError("profile.invalid", { reason: "bad_tab", tabIndex });
  }
  if (
    typeof columns !== "number" ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > GRID_MAX_COLUMNS
  ) {
    throw new AppError("profile.invalid", { reason: "bad_columns", tabIndex });
  }
  const cards = validateCards(raw.cards, tabIndex, columns);
  return { key, title, columns, cards };
}

function validateCards(input: unknown, tabIndex: number, columns: number): CardInstance[] {
  if (!Array.isArray(input)) throw new AppError("profile.invalid", { reason: "bad_tab", tabIndex });
  return input.map((raw) => {
    if (!isPlainObject(raw) || !isCardType(raw.type)) {
      throw new AppError("profile.invalid", { reason: "unknown_card", tabIndex });
    }
    const type = raw.type;
    const { colSpan, rowSpan, config } = raw;
    if (
      typeof colSpan !== "number" ||
      !Number.isInteger(colSpan) ||
      colSpan < 1 ||
      colSpan > columns ||
      typeof rowSpan !== "number" ||
      !Number.isInteger(rowSpan) ||
      rowSpan < 1
    ) {
      throw new AppError("profile.invalid", { reason: "bad_span", tabIndex, card: type });
    }
    if (!isPlainObject(config)) {
      throw new AppError("profile.invalid", { reason: "bad_config", tabIndex, card: type });
    }
    const schema = CARD_CONTRACTS[type].configSchema;
    for (const [key, value] of Object.entries(config)) {
      // Own-property lookup, never a bare schema[key] — prototype-pollution safe (validate.ts:69).
      const validator = Object.hasOwn(schema, key) ? schema[key] : undefined;
      if (validator === undefined || !validator(value)) {
        throw new AppError("profile.invalid", {
          reason: "bad_config",
          tabIndex,
          card: type,
          configKey: key,
        });
      }
    }
    const states = CARD_CONTRACTS[type].visibilityStates;
    let visibleWhen: string[] | undefined;
    if (raw.visibleWhen !== undefined) {
      if (
        !Array.isArray(raw.visibleWhen) ||
        !raw.visibleWhen.every((s) => typeof s === "string" && states.includes(s))
      ) {
        throw new AppError("profile.invalid", { reason: "bad_visible_when", tabIndex, card: type });
      }
      // Normalise "absent or empty ⇒ always render" (profile.ts): a valid but EMPTY visibleWhen is
      // OMITTED, so a renderer can never misread `[]` as "no state matches ⇒ never render". A non-empty
      // array is copied so the validated card does not alias the untrusted input.
      if (raw.visibleWhen.length > 0) visibleWhen = [...(raw.visibleWhen as string[])];
    }
    const card: CardInstance = { type, colSpan, rowSpan, config };
    if (visibleWhen !== undefined) card.visibleWhen = visibleWhen;
    return card;
  });
}

function assertSaleCritical(profile: ProfileDef, selling: readonly FormFactor[]): void {
  if (!selling.includes(profile.formFactor)) return;
  const placed = new Set<CardType>();
  for (const tab of profile.tabs) for (const card of tab.cards) placed.add(card.type);
  for (const required of SALE_CRITICAL_CARDS) {
    if (!placed.has(required)) {
      throw new AppError("profile.invalid", { reason: "missing_required", card: required });
    }
  }
}
