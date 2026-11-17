export const PERSONS_EMAIL = { table: "persons", columns: ["email_folded"] } as const;
export const PERSONS_LIVE_DISPLAY_NAME = {
  table: "persons",
  columns: ["display_name_folded"],
} as const;
export const PERSONS_PENDING_EMAIL = {
  table: "persons",
  columns: ["pending_email_folded"],
} as const;
