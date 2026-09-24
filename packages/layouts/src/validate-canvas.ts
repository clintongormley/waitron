import { AppError } from "@waitron/shared";
import "./errors.js";
import { CARD_CONTRACTS, GRID_MAX_COLUMNS, SALE_CRITICAL_CARDS } from "./card-contract.js";
import { CARD_TYPES, FORM_FACTORS } from "./canvas.js";
import { validateThemeOverride } from "./theme.js";
import type { CardInstance, CardType, FormFactor, CanvasDef, TabDef } from "./canvas.js";

export const MAX_TAB_TITLE_LENGTH = 60;

export const SELLING_FORM_FACTORS: readonly FormFactor[] = ["till"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isFormFactor(v: unknown): v is FormFactor {
  return typeof v === "string" && (FORM_FACTORS as readonly string[]).includes(v);
}
function isCardType(v: unknown): v is CardType {
  return typeof v === "string" && (CARD_TYPES as readonly string[]).includes(v);
}
/** A `capabilities` key on the input is ignored: capabilities belong to the device profile. */
export function validateCanvas(input: unknown): CanvasDef {
  if (!isPlainObject(input)) throw new AppError("canvas.invalid", { reason: "not_object" });
  if (!isFormFactor(input.formFactor))
    throw new AppError("canvas.invalid", { reason: "bad_form_factor" });
  if (!Array.isArray(input.tabs) || input.tabs.length === 0) {
    throw new AppError("canvas.invalid", { reason: "no_tabs" });
  }
  const seenKeys = new Set<string>();
  const tabs: TabDef[] = input.tabs.map((raw, tabIndex) => validateTab(raw, tabIndex, seenKeys));
  const canvas: CanvasDef = { formFactor: input.formFactor, tabs };
  assertSaleCritical(canvas, SELLING_FORM_FACTORS);
  if (input.theme !== undefined) canvas.theme = validateThemeOverride(input.theme);
  return canvas;
}

function validateTab(raw: unknown, tabIndex: number, seenKeys: Set<string>): TabDef {
  if (!isPlainObject(raw)) throw new AppError("canvas.invalid", { reason: "bad_tab", tabIndex });
  const { key, title, columns } = raw;
  if (typeof key !== "string" || key.length === 0) {
    throw new AppError("canvas.invalid", { reason: "bad_tab", tabIndex });
  }
  if (seenKeys.has(key))
    throw new AppError("canvas.invalid", { reason: "duplicate_tab", tabIndex });
  seenKeys.add(key);
  if (typeof title !== "string" || title.length === 0 || title.length > MAX_TAB_TITLE_LENGTH) {
    throw new AppError("canvas.invalid", { reason: "bad_tab", tabIndex });
  }
  if (
    typeof columns !== "number" ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > GRID_MAX_COLUMNS
  ) {
    throw new AppError("canvas.invalid", { reason: "bad_columns", tabIndex });
  }
  const cards = validateCards(raw.cards, tabIndex, columns);
  return { key, title, columns, cards };
}

function validateCards(input: unknown, tabIndex: number, columns: number): CardInstance[] {
  if (!Array.isArray(input)) throw new AppError("canvas.invalid", { reason: "bad_tab", tabIndex });
  return input.map((raw) => {
    if (!isPlainObject(raw) || !isCardType(raw.type)) {
      throw new AppError("canvas.invalid", { reason: "unknown_card", tabIndex });
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
      throw new AppError("canvas.invalid", { reason: "bad_span", tabIndex, card: type });
    }
    if (!isPlainObject(config)) {
      throw new AppError("canvas.invalid", { reason: "bad_config", tabIndex, card: type });
    }
    const schema = CARD_CONTRACTS[type].configSchema;
    for (const [key, value] of Object.entries(config)) {
      // Own-property lookup: a bare `schema[key]` would find `constructor` on the prototype.
      const validator = Object.hasOwn(schema, key) ? schema[key] : undefined;
      if (validator === undefined || !validator(value)) {
        throw new AppError("canvas.invalid", {
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
        throw new AppError("canvas.invalid", { reason: "bad_visible_when", tabIndex, card: type });
      }
      // An empty list is omitted so a renderer cannot read `[]` as "never render".
      if (raw.visibleWhen.length > 0) visibleWhen = [...(raw.visibleWhen as string[])];
    }
    const card: CardInstance = { type, colSpan, rowSpan, config: { ...config } };
    if (visibleWhen !== undefined) card.visibleWhen = visibleWhen;
    return card;
  });
}

function assertSaleCritical(canvas: CanvasDef, selling: readonly FormFactor[]): void {
  if (!selling.includes(canvas.formFactor)) return;
  const placed = new Set<CardType>();
  for (const tab of canvas.tabs) for (const card of tab.cards) placed.add(card.type);
  for (const required of SALE_CRITICAL_CARDS) {
    if (!placed.has(required)) {
      throw new AppError("canvas.invalid", { reason: "missing_required", card: required });
    }
  }
}
