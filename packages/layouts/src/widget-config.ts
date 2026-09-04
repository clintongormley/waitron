/**
 * A single config-value validator: returns true iff `value` is acceptable for its key. It receives
 * `unknown` and must narrow defensively — never assume a type — so a hostile config bag cannot slip a
 * wrong-typed value past it (fail-closed, design D8). Consumed by the canvas card-contract model
 * (`card-contract.ts`).
 */
export type ConfigValidator = (value: unknown) => boolean;

/** The allowed config keys for one card, each mapped to its value validator. */
export type WidgetConfigSchema = Record<string, ConfigValidator>;
