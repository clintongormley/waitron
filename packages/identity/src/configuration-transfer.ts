export const IDENTITY_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [
    {
      name: "persons",
      omit: [
        "pin_hash",
        "password_hash",
        "totp_secret",
        "email_verified_at",
        "google_subject",
        "pending_email",
      ],
    },
  ],
} as const;
