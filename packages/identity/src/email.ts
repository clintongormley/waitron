export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export { isValidEmail } from "@waitron/shared";
