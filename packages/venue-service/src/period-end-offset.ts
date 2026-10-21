import { AppError } from "@waitron/shared";
import "./errors.js";

export function parseEndOffsetMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new AppError("menu_period.invalid", {
      field: "endOffsetMinutes",
      reason: "whole_minutes",
    });
  if (value < -1439 || value > 1439)
    throw new AppError("menu_period.invalid", { field: "endOffsetMinutes", reason: "range" });
  return value;
}
