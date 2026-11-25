import { hashSecret, hashSecretAsync, verifySecretAsync } from "./secret-hash.js";
import { AppError, MIN_PIN_LENGTH } from "@waitron/shared";

export { MIN_PIN_LENGTH };

export function assertPinLength(pin: string): void {
  if (pin.length < MIN_PIN_LENGTH) throw new AppError("pin.too_short", { min: MIN_PIN_LENGTH });
}

export function hashPin(pin: string): string {
  return hashSecret(pin);
}

export function hashPinAsync(pin: string): Promise<string> {
  return hashSecretAsync(pin);
}

export function verifyPin(pin: string, stored: string): Promise<boolean> {
  return verifySecretAsync(pin, stored);
}
