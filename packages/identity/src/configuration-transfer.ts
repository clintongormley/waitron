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
        // Its folded twin goes with it. Left in, a bundle would carry the folded form of an
        // address this list has deliberately stripped — and `display_name_folded` and
        // `email_folded` stay because their own values do.
        "pending_email_folded",
        "passkey_offered_at",
      ],
    },
    { name: "roles" },
    { name: "person_roles" },
    { name: "staff_roles" },
    { name: "person_staff_roles" },
    { name: "device_profile_admission_roles" },
  ],
} as const;
