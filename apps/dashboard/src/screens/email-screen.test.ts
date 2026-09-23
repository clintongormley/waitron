import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, EmailInbox } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { EmailScreen } from "./email-screen.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

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

it("refreshes the inbox without a screen action", async () => {
  const liveData = new LiveData();
  const client = Object.assign(api(), { liveData });
  const { el } = await mountWidget<EmailScreen>("dashboard-email-screen", { api: client });
  await vi.waitFor(() => expect(q(el, "[data-test=message-mail-1]")).not.toBeNull());
  vi.mocked(client.getEmailInbox).mockResolvedValue({ ...LOCAL, count: 0, messages: [] });
  liveData.invalidate([{ type: "email_inbox" }]);
  await vi.waitFor(() => expect(q(el, "[data-test=message-mail-1]")).toBeNull());
});

describe("email-screen message and inbox edge cases", () => {
  function withBody(
    text: string,
    overrides: Partial<{ to: EmailInbox["messages"][number]["to"] }> = {},
  ) {
    const client = api();
    client.getTestEmail = vi.fn().mockResolvedValue({
      id: "mail-1",
      from: LOCAL.messages[0]!.from,
      to: overrides.to ?? LOCAL.messages[0]!.to,
      subject: LOCAL.messages[0]!.subject,
      date: LOCAL.messages[0]!.createdAt,
      text,
    });
    return client;
  }

  async function openFirst(client: DashboardApi) {
    const { el } = await mountWidget<EmailScreen>("dashboard-email-screen", { api: client });
    await vi.waitFor(() => expect(q(el, "[data-test=message-mail-1]")).not.toBeNull());
    q(el, "[data-test=message-mail-1]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=message-body]")).not.toBeNull());
    return el;
  }

  it("offers no account link when the message carries no URL", async () => {
    const el = await openFirst(withBody("Your account is ready."));

    expect(q(el, "[data-test=message-body]")?.textContent).toBe("Your account is ready.");
    expect(q(el, "[data-test=message-link]")).toBeNull();
  });

  it("offers no account link to another origin", async () => {
    const el = await openFirst(
      withBody("Open https://attacker.example/manage/account?token=secret"),
    );

    expect(q(el, "[data-test=message-body]")?.textContent).toContain("attacker.example");
    expect(q(el, "[data-test=message-link]")).toBeNull();
  });

  it("offers no account link when the URL cannot be parsed", async () => {
    const el = await openFirst(withBody("Open http://[not-a-host/manage"));

    expect(q(el, "[data-test=message-body]")?.textContent).toContain("http://[not-a-host/manage");
    expect(q(el, "[data-test=message-link]")).toBeNull();
  });

  it("links the same-origin account URL itself", async () => {
    const el = await openFirst(
      withBody(`Open ${window.location.origin}/manage/account?token=abc now`),
    );

    expect(q(el, "[data-test=message-link]")?.getAttribute("href")).toBe(
      `${window.location.origin}/manage/account?token=abc`,
    );
  });

  it("shows the named recipient in angle brackets beside the display name", async () => {
    const el = await openFirst(
      withBody("Hello", { to: [{ name: "Owner", address: "owner@example.test" }] }),
    );

    expect(el.shadowRoot!.textContent).toContain("Owner <owner@example.test>");
  });

  it("lists a message with no recipient with an empty recipient line", async () => {
    const inbox: EmailInbox = {
      ...LOCAL,
      messages: [{ ...LOCAL.messages[0]!, to: [] }],
    };
    const { el } = await mount(inbox);

    const spans = q(el, "[data-test=message-mail-1]")!.querySelectorAll("span");
    expect(spans[0]!.textContent).toBe("");
    expect(spans[1]!.textContent).toBe("Open the link");
  });

  it("shows a localized alert when a message cannot be opened, and clears it on the next open", async () => {
    const client = api();
    client.getTestEmail = vi
      .fn()
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValueOnce({
        id: "mail-1",
        from: LOCAL.messages[0]!.from,
        to: LOCAL.messages[0]!.to,
        subject: LOCAL.messages[0]!.subject,
        date: LOCAL.messages[0]!.createdAt,
        text: "Welcome",
      });
    const { el } = await mountWidget<EmailScreen>("dashboard-email-screen", { api: client });
    await vi.waitFor(() => expect(q(el, "[data-test=message-mail-1]")).not.toBeNull());

    q(el, "[data-test=message-mail-1]")!.click();
    await vi.waitFor(() =>
      expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed")),
    );
    expect(q(el, "[data-test=message-body]")).toBeNull();

    q(el, "[data-test=message-mail-1]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=message-body]")?.textContent).toBe("Welcome"));
    expect(q(el, "[role=alert]")).toBeNull();
  });

  it("reloads the inbox when Refresh is pressed", async () => {
    const { el, api: client } = await mount();
    expect(client.getEmailInbox).toHaveBeenCalledTimes(1);
    vi.mocked(client.getEmailInbox).mockResolvedValue({
      ...LOCAL,
      messages: [{ ...LOCAL.messages[0]!, id: "mail-2", subject: "Second message" }],
    });

    q(el, "[data-test=refresh]")!.click();

    await vi.waitFor(() =>
      expect(q(el, "[data-test=message-mail-2]")?.textContent).toContain("Second message"),
    );
    expect(client.getEmailInbox).toHaveBeenCalledTimes(2);
    expect(q(el, "[data-test=message-mail-1]")).toBeNull();
  });

  it("shows the empty-inbox copy when local capture holds no messages", async () => {
    const { el } = await mount({ mode: "local_capture", count: 0, messages: [] });

    expect(q(el, ".empty")?.textContent).toBe(t("email.empty"));
    expect(q(el, ".message-list")).toBeNull();
  });
});
