import { defineSettingsDocument } from "@waitron/db";

export interface MailDocument {
  from: string | null;
}

export const MAIL_SETTINGS = defineSettingsDocument<MailDocument>({
  module: "mail",
  version: 1,
  transfers: false,
  defaults: () => ({ from: null }),
  parse(value) {
    if (
      value === null ||
      typeof value !== "object" ||
      !("from" in value) ||
      (value.from !== null && typeof value.from !== "string")
    )
      return { ok: false, field: "from" };
    return { ok: true, doc: { from: value.from } };
  },
});
