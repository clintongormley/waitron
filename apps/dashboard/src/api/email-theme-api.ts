import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { ThemeChoices, ThemeWarning } from "@waitron/ui-core/theme";
import { TranslationsApi } from "./translations-api.js";

export interface TestEmailAddress {
  name: string;
  address: string;
}

export interface TestEmailSummary {
  id: string;
  from: TestEmailAddress;
  to: TestEmailAddress[];
  subject: string;
  snippet: string;
  createdAt: string;
  read: boolean;
}

export interface TestEmail extends Omit<TestEmailSummary, "snippet" | "createdAt" | "read"> {
  date: string;
  text: string;
}

export interface EmailInbox {
  mode: "local_capture" | "smtp" | "unconfigured";
  count: number;
  messages: TestEmailSummary[];
}

export interface EmailSettingsDraft {
  server: string;
  port: number;
  encryption: "starttls" | "tls";
  user: string;
  password: string;
  from: string;
}

export interface DailyReportSettingsDraft {
  enabled: boolean;
  recipientIds: string[];
  revision: number;
}

export interface DailyReportSettingsView extends DailyReportSettingsDraft {
  recipients: { id: string; name: string }[];
}

export interface EmailSettingsView {
  mode: "smtp" | "local_capture" | "unconfigured";
  editable: boolean;
  settings: (Omit<EmailSettingsDraft, "user" | "password"> & { hasAuthentication: boolean }) | null;
}

export const SMTP_TEST_CODES = [
  "email.test_host_not_found",
  "email.test_connection_refused",
  "email.test_starttls_refused",
  "email.test_tls_refused",
  "email.test_certificate_untrusted",
  "email.test_login_refused",
  "email.test_login_required",
  "email.test_timeout",
  "email.test_refused",
] as const;

export type SmtpTestCode = (typeof SMTP_TEST_CODES)[number];

export type EmailSettingsTestResult = { accepted: true } | { accepted: false; code: SmtpTestCode };

export interface ThemeView {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly choices: ThemeChoices | null;
  readonly light: Readonly<Record<string, string>> | null;
  readonly dark: Readonly<Record<string, string>> | null;
  readonly warnings: readonly ThemeWarning[];
}

export interface ThemeList {
  readonly themes: readonly ThemeView[];
  readonly inUse: string | null;
}

export interface ThemeLogoPrint {
  /** The library's display rendition; null when the image is gone. */
  readonly address: string | null;
  readonly papers: Readonly<
    Record<
      "80mm" | "58mm",
      {
        readonly paperDots: number;
        /** Null when the image is gone or will not decode. */
        readonly picture: {
          readonly widthDots: number;
          readonly heightDots: number;
          readonly data: string;
        } | null;
        readonly blackDots: number;
      }
    >
  >;
}

export class EmailThemeApi extends TranslationsApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  getEmailInbox(): Promise<EmailInbox> {
    return this.#request<EmailInbox>("/management-api/email", "GET");
  }
  getEmailSettings(): Promise<EmailSettingsView> {
    return this.#request<EmailSettingsView>("/management-api/email/settings", "GET");
  }
  getDailyReportSettings(): Promise<DailyReportSettingsView> {
    return this.#request("/management-api/email/settings/daily-report", "GET");
  }
  saveDailyReportSettings(body: DailyReportSettingsDraft): Promise<DailyReportSettingsDraft> {
    return this.#request("/management-api/email/settings/daily-report", "PUT", body);
  }
  saveEmailSettings(body: EmailSettingsDraft): Promise<{ saved: true }> {
    return this.#request("/management-api/email/settings", "PUT", body);
  }
  removeEmailSettings(): Promise<{ removed: true }> {
    return this.#request("/management-api/email/settings", "DELETE");
  }
  testEmailSettings(body: EmailSettingsDraft): Promise<EmailSettingsTestResult> {
    return this.#request("/management-api/email/settings/test", "POST", body);
  }
  getTestEmail(id: string): Promise<TestEmail> {
    return this.#request<TestEmail>(
      `/management-api/email/message/${encodeURIComponent(id)}`,
      "GET",
    );
  }
  listThemes(): Promise<ThemeList> {
    return this.#request<ThemeList>("/management-api/themes", "GET");
  }
  saveTheme(id: string, theme: ThemeChoices): Promise<ThemeView> {
    return this.#request<ThemeView>(`/management-api/themes/${id}`, "PUT", { theme });
  }
  createTheme(input: { name: string; theme: ThemeChoices; inUse: boolean }): Promise<ThemeView> {
    return this.#request<ThemeView>("/management-api/themes", "POST", input);
  }
  renameTheme(id: string, name: string): Promise<ThemeView> {
    return this.#request<ThemeView>(`/management-api/themes/${id}`, "PATCH", { name });
  }
  deleteTheme(id: string): Promise<{ inUse: string | null }> {
    return this.#request<{ inUse: string | null }>(`/management-api/themes/${id}`, "DELETE");
  }
  useTheme(customThemeId: string | null): Promise<{ inUse: string | null }> {
    return this.#request<{ inUse: string | null }>("/management-api/theme-in-use", "PUT", {
      customThemeId,
    });
  }
}
