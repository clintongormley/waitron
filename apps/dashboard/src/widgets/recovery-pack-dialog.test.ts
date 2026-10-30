import { afterEach, describe, expect, it, vi } from "vitest";
import type { WtDialog } from "@waitron/ui";
import type {
  DashboardApi,
  MadeRecoveryPack,
  OwnProfile,
  RecoveryPackStatus,
} from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, setLocale, t } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import type { FreshSignIn } from "./fresh-sign-in.js";
import type { RecoveryPackDialog, RecoveryPackMade } from "./recovery-pack-dialog.js";
import "./recovery-pack-dialog.js";

const PASSKEY = { id: "pk1", name: null, createdAt: "", lastUsedAt: null, provider: null };
const MADE_AT = "2026-10-12T12:00:00.000Z";

function profile(overrides: Partial<OwnProfile> = {}): OwnProfile {
  return {
    displayName: "Marta",
    firstNames: "Marta",
    lastNames: "López",
    telephone: null,
    email: "marta@example.test",
    pendingEmail: null,
    locale: null,
    hasPassword: true,
    hasTotp: false,
    hasGoogle: false,
    passkeys: [],
    ...overrides,
  };
}

function status(overrides: Partial<RecoveryPackStatus> = {}): RecoveryPackStatus {
  return {
    latest: null,
    upToDate: false,
    incomplete: false,
    unreceived: null,
    reasons: [],
    keep: [],
    backupsUseOlderKey: false,
    ...overrides,
  };
}

/** The current server key is on pack 3, which reached a browser. */
const HELD = status({ keep: [{ number: 3, madeAt: MADE_AT, until: null, why: "server_key" }] });
/** The current server key is on pack 3, which never reached a browser. */
const UNRECEIVED = status({
  unreceived: { number: 3, madeAt: MADE_AT, holdsCurrentServerKey: true },
});

function pdf(): Blob {
  return new Blob(["%PDF-1.7 pack"], { type: "application/pdf" });
}

function stubApi(own = profile()) {
  return {
    getProfile: vi.fn().mockResolvedValue(own),
    recoveryPackPasskeyOptions: vi
      .fn()
      .mockResolvedValue({ challengeHandle: "h1", options: { challenge: "AQID" } }),
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
  const signIn = await signInOf(el);
  return { el, api, dialog, signIn };
}

async function signInOf(el: RecoveryPackDialog): Promise<FreshSignIn> {
  await expect
    .poll(() => el.shadowRoot!.querySelector<FreshSignIn>("dashboard-fresh-sign-in")?.ways)
    .not.toBeNull();
  const signIn = el.shadowRoot!.querySelector<FreshSignIn>("dashboard-fresh-sign-in")!;
  await signIn.updateComplete;
  return signIn;
}

function field(signIn: FreshSignIn, name: string) {
  return signIn.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name=${name}]`,
  );
}

function type(signIn: FreshSignIn, name: string, value: string): void {
  field(signIn, name)!.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
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
  it("draws the heading, the intro, the sign-in fields, the box and both actions", async () => {
    const { el, dialog, signIn } = await open();
    expect(dialog.heading).toBe(t("recovery_pack_dialog.heading"));
    expect(words(el.shadowRoot!.querySelector("[data-test=intro]"))).toBe(
      t("recovery_pack_dialog.intro"),
    );
    expect(field(signIn, "current-password")).not.toBeNull();
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

  it("says the pack holding the current key never reached a browser, when the status says so", async () => {
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
    const { el, api, signIn } = await open({ at });
    expect(el.shadowRoot!.querySelector("input[name=new-server-key]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=new-key-why]")).toBeNull();
    expect(button(el, "make-pack")!.variant).toBe("primary");
    type(signIn, "current-password", "hunter2-hunter2");
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

  it("offers no Make action to a person with no way to sign in again", async () => {
    const { el } = await open({ api: stubApi(profile({ hasPassword: false, passkeys: [] })) });
    expect(button(el, "make-pack")).toBeNull();
    expect(button(el, "cancel-pack")).not.toBeNull();
  });

  it("marks an empty password on the first press, and holds Make pack until it is filled", async () => {
    const { el, api, signIn } = await open();
    button(el, "make-pack")!.click();
    await expect
      .poll(() => field(signIn, "current-password")!.error)
      .toBe(t("form.password_required"));
    await el.updateComplete;
    expect(button(el, "make-pack")!.disabled).toBe(true);
    expect(bottom(el)).toBe(t("form.fix_fields"));
    expect(api.makeRecoveryPack).not.toHaveBeenCalled();
    type(signIn, "current-password", "hunter2-hunter2");
    await el.updateComplete;
    expect(button(el, "make-pack")!.disabled).toBe(false);
    expect(bottom(el)).toBe("");
    type(signIn, "current-password", "");
    await signIn.updateComplete;
    await el.updateComplete;
    expect(field(signIn, "current-password")!.error).toBe(t("form.password_required"));
    expect(button(el, "make-pack")!.disabled).toBe(true);
  });
});

describe("a made pack", () => {
  it("marks the pack received, then hands the PDF over and closes", async () => {
    const { el, api, dialog, signIn } = await open();
    const order: string[] = [];
    api.markRecoveryPackReceived.mockImplementation(async () => {
      order.push("marked");
    });
    el.addEventListener("recovery-pack-made", () => order.push("handed"));
    const seen = made(el);
    const closeAfter = vi.spyOn(dialog, "closeAfter");
    type(signIn, "current-password", "hunter2-hunter2");
    tick(el);
    await el.updateComplete;
    button(el, "make-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.makeRecoveryPack).toHaveBeenCalledWith({
      locale: "en",
      newServerKey: true,
      signIn: { method: "password", password: "hunter2-hunter2" },
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

  it("asks for the pack in Spanish when the screen is in Spanish", async () => {
    setLocale("es-ES");
    const { el, api, signIn } = await open();
    type(signIn, "current-password", "hunter2-hunter2");
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
    const { el, signIn } = await open({ api });
    const seen = made(el);
    type(signIn, "current-password", "hunter2-hunter2");
    button(el, "make-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.markRecoveryPackReceived).toHaveBeenCalledTimes(2);
    expect(seen[0]!.received).toBe(false);
  });

  it("is marked received when the second try succeeds", async () => {
    const api = stubApi();
    api.markRecoveryPackReceived.mockRejectedValueOnce({ code: "connection.failed" });
    const { el, signIn } = await open({ api });
    const seen = made(el);
    type(signIn, "current-password", "hunter2-hunter2");
    button(el, "make-pack")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.markRecoveryPackReceived).toHaveBeenCalledTimes(2);
    expect(seen[0]!.received).toBe(true);
  });

  it("signs in with the passkey when its button is pressed", async () => {
    vi.spyOn(navigator.credentials, "get").mockResolvedValue({
      id: "cred-abc",
      rawId: new Uint8Array([1]).buffer,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: new Uint8Array([2]).buffer,
        authenticatorData: new Uint8Array([3]).buffer,
        signature: new Uint8Array([4]).buffer,
        userHandle: new Uint8Array([5]).buffer,
      },
      getClientExtensionResults: () => ({}),
      toJSON: vi.fn(),
    } as unknown as PublicKeyCredential);
    const { el, api, signIn } = await open({ api: stubApi(profile({ passkeys: [PASSKEY] })) });
    const seen = made(el);
    signIn.shadowRoot!.querySelector<HTMLElement>("[data-test=use-passkey]")!.click();
    await expect.poll(() => seen.length).toBe(1);
    expect(api.makeRecoveryPack.mock.calls[0]![0]).toMatchObject({
      signIn: { method: "passkey", challengeHandle: "h1" },
    });
  });
});

describe("closing", () => {
  it("drops an answer that arrives after Cancel", async () => {
    const api = stubApi();
    const answer = deferred<MadeRecoveryPack>();
    api.makeRecoveryPack.mockReturnValue(answer.promise);
    const { el, dialog, signIn } = await open({ api });
    const seen = made(el);
    type(signIn, "current-password", "hunter2-hunter2");
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
    const { el, dialog, signIn } = await open({ api });
    type(signIn, "current-password", "hunter2-hunter2");
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

  it("forgets the password on close, and a reopened dialog starts empty", async () => {
    const { el, dialog, signIn } = await open();
    type(signIn, "current-password", "hunter2-hunter2");
    tick(el);
    await signIn.updateComplete;
    expect(signIn.typed).toBe(true);
    const closed = dialogClosed(dialog);
    button(el, "cancel-pack")!.click();
    await closed;
    expect(signIn.typed).toBe(false);
    el.show(status());
    await expect.poll(() => dialog.open).toBe(true);
    const again = await signInOf(el);
    expect(field(again, "current-password")!.value).toBe("");
    expect(box(el).checked).toBe(false);
  });
});

describe("the server key was not replaced", () => {
  async function failedKey(at: RecoveryPackStatus) {
    const api = stubApi();
    api.makeRecoveryPack.mockResolvedValue({ pdf: pdf(), number: 4, key: "failed" });
    api.getRecoveryPackStatus.mockResolvedValue(at);
    const { el, dialog, signIn } = await open({ api, at: HELD });
    const seen = made(el);
    type(signIn, "current-password", "hunter2-hunter2");
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

  it("uses the unreceived wording when the pack holding the key never reached a browser", async () => {
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
    const { el, dialog, signIn } = await open({ api });
    const seen = made(el);
    type(signIn, "current-password", "hunter2-hunter2");
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
    const { el, dialog, signIn } = await open({ api, at: HELD });
    type(signIn, "current-password", "hunter2-hunter2");
    if (options.ticked) tick(el);
    await el.updateComplete;
    button(el, "make-pack")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=lost]")).not.toBeNull();
    return { el, api, dialog, signIn };
  }

  it("with the box ticked, reads the status again and warns that the only copy of the key may be on a pack the person does not have", async () => {
    const { el, api, signIn } = await lose({ ticked: true });
    expect(api.getRecoveryPackStatus).toHaveBeenCalledOnce();
    const lost = words(el.shadowRoot!.querySelector("[data-test=lost]"));
    expect(lost).toContain(t("recovery_pack_dialog.lost_new_key"));
    expect(lost).not.toContain(codeMessage("connection.failed"));
    expect(bottom(el)).toBe("");
    expect(words(button(el, "remake-pack"))).toBe(t("recovery_pack_dialog.remake"));
    expect(words(button(el, "stop-pack"))).toBe(t("recovery_pack_dialog.stop"));
    expect(button(el, "make-pack")).toBeNull();
    expect(button(el, "retry-pack")).toBeNull();
    expect(signIn.typed).toBe(false);
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

  it("offers a new pack with a new key, ticked, which needs the sign-in again", async () => {
    const { el, api } = await lose({ ticked: true });
    button(el, "remake-pack")!.click();
    await el.updateComplete;
    const signIn = await signInOf(el);
    expect(el.shadowRoot!.querySelector("[data-test=lost]")).toBeNull();
    expect(box(el).checked).toBe(true);
    expect(field(signIn, "current-password")!.value).toBe("");
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

  it("still warns when the status cannot be read again", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({ code: "connection.timed_out" });
    api.getRecoveryPackStatus.mockRejectedValue({ code: "connection.failed" });
    const { el, signIn } = await open({ api });
    type(signIn, "current-password", "hunter2-hunter2");
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
    const { el, signIn } = await open({ api });
    type(signIn, "current-password", "hunter2-hunter2");
    tick(el);
    await el.updateComplete;
    button(el, "make-pack")!.click();
    await expect.poll(() => bottom(el)).toBe(codeMessage("password.throttled"));
    expect(el.shadowRoot!.querySelector("[data-test=lost]")).toBeNull();
    expect(api.getRecoveryPackStatus).not.toHaveBeenCalled();
    expect(button(el, "make-pack")!.disabled).toBe(false);
  });

  it("puts a wrong password under its field, and keeps Make pack working", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({ code: "password.invalid", status: 401 });
    const { el, signIn } = await open({ api });
    type(signIn, "current-password", "wrong-password");
    button(el, "make-pack")!.click();
    await expect
      .poll(() => field(signIn, "current-password")!.error)
      .toBe(codeMessage("password.invalid"));
    await el.updateComplete;
    expect(bottom(el)).toBe(t("form.fix_fields"));
    expect(button(el, "make-pack")!.disabled).toBe(false);
  });

  it("shows the box's own recovery.pack_invalid as a refusal in words, not as a lost answer", async () => {
    const api = stubApi();
    api.makeRecoveryPack.mockRejectedValue({
      code: "recovery.pack_invalid",
      params: { reason: "shape" },
      status: 400,
    });
    const { el, signIn } = await open({ api });
    type(signIn, "current-password", "hunter2-hunter2");
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
      "The current server key is on recovery pack {number}, made on {date}, which never reached a browser. If you do not have pack {number}, make a new pack with {option} ticked.",
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
