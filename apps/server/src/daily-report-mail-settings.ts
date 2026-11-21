import { defineSettingsDocument } from "@waitron/db";

interface DailyReportMailSettings {
  enabled: boolean;
  recipientIds: string[];
}

export const DAILY_REPORT_MAIL_SETTINGS = defineSettingsDocument<DailyReportMailSettings>({
  module: "daily_report_mail",
  version: 1,
  transfers: false,
  defaults: () => ({ enabled: false, recipientIds: [] }),
  parse(value) {
    const doc = value as Partial<DailyReportMailSettings> | null;
    if (typeof doc?.enabled !== "boolean") return { ok: false, field: "enabled" };
    const ids = doc.recipientIds;
    if (
      !Array.isArray(ids) ||
      !ids.every((id) => typeof id === "string" && id !== "") ||
      (doc.enabled && ids.length === 0)
    ) {
      return { ok: false, field: "recipientIds" };
    }
    return { ok: true, doc: { enabled: doc.enabled, recipientIds: [...new Set(ids)] } };
  },
});
