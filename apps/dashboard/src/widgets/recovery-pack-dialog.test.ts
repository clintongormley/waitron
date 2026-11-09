import { afterEach, describe, expect, it, vi } from "vitest";
import type { WtDialog } from "@waitron/ui";
import { DashboardApi } from "../api/client.js";
import type { MadeRecoveryPack, RecoveryPackStatus } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, setLocale, t } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import type { RecoveryPackDialog, RecoveryPackMade } from "./recovery-pack-dialog.js";
import "./recovery-pack-dialog.js";

const MADE_AT = "2026-10-12T12:00:00.000Z";

function status(overrides: Partial<RecoveryPackStatus> = {}): RecoveryPackStatus {
  return {
    latest: null,
    upToDate: false,
    incomplete: false,
    unreceived: null,
    reasons: [],
    keep: [],
    backupsUseOlderKey: false,
    timeZone: "Europe/Madrid",
    ...overrides,
  };
}

/** The current server key is on pack 3, which a browser confirmed receiving. */
const HELD = status({ keep: [{ number: 3, madeAt: MADE_AT, until: null, why: "server_key" }] });
/** The current server key is on pack 3, which no browser confirmed receiving. */
const UNRECEIVED = status({
  unreceived: { number: 3, madeAt: MADE_AT, holdsCurrentServerKey: true },
});

function pdf(): Blob {
  return new Blob(["%PDF-1.7 pack"], { type: "application/pdf" });
}

function stubApi() {
  return {
    makeRecoveryPack: vi
      .fn<(body: unknown) => Promise<MadeRecoveryPack>>()
      .mockResolvedValue({ pdf: pdf(), number: 4, key: "unchanged" }),
    markRecoveryPackReceived: vi.fn<(n: number) => Promise<void>>().mockResolvedValue(undefined),
    getRecoveryPackStatus: vi.fn<() => Promise<RecoveryPackStatus>>().mockResolvedValue(status()),
  };
}

type Api = ReturnType<typeof stubApi>;

async function open(options: { api?: Api; at?: RecoveryPackStatus | null } = {}) {
  const api = options.api ?? stubApi();
  const { el } = await mountWidget<RecoveryPackDialog>("dashboard-recovery-pack-dialog", {
    api: api as unknown as DashboardApi,
  });
  el.show(options.at === undefined ? status() : options.at);
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  return { el, api, dialog };
}

function button(el: RecoveryPackDialog, test: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `wt-button[data-test=${test}]`,
  );
}

function box(el: RecoveryPackDialog): HTMLInputElement {
  return el.shadowRoot!.querySelector<HTMLInputElement>("input[name=new-server-key]")!;
}

function tick(el: RecoveryPackDialog): void {
  box(el).click();
}

function words(node: Element | null | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function bottom(el: RecoveryPackDialog): string {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
    .error;
}

function made(el: RecoveryPackDialog) {
  const seen: RecoveryPackMade[] = [];
  el.addEventListener("recovery-pack-made", (event) =>
    seen.push((event as CustomEvent<RecoveryPackMade>).detail),
  );
  return seen;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const option = () => t("recovery_pack_dialog.new_key");
const unreceivedWords = () =>
  fill("recovery_pack_dialog.unreceived", { number: "3", date: "12 October", option: option() });

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());
afterEach(() => setLocale("en-GB"));

describe("the form", () => {
  it("draws recovery choices and both actions without a duplicate sign-in form", async () => {
    const { el, dialog } = await open();
    expect(dialog.heading).toBe(t("recovery_pack_dialog.heading"));
    expect(words(el.shadowRoot!.querySelector("[data-test=intro]"))).toBe(
      t("recovery_pack_dialog.intro"),
    );
    expect(el.shadowRoot!.querySelector("dashboard-fresh-sign-in")).toBeNull();
    expect(box(el).checked).toBe(false);
    expect(words(el.shadowRoot!.querySelector("label[for=new-server-key]"))).toBe(option());
    expect(button(el, "cancel-pack")!.slot).toBe("cancel");
    expect(words(button(el, "make-pack"))).toBe(t("recovery_pack_dialog.make"));
    expect(button(el, "make-pack")!.variant).toBe("primary");
    expect(button(el, "make-pack")!.disabled).toBe(false);
  });

  it("turns Make pack to the danger colour when the box is ticked", async () => {
    const { el } = await open();
    tick(el);
    await el.updateComplete;
    expect(button(el, "make-pack")!.variant).toBe("danger");
  });

  it("names the pack holding the current key, with its date, under the box", async () => {
    const { el } = await open({ at: HELD });
    expect(words(el.shadowRoot!.querySelector("[data-test=new-key-why]"))).toBe(
      `${fill("recovery_pack_dialog.new_key_held", { number: "3", date: "12 October" })} ${t("recovery_pack_dialog.new_key_effect")}`,
    );
  });

  it.each([
    // 01:30 on 13 October at the venue; 12 October in any zone from UTC-11 to UTC+12.
    ["Pacific/Kiritimati", "2026-10-12T11:30:00.000Z", "13 October"],
    // 22:30 on 12 October at the venue; 13 October in any zone from UTC to UTC+14.
    ["Pacific/Pago_Pago", "2026-10-13T09:30:00.000Z", "12 October"],
  ])(
    "dates the pack in the venue's zone (%s), not the browser's",
    async (timeZone, madeAt, day) => {
      setLocale("en-GB");
      const { el } = await open({
        at: status({ timeZone, keep: [{ number: 3, madeAt, until: null, why: "server_key" }] }),
      });
      expect(words(el.shadowRoot!.querySelector("[data-test=new-key-why]"))).toContain(
        fill("recovery_pack_dialog.new_key_held", { number: "3", date: day }),
      );
    },
  );

  it("says the pack holding the current key was never confirmed received, when the status says so", async () => {
    const { el } = await open({ at: UNRECEIVED });
    const why = words(el.shadowRoot!.querySelector("[data-test=new-key-why]"));
    expect(why).toBe(`${unreceivedWords()} ${t("recovery_pack_dialog.new_key_effect")}`);
    expect(why).not.toContain(
      fill("recovery_pack_dialog.new_key_held", { number: "3", date: "12 October" }),
    );
  });

  it("names no pack when the status names none holding the key", async () => {
    const { el } = await open({ at: status() });
    expect(words(el.shadowRoot!.querySelector("[data-test=new-key-why]"))).toBe(
      `${t("recovery_pack_dialog.new_key_unknown")} ${t("recovery_pack_dialog.new_key_effect")}`,
    );
  });

  it("offers no new server key on a box whose last pack had no server-key part", async () => {
    const at = status({
      latest: {
        number: 2,
        madeAt: MADE_AT,
        madeByName: "Marta",
        received: true,
        parts: [
          { part: "bucket", state: "included" },
          { part: "server-key", state: "absent" },
        ],
      },
    });
    const { el, api } = await open({ at });
    expect(el.shadowRoot!.querySelector("input[name=new-server-key]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=new-key-why]")).toBeNull();
    expect(button(el, "make-pack")!.variant).toBe("primary");
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    expect(api.makeRecoveryPack.mock.calls[0]![0]).toMatchObject({ newServerKey: false });
  });

  it("offers the new server key while no pack has been made, since nothing is known yet", async () => {
    const { el } = await open({ at: status({ latest: null }) });
    expect(el.shadowRoot!.querySelector("input[name=new-server-key]")).not.toBeNull();
  });

  it("offers the new server key when the last pack had a server-key part", async () => {
    const at = status({
      latest: {
        number: 2,
        madeAt: MADE_AT,
        madeByName: "Marta",
        received: true,
        parts: [{ part: "server-key", state: "failed" }],
      },
    });
    const { el } = await open({ at });
    expect(el.shadowRoot!.querySelector("input[name=new-server-key]")).not.toBeNull();
  });
});

describe("a made pack", () => {
  it("marks the pack received, then hands the PDF over and closes", async () => {
    const { el, api, dialog } = await open();
    const order: string[] = [];
    api.markRecoveryPackReceived.mockImplementation(async () => {
      order.push("marked");
    });
    el.addEventListener("recovery-pack-made", () => order.push("handed"));
    const seen = made(el);
    const closeAfter = vi.spyOn(dialog, "closeAfter");
    tick(el);
    await el.updateComplete;
    button(el, "make-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.makeRecoveryPack).toHaveBeenCalledWith({
      locale: "en",
      newServerKey: true,
    });
    expect(api.markRecoveryPackReceived).toHaveBeenCalledWith(4);
    expect(order).toEqual(["marked", "handed"]);
    expect(seen[0]).toEqual({
      pdf: expect.any(Blob),
      number: 4,
      key: "unchanged",
      received: true,
    });
    expect(seen[0]!.pdf.type).toBe("application/pdf");
    expect(closeAfter).toHaveBeenCalledWith("security");
    await expect.poll(() => dialog.open).toBe(false);
  });

  it("sends one make at a time: a second press while it is out sends nothing", async () => {
    const api = stubApi();
    const answer = deferred<MadeRecoveryPack>();
    api.makeRecoveryPack.mockReturnValue(answer.promise);
    const { el } = await open({ api });
    const seen = made(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    button(el, "make-pack")!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.makeRecoveryPack).toHaveBeenCalledOnce();
    answer.resolve({ pdf: pdf(), number: 4, key: "unchanged" });
    await expect.poll(() => seen.length).toBe(1);
    expect(api.makeRecoveryPack).toHaveBeenCalledOnce();
  });

  it("asks for the pack in Spanish when the screen is in Spanish", async () => {
    setLocale("es-ES");
    const { el, api } = await open();
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    expect(api.makeRecoveryPack.mock.calls[0]![0]).toMatchObject({
      locale: "es",
      newServerKey: false,
    });
  });

  it("tries the mark once more when it fails, and hands the PDF over either way", async () => {
    const api = stubApi();
    api.markRecoveryPackReceived
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockRejectedValueOnce({ code: "connection.failed" });
    const { el } = await open({ api });
    const seen = made(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.markRecoveryPackReceived).toHaveBeenCalledTimes(2);
    expect(seen[0]!.received).toBe(false);
  });

  it("is marked received when the second try succeeds", async () => {
    const api = stubApi();
    api.markRecoveryPackReceived.mockRejectedValueOnce({ code: "connection.failed" });
    const { el } = await open({ api });
    const seen = made(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.markRecoveryPackReceived).toHaveBeenCalledTimes(2);
    expect(seen[0]!.received).toBe(true);
  });
});

describe("closing", () => {
  it("drops an answer that arrives after Cancel", async () => {
    const api = stubApi();
    const answer = deferred<MadeRecoveryPack>();
    api.makeRecoveryPack.mockReturnValue(answer.promise);
    const { el, dialog } = await open({ api });
    const seen = made(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    const closed = dialogClosed(dialog);
    button(el, "cancel-pack")!.click();
    await closed;
    answer.resolve({ pdf: pdf(), number: 4, key: "replaced" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen).toEqual([]);
    expect(api.markRecoveryPackReceived).not.toHaveBeenCalled();
    expect(dialog.open).toBe(false);
  });

  it("drops a lost answer that arrives after Cancel without reading the status", async () => {
    const api = stubApi();
    const answer = deferred<MadeRecoveryPack>();
    api.makeRecoveryPack.mockReturnValue(answer.promise);
    const { el, dialog } = await open({ api });
    button(el, "make-pack")!.click();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    const closed = dialogClosed(dialog);
    button(el, "cancel-pack")!.click();
    await closed;
    answer.reject({ code: "connection.failed" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.getRecoveryPackStatus).not.toHaveBeenCalled();
    expect(dialog.open).toBe(false);
  });

  it("forgets its new-key choice on close, and a reopened dialog starts unticked", async () => {
    const { el, dialog } = await open();
    tick(el);
    const closed = dialogClosed(dialog);
    button(el, "cancel-pack")!.click();
    await closed;
    el.show(status());
    await expect.poll(() => dialog.open).toBe(true);
    expect(box(el).checked).toBe(false);
  });
});

describe("the server key was not replaced", () => {
  async function failedKey(at: RecoveryPackStatus) {
    const api = stubApi();
    api.makeRecoveryPack.mockResolvedValue({ pdf: pdf(), number: 4, key: "failed" });
    api.getRecoveryPackStatus.mockResolvedValue(at);
    const { el, dialog } = await open({ api, at: HELD });
    const seen = made(el);
    tick(el);
    await el.updateComplete;
    button(el, "make-pack")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=key-failed]")).not.toBeNull();
    return { el, api, dialog, seen };
  }

  const first = () =>
    fill("recovery_pack_dialog.key_failed", { not: t("recovery_pack_dialog.not") });

  it("still hands the PDF over, and says where the current key is when its pack was received", async () => {
    const { el, api, dialog, seen } = await failedKey(HELD);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ number: 4, key: "failed", received: true });
    expect(api.markRecoveryPackReceived).toHaveBeenCalledWith(4);
    expect(dialog.open).toBe(true);
    expect(words(el.shadowRoot!.querySelector("[data-test=key-failed]"))).toBe(
      `${first()} ${fill("recovery_pack_dialog.key_still_works", { number: "3", date: "12 October" })}`,
    );
    expect(el.shadowRoot!.querySelector("[data-test=key-failed] strong")!.textContent).toBe(
      t("recovery_pack_dialog.not"),
    );
  });

  it("uses the unreceived wording when the pack holding the key was never confirmed received", async () => {
    const { el } = await failedKey(UNRECEIVED);
    expect(words(el.shadowRoot!.querySelector("[data-test=key-failed]"))).toBe(
      `${first()} ${unreceivedWords()}`,
    );
  });

  it("says only that the key was not replaced when the status names no pack holding a key", async () => {
    const { el } = await failedKey(status());
    expect(words(el.shadowRoot!.querySelector("[data-test=key-failed]"))).toBe(first());
  });

  it("closes on Close", async () => {
    const { el, dialog } = await failedKey(HELD);
    expect(button(el, "make-pack")).toBeNull();
    const closed = dialogClosed(dialog);
    button(el, "close-pack")!.click();
    await closed;
    expect(dialog.open).toBe(false);
  });

  it("closes as a made pack when the box was not ticked", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockResolvedValue({ pdf: pdf(), number: 4, key: "failed" });
    const { el, dialog } = await open({ api });
    const seen = made(el);
    button(el, "make-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    await expect.poll(() => dialog.open).toBe(false);
  });
});

describe("a lost answer", () => {
  async function lose(options: { ticked: boolean; error?: unknown; after?: RecoveryPackStatus }) {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue(options.error ?? { code: "connection.failed" });
    api.getRecoveryPackStatus.mockResolvedValue(options.after ?? status());
    const { el, dialog } = await open({ api, at: HELD });
    if (options.ticked) tick(el);
    await el.updateComplete;
    button(el, "make-pack")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=lost]")).not.toBeNull();
    return { el, api, dialog };
  }

  it("with the box ticked, reads the status again and warns that the only copy of the key may be on a pack the person does not have", async () => {
    const { el, api } = await lose({ ticked: true });
    expect(api.getRecoveryPackStatus).toHaveBeenCalledOnce();
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).toContain(t("recovery_pack_dialog.lost_new_key"));
    expect(lost).not.toContain(codeMessage("connection.failed"));
    expect(bottom(el)).toBe("");
    expect(words(button(el, "remake-pack"))).toBe(t("recovery_pack_dialog.remake"));
    expect(words(button(el, "stop-pack"))).toBe(t("recovery_pack_dialog.stop"));
    expect(button(el, "make-pack")).toBeNull();
    expect(button(el, "retry-pack")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-fresh-sign-in")).toBeNull();
  });

  it("names the pack and its date when the status names it unreceived, and hands the status on", async () => {
    const after = status({
      unreceived: { number: 4, madeAt: MADE_AT, holdsCurrentServerKey: true },
    });
    const statuses: RecoveryPackStatus[] = [];
    const listening = new AbortController();
    document.addEventListener(
      "recovery-pack-status",
      (event) => statuses.push((event as CustomEvent<RecoveryPackStatus>).detail),
      { signal: listening.signal },
    );
    const { el } = await lose({ ticked: true, after });
    listening.abort();
    expect(statuses).toEqual([after]);
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).toContain(
      fill("recovery_pack_dialog.lost_new_key_named", { number: "4", date: "12 October" }),
    );
  });

  it("names no pack when the status names none unreceived", async () => {
    const { el } = await lose({ ticked: true, after: HELD });
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).not.toContain("recovery pack 3");
    expect(lost).not.toContain("recovery pack 4");
  });

  it("offers a new pack with a new key, ticked, through the shared sign-in gate", async () => {
    const { el, api } = await lose({ ticked: true });
    button(el, "remake-pack")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=lost]")).toBeNull();
    expect(box(el).checked).toBe(true);
    expect(el.shadowRoot!.querySelector("dashboard-fresh-sign-in")).toBeNull();
    expect(api.makeRecoveryPack).toHaveBeenCalledOnce();
    expect(button(el, "make-pack")!.variant).toBe("danger");
  });

  it("Stop closes the dialog", async () => {
    const { el, dialog } = await lose({ ticked: true });
    const closed = dialogClosed(dialog);
    button(el, "stop-pack")!.click();
    await closed;
    expect(dialog.open).toBe(false);
  });

  it("with the box not ticked, says the pack may have been made and offers Try again and Stop", async () => {
    const { el, api } = await lose({ ticked: false });
    expect(api.getRecoveryPackStatus).toHaveBeenCalledOnce();
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).toContain(t("recovery_pack_dialog.lost"));
    expect(lost).not.toContain(t("recovery_pack_dialog.lost_new_key"));
    expect(words(button(el, "retry-pack"))).toBe(t("recovery_pack_dialog.try_again"));
    expect(button(el, "stop-pack")).not.toBeNull();
    expect(button(el, "remake-pack")).toBeNull();
  });

  it("Try again sends the request once more", async () => {
    const { el, api } = await lose({ ticked: false });
    api.makeRecoveryPack.mockResolvedValue({ pdf: pdf(), number: 5, key: "unchanged" });
    const seen = made(el);
    button(el, "retry-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.makeRecoveryPack).toHaveBeenCalledTimes(2);
    expect(seen[0]!.number).toBe(5);
  });

  it("counts a body the browser refused as not whole as lost", async () => {
    const { el } = await lose({ ticked: true, error: { code: "recovery.pack_invalid" } });
    expect(words(el.shadowRoot!.querySelector("[data-test=lost]"))).toContain(
      t("recovery_pack_dialog.lost_new_key"),
    );
  });

  it("counts a connection dropped mid-body as lost", async () => {
    const { el } = await lose({ ticked: true, error: new TypeError("network error") });
    expect(words(el.shadowRoot!.querySelector("[data-test=lost]"))).toContain(
      t("recovery_pack_dialog.lost_new_key"),
    );
  });

  describe("through the real client", () => {
    function boxApi(makeAnswer: () => Response) {
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      const calls: string[] = [];
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const call = `${init?.method ?? "GET"} ${String(input)}`;
        calls.push(call);
        if (call === "POST /api/backup/recovery-pack") return makeAnswer();
        if (call === "GET /api/backup/recovery-pack") return json(status());
        throw new Error(`Unexpected request: ${call}`);
      });
      return { api: new DashboardApi("", fetchImpl as typeof fetch), calls };
    }

    async function press(api: DashboardApi) {
      const { el } = await mountWidget<RecoveryPackDialog>("dashboard-recovery-pack-dialog", {
        api,
      });
      el.show(HELD);
      await el.updateComplete;
      tick(el);
      await el.updateComplete;
      button(el, "make-pack")!.click();
      return el;
    }

    it("counts a gateway's plain-text 502 as lost, not as the box's refusal", async () => {
      const { api, calls } = boxApi(
        () =>
          new Response("Bad Gateway", { status: 502, headers: { "Content-Type": "text/plain" } }),
      );
      const el = await press(api);
      await expect.poll(() => el.shadowRoot!.querySelector("[data-test=lost]")).not.toBeNull();
      expect(words(el.shadowRoot!.querySelector("[data-test=lost]"))).toContain(
        t("recovery_pack_dialog.lost_new_key"),
      );
      expect(calls.filter((call) => call === "GET /api/backup/recovery-pack")).toHaveLength(1);
      expect(bottom(el)).toBe("");
    });

    it("keeps the box's own refusal envelope a refusal", async () => {
      const { api, calls } = boxApi(
        () =>
          new Response(JSON.stringify({ error: { code: "password.throttled" } }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }),
      );
      const el = await press(api);
      await expect.poll(() => bottom(el)).toBe(codeMessage("password.throttled"));
      expect(el.shadowRoot!.querySelector("[data-test=lost]")).toBeNull();
      expect(calls).not.toContain("GET /api/backup/recovery-pack");
    });
  });

  it("still warns when the status cannot be read again", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({ code: "connection.timed_out" });
    api.getRecoveryPackStatus.mockRejectedValue({ code: "connection.failed" });
    const { el } = await open({ api });
    tick(el);
    await el.updateComplete;
    button(el, "make-pack")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=lost]")).not.toBeNull();
    expect(words(el.shadowRoot!.querySelector("[data-test=lost]"))).toContain(
      t("recovery_pack_dialog.lost_new_key"),
    );
  });
});

describe("a refusal", () => {
  it("shows a server refusal and keeps Make pack working", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({ code: "password.throttled", status: 429 });
    const { el } = await open({ api });
    tick(el);
    await el.updateComplete;
    button(el, "make-pack")!.click();
    await expect.poll(() => bottom(el)).toBe(codeMessage("password.throttled"));
    expect(el.shadowRoot!.querySelector("[data-test=lost]")).toBeNull();
    expect(api.getRecoveryPackStatus).not.toHaveBeenCalled();
    expect(button(el, "make-pack")!.disabled).toBe(false);
  });

  it("forgets a refusal on Cancel, so a reopened dialog shows none and sends nothing", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({ code: "password.throttled", status: 429 });
    const { el, dialog } = await open({ api });
    button(el, "make-pack")!.click();
    await expect.poll(() => bottom(el)).toBe(codeMessage("password.throttled"));
    const closed = dialogClosed(dialog);
    button(el, "cancel-pack")!.click();
    await closed;
    el.show(status());
    await expect.poll(() => dialog.open).toBe(true);
    await el.updateComplete;
    expect(bottom(el)).toBe("");
    expect(api.makeRecoveryPack).toHaveBeenCalledOnce();
  });

  it("shows the box's own recovery.pack_invalid as a refusal in words, not as a lost answer", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({
      code: "recovery.pack_invalid",
      params: { reason: "shape" },
      status: 400,
    });
    const { el } = await open({ api });
    tick(el);
    await el.updateComplete;
    button(el, "make-pack")!.click();
    await expect.poll(() => bottom(el)).toBe(codeMessage("recovery.pack_invalid"));
    expect(bottom(el)).not.toBe(codeMessage("test.unmapped_code"));
    expect(el.shadowRoot!.querySelector("[data-test=lost]")).toBeNull();
  });
});

describe("the words", () => {
  const KEYS = [
    "recovery_pack_dialog.heading",
    "recovery_pack_dialog.intro",
    "recovery_pack_dialog.new_key",
    "recovery_pack_dialog.new_key_held",
    "recovery_pack_dialog.new_key_unknown",
    "recovery_pack_dialog.new_key_effect",
    "recovery_pack_dialog.unreceived",
    "recovery_pack_dialog.make",
    "recovery_pack_dialog.key_failed",
    "recovery_pack_dialog.not",
    "recovery_pack_dialog.key_still_works",
    "recovery_pack_dialog.lost_new_key",
    "recovery_pack_dialog.lost_new_key_named",
    "recovery_pack_dialog.lost_new_key_choices",
    "recovery_pack_dialog.lost",
    "recovery_pack_dialog.lost_choices",
    "recovery_pack_dialog.remake",
    "recovery_pack_dialog.try_again",
    "recovery_pack_dialog.stop",
  ] as const;

  it("has its own English and Spanish for every sentence", () => {
    for (const key of KEYS) {
      expect(en[key], key).toBeTruthy();
      expect(es[key], key).toBeTruthy();
      expect(es[key], key).not.toBe(en[key]);
    }
  });

  it("uses the plan's unreceived wording", () => {
    expect(en["recovery_pack_dialog.unreceived"]).toBe(
      "The current server key is on recovery pack {number}, made on {date}, but the box was never told that pack {number} arrived. If you do not have pack {number}, make a new pack with {option} ticked.",
    );
  });

  it("says the key was not replaced without claiming its page was not drawn", () => {
    expect(en["recovery_pack_dialog.key_failed"]).toBe(
      "The pack was made, but the server key was {not} replaced. The server key page in the pack says why.",
    );
    expect(es["recovery_pack_dialog.key_failed"]).toBe(
      "El paquete se ha hecho, pero la clave del servidor {not} se ha sustituido. La página de la clave del servidor del paquete explica por qué.",
    );
  });

  it("dates a pack in Spanish on a Spanish screen", async () => {
    setLocale("es-ES");
    const { el } = await open({ at: HELD });
    expect(words(el.shadowRoot!.querySelector("[data-test=new-key-why]"))).toContain(
      "12 de octubre",
    );
    expect(el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.heading).toBe(
      es["recovery_pack_dialog.heading"],
    );
  });
});
