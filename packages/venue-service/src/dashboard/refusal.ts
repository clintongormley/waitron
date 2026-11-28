import { codeOf } from "@waitron/dashboard-kit";
import { format } from "./hours-view.js";

export type Refusal = { code: string; params?: Record<string, unknown> };

export const refusalOf = (error: unknown): Refusal => ({
  code: codeOf(error),
  params:
    typeof error === "object" && error !== null
      ? (error as { params?: Record<string, unknown> }).params
      : undefined,
});

export function counterZoneRefusal(
  error: unknown,
  field: "orderStart" | "departmentId",
): string | undefined {
  const { code, params } = refusalOf(error);
  if (
    code === "zone.counter_has_tables" &&
    params?.field === field &&
    typeof params.zoneName === "string"
  )
    return format("venue.counter_has_tables", { zoneName: params.zoneName });
}
