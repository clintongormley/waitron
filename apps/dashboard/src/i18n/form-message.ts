import { codeMessage } from "./codes.js";

/** A form's one message about a failed submission: each non-empty part, in order. */
export const bottomMessage = (...parts: (string | null)[]): string =>
  parts.filter((part): part is string => part !== null && part !== "").join(" ");

export const refusal = (code: string | null): string | null =>
  code === null ? null : codeMessage(code);
