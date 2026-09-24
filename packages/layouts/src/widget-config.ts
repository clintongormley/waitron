/** Receives the untrusted value as `unknown` and must narrow it itself before accepting it. */
export type ConfigValidator = (value: unknown) => boolean;

export type WidgetConfigSchema = Record<string, ConfigValidator>;
