import { hashSecret, verifySecret } from "./secret-hash.js";
import { AppError } from "@waitron/shared";

export const MIN_PIN_LENGTH = 4;

export function assertPinLength(pin: string): void {
  if (pin.length < MIN_PIN_LENGTH) throw new AppError("pin.too_short", { min: MIN_PIN_LENGTH });
}

export function hashPin(pin: string): string {
  return hashSecret(pin);
}

export function verifyPin(pin: string, stored: string): boolean {
  return verifySecret(pin, stored);
}
