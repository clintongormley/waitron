import { afterEach, describe, it, vi } from "vitest";
import type { DashboardApi, EmailInbox } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./email-screen.js";
import type { EmailScreen } from "./email-screen.js";

const LOCAL: EmailInbox = {
  mode: "local_capture",
  count: 1,
  messages: [
    {
      id: "mail-1",
      from: { name: "Waitron", address: "no-reply@waitron.test" },
      to: [{ name: "", address: "owner@example.test" }],
      subject: "Set up your account",
      snippet: "Open the link",
      createdAt: "2026-09-09T18:00:00Z",
      read: false,
    },
  ],
};

function stubApi(inbox: EmailInbox): DashboardApi {
  return {
    getEmailInbox: vi.fn().mockResolvedValue(inbox),
    getTestEmail: vi.fn().mockResolvedValue({
      id: "mail-1",
      from: LOCAL.messages[0]!.from,
      to: LOCAL.messages[0]!.to,
      subject: LOCAL.messages[0]!.subject,
      date: LOCAL.messages[0]!.createdAt,
      text: `Open ${window.location.origin}/manage/account?token=secret`,
    }),
  } as unknown as DashboardApi;
}

async function flush(el: EmailScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("email-screen a11y (%s theme)", (theme) => {
  it.each([
    LOCAL,
    { mode: "smtp", count: 0, messages: [] } as EmailInbox,
    { mode: "unconfigured", count: 0, messages: [] } as EmailInbox,
  ])("renders the $mode state accessibly", async (inbox) => {
    const { el, host } = await mountWidget<EmailScreen>(
      "dashboard-email-screen",
      { api: stubApi(inbox) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders an opened captured message accessibly", async () => {
    const { el, host } = await mountWidget<EmailScreen>(
      "dashboard-email-screen",
      { api: stubApi(LOCAL) },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=message-mail-1]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
