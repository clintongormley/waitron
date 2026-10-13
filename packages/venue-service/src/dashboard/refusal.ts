import { codeOf } from "@waitron/dashboard-kit";

export type Refusal = { code: string; params?: Record<string, unknown> };

export const refusalOf = (error: unknown): Refusal => ({
  code: codeOf(error),
  params:
    typeof error === "object" && error !== null
      ? (error as { params?: Record<string, unknown> }).params
      : undefined,
});
