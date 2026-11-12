import { codeMessage } from "./codes.js";

export { bottomMessage } from "@waitron/ui";

export const refusal = (code: string | null): string | null =>
  code === null ? null : codeMessage(code);
