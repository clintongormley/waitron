import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, EmailInbox } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { EmailScreen } from "./email-screen.js";

afterEach(cleanupWidgets);

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

function api(inbox: EmailInbox = LOCAL): DashboardApi {
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

async function mount(inbox: EmailInbox = LOCAL) {
  const client = api(inbox);
  const mounted = await mountWidget<EmailScreen>("dashboard-email-screen", { api: client });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await mounted.el.updateComplete;
  return { ...mounted, api: client };
}

const q = (el: EmailScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);

describe("email-screen", () => {
  it("opens the local test inbox and lists captured messages", async () => {
    const { el, api: client } = await mount();

    expect(client.getEmailInbox).toHaveBeenCalled();
    expect(q(el, "[data-test=local-capture]")).not.toBeNull();
    expect(q(el, "[data-test=message-mail-1]")?.textContent).toContain("Set up your account");
  });

  it("opens a captured message as escaped text with its same-origin account link", async () => {
    const { el, api: client } = await mount();

    q(el, "[data-test=message-mail-1]")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(client.getTestEmail).toHaveBeenCalledWith("mail-1");
    expect(q(el, "[data-test=message-body]")?.textContent).toContain("token=secret");
    expect(q(el, "[data-test=message-link]")).not.toBeNull();
  });

  it("explains that configured SMTP delivers messages externally", async () => {
    const { el } = await mount({ mode: "smtp", count: 0, messages: [] });

    expect(q(el, "[data-test=smtp]")).not.toBeNull();
    expect(q(el, "[data-test=local-capture]")).toBeNull();
  });

  it("explains that live email is unconfigured", async () => {
    const { el } = await mount({ mode: "unconfigured", count: 0, messages: [] });

    expect(q(el, "[data-test=unconfigured]")).not.toBeNull();
  });

  it("shows a localized alert when the inbox cannot be loaded", async () => {
    const client = api();
    client.getEmailInbox = vi.fn().mockRejectedValue({ code: "server.internal" });
    const { el } = await mountWidget<EmailScreen>("dashboard-email-screen", { api: client });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(q(el, "[role=alert]")).not.toBeNull();
    expect(q(el, "[role=alert]")?.textContent).not.toContain("server.internal");
  });
});
