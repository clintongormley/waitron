import "./errors.js";
import { AppError } from "@waitron/shared";
import { hashSecret, verifySecret } from "./secret-hash.js";

export const MIN_PASSWORD_LENGTH = 8;

export function assertPasswordLength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError("password.too_short", { min: MIN_PASSWORD_LENGTH });
  }
}

export function hashPassword(password: string): string {
  return hashSecret(password);
}

export function verifyPassword(password: string, stored: string): boolean {
  return verifySecret(password, stored);
}
