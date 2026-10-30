import { afterEach, describe, expect, it, vi } from "vitest";
import type { WtDialog } from "@waitron/ui";
import { DashboardApi } from "../api/client.js";
import type { MadeRecoveryPack, OwnProfile, RecoveryPackStatus } from "../api/client.js";
import { fill, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import type { FreshSignIn } from "../widgets/fresh-sign-in.js";
import type { RecoveryPackDialog } from "../widgets/recovery-pack-dialog.js";
import type { RecoveryPackCard } from "./recovery-pack-card.js";
import "./recovery-pack-card.js";

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());
afterEach(() => setLocale("en-GB"));

/** 12 October in Madrid. */
const MADE_AT = "2026-10-12T10:00:00.000Z";
const FIRST_AT = "2026-09-02T10:00:00.000Z";

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

const PARTS: NonNullable<RecoveryPackStatus["latest"]>["parts"] = [
  { part: "bucket", state: "included" },
  { part: "archives", state: "included" },
  { part: "server-key", state: "included" },
];

function latest(
  overrides: Partial<NonNullable<RecoveryPackStatus["latest"]>> = {},
): NonNullable<RecoveryPackStatus["latest"]> {
  return {
    number: 3,
    madeAt: MADE_AT,
    madeByName: "Marta Puig",
    received: true,
    parts: PARTS,
    ...overrides,
  };
}

const STATES = {
  none: status(),
  "up to date": status({
    latest: latest(),
    upToDate: true,
    keep: [{ number: 1, madeAt: FIRST_AT, until: null, why: "server_key" }],
  }),
  "out of date": status({
    latest: latest(),
    reasons: [
      { part: "bucket", kind: "key_changed", at: "2026-10-20T10:00:00.000Z" },
      { part: "archives", kind: "key_changed", at: "2026-10-20T10:00:00.000Z" },
    ],
    keep: [
      { number: 1, madeAt: FIRST_AT, until: null, why: "server_key" },
      { number: 3, madeAt: MADE_AT, until: "2026-11-19T10:00:00.000Z", why: "backup_key" },
    ],
  }),
  incomplete: status({
    latest: latest({
      parts: [
        { part: "bucket", state: "included" },
        { part: "archives", state: "failed" },
        { part: "server-key", state: "included" },
      ],
    }),
    incomplete: true,
    keep: [{ number: 3, madeAt: MADE_AT, until: null, why: "server_key" }],
  }),
  unreceived: status({
    latest: latest({ number: 4, received: false }),
    unreceived: { number: 4, madeAt: MADE_AT, holdsCurrentServerKey: true },
  }),
} satisfies Record<string, RecoveryPackStatus>;

function profile(): OwnProfile {
  return {
    displayName: "Marta",
    firstNames: "Marta",
    lastNames: "Puig",
    telephone: null,
    email: "marta@example.test",
    pendingEmail: null,
    locale: null,
    hasPassword: true,
    hasTotp: false,
    hasGoogle: false,
    passkeys: [],
  };
}

function pdf(): Blob {
  return new Blob(["%PDF-1.7 pack"], { type: "application/pdf" });
}

function stubApi(at: RecoveryPackStatus = status()) {
  return {
    getRecoveryPackStatus: vi.fn<() => Promise<RecoveryPackStatus>>().mockResolvedValue(at),
    getProfile: vi.fn().mockResolvedValue(profile()),
    recoveryPackPasskeyOptions: vi.fn(),
    makeRecoveryPack: vi
      .fn<(body: unknown) => Promise<MadeRecoveryPack>>()
      .mockResolvedValue({ pdf: pdf(), number: 4, key: "unchanged" }),
    markRecoveryPackReceived: vi.fn<(n: number) => Promise<void>>().mockResolvedValue(undefined),
  };
}

type Api = ReturnType<typeof stubApi>;

async function mount(api: Api, canManage = true) {
  const { el } = await mountWidget<RecoveryPackCard>("dashboard-recovery-pack-card", {
    api: api as unknown as DashboardApi,
    canManage,
  });
  await settle(el);
  return el;
}

async function settle(el: RecoveryPackCard): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

function words(node: Element | null | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The status line's sentences, a paragraph each, as one string. */
const line = (el: RecoveryPackCard) =>
  [...el.shadowRoot!.querySelectorAll("[data-test=pack-status] p")].map(words).join(" ");
const row = (el: RecoveryPackCard, name: string) =>
  words(el.shadowRoot!.querySelector(`[data-test=row-${name}] dd`));
const dialogOf = (el: RecoveryPackCard) =>
  el.shadowRoot!.querySelector<RecoveryPackDialog>("dashboard-recovery-pack-dialog")!;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const DAYS = {
  "en-GB": {
    made: "12 October",
    first: "2 September",
    changed: "20 October",
    until: "19 November",
  },
  "es-ES": {
    made: "12 de octubre",
    first: "2 de septiembre",
    changed: "20 de octubre",
    until: "19 de noviembre",
  },
} as const;

const option = () => t("recovery_pack_dialog.new_key");

describe.each(["en-GB", "es-ES"] as const)("the status line in %s", (locale) => {
  const day = DAYS[locale];

  it("says no pack has been made", async () => {
    setLocale(locale);
    const el = await mount(stubApi(STATES.none));
    expect(line(el)).toBe(t("recovery_pack.none"));
    expect(row(el, "last")).toBe(t("recovery_pack.last_none"));
  });

  it("says the last pack is up to date, naming who made it and when, and the pack holding the server key", async () => {
    setLocale(locale);
    const el = await mount(stubApi(STATES["up to date"]));
    expect(line(el)).toBe(
      `${fill("recovery_pack.up_to_date", { number: "3", date: day.made, name: "Marta Puig" })} ${fill(
        "recovery_pack.keep_server_key",
        { number: "1", date: day.first },
      )}`,
    );
    expect(row(el, "last")).toBe(
      fill("recovery_pack.last_value", { number: "3", date: day.made, name: "Marta Puig" }),
    );
    expect(row(el, "backup-key")).toBe(
      fill("recovery_pack.backup_key_same", { number: "3", date: day.made }),
    );
    expect(row(el, "server-key")).toBe(
      fill("recovery_pack.server_key_on", { number: "1", date: day.first }),
    );
  });

  it("says the last pack is up to date without a name when its maker is gone", async () => {
    setLocale(locale);
    const el = await mount(
      stubApi(status({ latest: latest({ madeByName: null }), upToDate: true })),
    );
    expect(line(el)).toBe(
      fill("recovery_pack.up_to_date_unnamed", { number: "3", date: day.made }),
    );
  });

  it("says the last pack is out of date, why, and which packs to keep until when", async () => {
    setLocale(locale);
    const el = await mount(stubApi(STATES["out of date"]));
    expect(line(el)).toBe(
      [
        fill("recovery_pack.out_of_date", { number: "3", date: day.made }),
        fill("recovery_pack.reason.key_changed", { date: day.changed }),
        t("recovery_pack.make_new"),
        fill("recovery_pack.keep_server_key", { number: "1", date: day.first }),
        fill("recovery_pack.keep_backup_key", { number: "3", date: day.made, until: day.until }),
      ].join(" "),
    );
    expect(row(el, "backup-key")).toBe(
      fill("recovery_pack.backup_key_changed", {
        date: day.changed,
        number: "3",
        packDate: day.made,
      }),
    );
  });

  it("says the last pack is incomplete", async () => {
    setLocale(locale);
    const el = await mount(stubApi(STATES.incomplete));
    expect(line(el)).toBe(
      `${fill("recovery_pack.incomplete", { number: "3", date: day.made })} ${fill(
        "recovery_pack.keep_server_key",
        { number: "3", date: day.made },
      )}`,
    );
  });

  it("names a pack holding the server key that never reached a browser, in decision 10's words", async () => {
    setLocale(locale);
    const el = await mount(stubApi(STATES.unreceived));
    expect(line(el)).toBe(
      fill("recovery_pack_dialog.unreceived", { number: "4", date: day.made, option: option() }),
    );
    expect(row(el, "server-key")).toBe(
      fill("recovery_pack.server_key_on_unreceived", { number: "4", date: day.made }),
    );
  });

  it("names a newest pack that never reached a browser and holds no server key", async () => {
    setLocale(locale);
    const el = await mount(
      stubApi(
        status({
          latest: latest({ number: 4, received: false }),
          unreceived: { number: 4, madeAt: MADE_AT, holdsCurrentServerKey: false },
          keep: [{ number: 1, madeAt: FIRST_AT, until: null, why: "server_key" }],
        }),
      ),
    );
    expect(line(el)).toBe(
      `${fill("recovery_pack.not_received", { number: "4", date: day.made })} ${fill(
        "recovery_pack.keep_server_key",
        { number: "1", date: day.first },
      )}`,
    );
  });

  it("says the box's backups still use the older key after a failed reload", async () => {
    setLocale(locale);
    const el = await mount(stubApi(status({ ...STATES["up to date"], backupsUseOlderKey: true })));
    expect(line(el)).toContain(t("recovery_pack.older_key"));
  });
});

describe("an unreceived pack", () => {
  const unsafe = (el: RecoveryPackCard, number: string) =>
    [
      fill("recovery_pack.up_to_date", { number, date: "12 October", name: "Marta Puig" }),
      fill("recovery_pack.up_to_date_unnamed", { number, date: "12 October" }),
      fill("recovery_pack.keep_server_key", { number, date: "12 October" }),
    ]
      .filter((words) => line(el).includes(words))
      .concat(
        row(el, "server-key") ===
          fill("recovery_pack.server_key_on", { number, date: "12 October" })
          ? [row(el, "server-key")]
          : [],
      );

  it("is never called up to date nor a safe holder of the key, even if the status says so", async () => {
    const el = await mount(
      stubApi(
        status({
          latest: latest({ number: 4, received: false }),
          upToDate: true,
          unreceived: { number: 4, madeAt: MADE_AT, holdsCurrentServerKey: true },
          keep: [{ number: 4, madeAt: MADE_AT, until: null, why: "server_key" }],
        }),
      ),
    );
    expect(unsafe(el, "4")).toEqual([]);
    expect(line(el)).toContain(
      fill("recovery_pack_dialog.unreceived", {
        number: "4",
        date: "12 October",
        option: option(),
      }),
    );
  });

  it("holding the key makes a newer received pack's line no claim of up to date", async () => {
    const el = await mount(
      stubApi(
        status({
          latest: latest({ number: 4 }),
          upToDate: true,
          unreceived: { number: 3, madeAt: MADE_AT, holdsCurrentServerKey: true },
        }),
      ),
    );
    expect(unsafe(el, "4")).toEqual([]);
    expect(line(el)).toBe(
      fill("recovery_pack_dialog.unreceived", {
        number: "3",
        date: "12 October",
        option: option(),
      }),
    );
  });
});

describe("which pack holds the server key", () => {
  it("is the same pack on the card and in the dialog when the status names a kept and an unreceived holder", async () => {
    setLocale("en-GB");
    const both = status({
      latest: latest({ number: 4, received: false }),
      unreceived: { number: 4, madeAt: MADE_AT, holdsCurrentServerKey: true },
      keep: [{ number: 1, madeAt: FIRST_AT, until: null, why: "server_key" }],
    });
    const el = await mount(stubApi(both));
    const unreceived = fill("recovery_pack_dialog.unreceived", {
      number: "4",
      date: "12 October",
      option: option(),
    });
    expect(row(el, "server-key")).toBe(
      fill("recovery_pack.server_key_on_unreceived", { number: "4", date: "12 October" }),
    );
    expect(line(el)).toContain(unreceived);
    el.shadowRoot!.querySelector<HTMLElement>("wt-button[data-test=make-recovery-pack]")!.click();
    const dialog = dialogOf(el);
    await expect
      .poll(() => words(dialog.shadowRoot!.querySelector("[data-test=new-key-why]")))
      .toBe(`${unreceived} ${t("recovery_pack_dialog.new_key_effect")}`);
  });
});

describe("dates", () => {
  it.each([
    ["Pacific/Kiritimati", "2026-10-12T11:30:00.000Z", "13 October"],
    ["Pacific/Pago_Pago", "2026-10-13T09:30:00.000Z", "12 October"],
  ])("are the venue's (%s), not the browser's", async (timeZone, madeAt, day) => {
    const el = await mount(
      stubApi(status({ timeZone, latest: latest({ madeAt }), upToDate: true })),
    );
    expect(row(el, "last")).toBe(
      fill("recovery_pack.last_value", { number: "3", date: day, name: "Marta Puig" }),
    );
  });
});

describe("reading the status", () => {
  it("is passive: a read no person asked for", async () => {
    const reads: { path: string; live: string | null }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      reads.push({ path: String(input), live: new Headers(init?.headers).get("x-waitron-live") });
      return new Response(JSON.stringify(status()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const api = new DashboardApi("", fetchImpl as typeof fetch);
    const { el } = await mountWidget<RecoveryPackCard>("dashboard-recovery-pack-card", {
      api,
      canManage: true,
    });
    await settle(el);
    expect(reads).toEqual([{ path: "/api/backup/recovery-pack", live: "1" }]);
  });

  it("draws nothing and reads nothing without system.manage", async () => {
    const api = stubApi();
    const el = await mount(api, false);
    expect(el.shadowRoot!.querySelector("section")).toBeNull();
    expect(api.getRecoveryPackStatus).not.toHaveBeenCalled();
  });

  it("says when the status cannot be read, and Try again reads it once more", async () => {
    const api = stubApi(STATES["up to date"]);
    api.getRecoveryPackStatus.mockRejectedValueOnce({ code: "connection.failed" });
    const el = await mount(api);
    expect(words(el.shadowRoot!.querySelector("[data-test=pack-load-failed]"))).toBe(
      t("recovery_pack.load_failed"),
    );
    expect(el.shadowRoot!.querySelector("[data-test=pack-status]")).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("wt-button[data-test=pack-retry]")!.click();
    await settle(el);
    expect(el.shadowRoot!.querySelector("[data-test=pack-load-failed]")).toBeNull();
    expect(line(el)).toContain(
      fill("recovery_pack.up_to_date", { number: "3", date: "12 October", name: "Marta Puig" }),
    );
  });

  it("hides the last answer's rows after a read fails, and Make then hands the dialog no status", async () => {
    const api = stubApi(STATES["up to date"]);
    const el = await mount(api);
    expect(row(el, "last")).not.toBe("");
    api.getRecoveryPackStatus.mockRejectedValueOnce({ code: "connection.failed" });
    el.reload();
    await settle(el);
    expect(el.shadowRoot!.querySelector("[data-test=pack-load-failed]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("dl")).toBeNull();
    const make = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "wt-button[data-test=make-recovery-pack]",
    )!;
    expect(make.disabled).toBe(false);
    const show = vi.spyOn(dialogOf(el), "show");
    make.click();
    expect(show).toHaveBeenCalledWith(null);
  });

  it("re-reads when asked, keeping only the newest answer", async () => {
    const api = stubApi(STATES.none);
    const el = await mount(api);
    const slow = deferred<RecoveryPackStatus>();
    api.getRecoveryPackStatus.mockReturnValueOnce(slow.promise);
    api.getRecoveryPackStatus.mockResolvedValueOnce(STATES["out of date"]);
    el.reload();
    el.reload();
    await settle(el);
    slow.resolve(STATES.none);
    await settle(el);
    expect(line(el)).toContain(
      fill("recovery_pack.out_of_date", { number: "3", date: "12 October" }),
    );
  });

  it("takes the status the dialog read again, without reading it itself", async () => {
    const api = stubApi(STATES.none);
    const el = await mount(api);
    dialogOf(el).dispatchEvent(
      new CustomEvent("recovery-pack-status", {
        detail: STATES.unreceived,
        bubbles: true,
        composed: true,
      }),
    );
    await settle(el);
    expect(api.getRecoveryPackStatus).toHaveBeenCalledOnce();
    expect(line(el)).toBe(
      fill("recovery_pack_dialog.unreceived", {
        number: "4",
        date: "12 October",
        option: option(),
      }),
    );
  });
});

describe("making a pack", () => {
  async function openDialog(el: RecoveryPackCard) {
    el.shadowRoot!.querySelector<HTMLElement>("wt-button[data-test=make-recovery-pack]")!.click();
    const dialog = dialogOf(el);
    const wt = dialog.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
    await expect.poll(() => wt.open).toBe(true);
    await expect
      .poll(() => dialog.shadowRoot!.querySelector<FreshSignIn>("dashboard-fresh-sign-in")?.ways)
      .not.toBeNull();
    const signIn = dialog.shadowRoot!.querySelector<FreshSignIn>("dashboard-fresh-sign-in")!;
    signIn
      .shadowRoot!.querySelector("wt-input[name=current-password]")!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "hunter2-hunter2" } }));
    await dialog.updateComplete;
    const make = () =>
      dialog.shadowRoot!.querySelector<HTMLElement>("wt-button[data-test=make-pack]")!.click();
    const cancel = () =>
      dialog.shadowRoot!.querySelector<HTMLElement>("wt-button[data-test=cancel-pack]")!.click();
    return { dialog, wt, make, cancel };
  }

  it("hands the dialog the status it holds", async () => {
    const api = stubApi(STATES["up to date"]);
    const el = await mount(api);
    const show = vi.spyOn(dialogOf(el), "show");
    el.shadowRoot!.querySelector<HTMLElement>("wt-button[data-test=make-recovery-pack]")!.click();
    expect(show).toHaveBeenCalledWith(STATES["up to date"]);
  });

  it("offers the made pack to download and print, then re-reads the status", async () => {
    const api = stubApi(STATES.none);
    const el = await mount(api);
    api.getRecoveryPackStatus.mockResolvedValue(STATES.unreceived);
    const { make } = await openDialog(el);
    make();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=download-pack]"))
      .not.toBeNull();
    const download = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=download-pack]")!;
    const print = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=print-pack]")!;
    expect(download.href).toMatch(/^blob:/);
    expect(download.getAttribute("download")).toBe("waitron-recovery-pack-4.pdf");
    expect(download.textContent!.trim()).toBe(t("recovery_pack.download"));
    expect(print.href).toBe(download.href);
    expect(print.target).toBe("_blank");
    expect(print.textContent!.trim()).toBe(t("recovery_pack.print"));
    await expect.poll(() => api.getRecoveryPackStatus.mock.calls.length).toBeGreaterThan(1);
    await settle(el);
    expect(line(el)).toContain(
      fill("recovery_pack_dialog.unreceived", {
        number: "4",
        date: "12 October",
        option: option(),
      }),
    );
  });

  it("revokes the last pack's link on the next make, and on leaving", async () => {
    const created: string[] = [];
    const create = URL.createObjectURL.bind(URL);
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const url = create(blob as Blob);
      created.push(url);
      return url;
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const el = await mount(stubApi());
    const made = (number: number) =>
      dialogOf(el).dispatchEvent(
        new CustomEvent("recovery-pack-made", {
          detail: { pdf: pdf(), number, key: "unchanged", received: true },
          bubbles: true,
          composed: true,
        }),
      );
    made(4);
    await settle(el);
    expect(created).toHaveLength(1);
    expect(revoke).not.toHaveBeenCalled();
    made(5);
    await settle(el);
    expect(revoke).toHaveBeenCalledWith(created[0]);
    expect(el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=download-pack]")!.href).toBe(
      created[1],
    );
    el.remove();
    expect(revoke).toHaveBeenCalledWith(created[1]);
  });

  it.each([
    [
      "system.manage is taken away",
      (el: RecoveryPackCard): void => {
        el.canManage = false;
      },
    ],
    [
      "the screen hands it another api",
      (el: RecoveryPackCard): void => {
        el.api = stubApi() as unknown as DashboardApi;
      },
    ],
  ] as const)("drops the made pack's links and revokes them when %s", async (_what, change) => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const el = await mount(stubApi());
    dialogOf(el).dispatchEvent(
      new CustomEvent("recovery-pack-made", {
        detail: { pdf: pdf(), number: 4, key: "unchanged", received: true },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(el);
    const href = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=download-pack]")!.href;
    change(el);
    await settle(el);
    expect(revoke).toHaveBeenCalledWith(href);
    el.canManage = true;
    await settle(el);
    expect(el.shadowRoot!.querySelector("[data-test=download-pack]")).toBeNull();
  });

  it("re-reads the status when the dialog closes after Cancel, though the make's answer is dropped", async () => {
    const api = stubApi(STATES.none);
    const el = await mount(api);
    const answer = deferred<MadeRecoveryPack>();
    api.makeRecoveryPack.mockReturnValue(answer.promise);
    const { wt, make, cancel } = await openDialog(el);
    make();
    await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
    const reads = api.getRecoveryPackStatus.mock.calls.length;
    api.getRecoveryPackStatus.mockResolvedValue(STATES.unreceived);
    const closed = dialogClosed(wt);
    cancel();
    await closed;
    await expect.poll(() => api.getRecoveryPackStatus.mock.calls.length).toBeGreaterThan(reads);
    answer.resolve({ pdf: pdf(), number: 4, key: "replaced" });
    await settle(el);
    expect(el.shadowRoot!.querySelector("[data-test=download-pack]")).toBeNull();
    expect(line(el)).toContain(
      fill("recovery_pack_dialog.unreceived", {
        number: "4",
        date: "12 October",
        option: option(),
      }),
    );
  });

  it("reads nothing when the dialog closes on Cancel before any make was sent", async () => {
    const api = stubApi(STATES.none);
    const el = await mount(api);
    const { wt, cancel } = await openDialog(el);
    const reads = api.getRecoveryPackStatus.mock.calls.length;
    const closed = dialogClosed(wt);
    cancel();
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settle(el);
    expect(api.getRecoveryPackStatus.mock.calls.length).toBe(reads);
  });

  it("re-reads on closing a dialog that sent a make, even one the box refused", async () => {
    const api = stubApi(STATES.none);
    api.makeRecoveryPack.mockRejectedValue({ code: "password.throttled", status: 429 });
    const el = await mount(api);
    const { dialog, wt, make, cancel } = await openDialog(el);
    make();
    await expect
      .poll(
        () =>
          dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
            "wt-form-actions",
          )!.error,
      )
      .not.toBe("");
    const reads = api.getRecoveryPackStatus.mock.calls.length;
    const closed = dialogClosed(wt);
    cancel();
    await closed;
    await expect.poll(() => api.getRecoveryPackStatus.mock.calls.length).toBe(reads + 1);
  });

  it("reads the status once after a make that succeeds", async () => {
    const api = stubApi(STATES.none);
    const el = await mount(api);
    const { wt, make } = await openDialog(el);
    const reads = api.getRecoveryPackStatus.mock.calls.length;
    make();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=download-pack]"))
      .not.toBeNull();
    await expect.poll(() => wt.open).toBe(false);
    await settle(el);
    expect(api.getRecoveryPackStatus.mock.calls.length).toBe(reads + 1);
  });

  it.each([
    ["Pacific/Kiritimati", "2024-02-28T23:30:00.000Z", "29 February"],
    ["Pacific/Pago_Pago", "2024-03-01T09:30:00.000Z", "29 February"],
  ])(
    "dates the ready line from the box's own time for the pack, in the venue's zone (%s)",
    async (timeZone, madeAt, day) => {
      const api = stubApi(status({ timeZone }));
      const el = await mount(api);
      api.getRecoveryPackStatus.mockResolvedValue(
        status({
          timeZone,
          latest: latest({ number: 4, madeAt, received: true }),
          upToDate: true,
        }),
      );
      const { make } = await openDialog(el);
      make();
      await expect
        .poll(() => el.shadowRoot!.querySelector("[data-test=download-pack]"))
        .not.toBeNull();
      await expect
        .poll(() => words(el.shadowRoot!.querySelector("[data-test=pack-ready]")))
        .toBe(fill("recovery_pack.ready", { number: "4", date: day }));
    },
  );

  it.each([
    ["the make's answer", "make"],
    ["the mark-received answer", "mark"],
  ] as const)(
    "drops %s when the screen hands it another api while it is out",
    async (_what, waitOn) => {
      const api = stubApi(STATES.none);
      const el = await mount(api);
      const answer = deferred<MadeRecoveryPack>();
      const marked = deferred<void>();
      if (waitOn === "make") api.makeRecoveryPack.mockReturnValue(answer.promise);
      else api.markRecoveryPackReceived.mockReturnValue(marked.promise);
      const { wt, make } = await openDialog(el);
      make();
      if (waitOn === "make")
        await expect.poll(() => api.makeRecoveryPack.mock.calls.length).toBe(1);
      else await expect.poll(() => api.markRecoveryPackReceived.mock.calls.length).toBe(1);
      const next = stubApi(STATES.none);
      el.api = next as unknown as DashboardApi;
      await settle(el);
      answer.resolve({ pdf: pdf(), number: 4, key: "unchanged" });
      marked.resolve();
      await settle(el);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(el);
      expect(el.shadowRoot!.querySelector("[data-test=download-pack]")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=pack-ready]")).toBeNull();
      expect(wt.open).toBe(false);
      if (waitOn === "make") expect(api.markRecoveryPackReceived).not.toHaveBeenCalled();
      expect(next.markRecoveryPackReceived).not.toHaveBeenCalled();
    },
  );

  it.each(["before", "after"] as const)(
    "keeps the new api's status when the old api's status read after a lost answer arrives %s the new api's own read",
    async (order) => {
      setLocale("en-GB");
      const api = stubApi(STATES.none);
      const el = await mount(api);
      api.makeRecoveryPack.mockRejectedValue({ code: "connection.failed" });
      const oldRead = deferred<RecoveryPackStatus>();
      api.getRecoveryPackStatus.mockReturnValueOnce(oldRead.promise);
      const reads = api.getRecoveryPackStatus.mock.calls.length;
      const { make } = await openDialog(el);
      make();
      await expect.poll(() => api.getRecoveryPackStatus.mock.calls.length).toBe(reads + 1);
      const next = stubApi(STATES["up to date"]);
      const newRead = deferred<RecoveryPackStatus>();
      next.getRecoveryPackStatus.mockReturnValueOnce(newRead.promise);
      el.api = next as unknown as DashboardApi;
      await settle(el);
      await expect.poll(() => next.getRecoveryPackStatus.mock.calls.length).toBe(1);
      if (order === "before") oldRead.resolve(STATES.unreceived);
      else newRead.resolve(STATES["up to date"]);
      await settle(el);
      if (order === "before") newRead.resolve(STATES["up to date"]);
      else oldRead.resolve(STATES.unreceived);
      await settle(el);
      expect(line(el)).toBe(
        `${fill("recovery_pack.up_to_date", { number: "3", date: "12 October", name: "Marta Puig" })} ${fill(
          "recovery_pack.keep_server_key",
          { number: "1", date: "2 September" },
        )}`,
      );
    },
  );

  it.each(["before", "after"] as const)(
    "keeps its own read when a closed dialog's status read after a lost answer arrives %s it",
    async (order) => {
      const api = stubApi(STATES.none);
      const el = await mount(api);
      api.makeRecoveryPack.mockRejectedValue({ code: "connection.failed" });
      const oldRead = deferred<RecoveryPackStatus>();
      const newRead = deferred<RecoveryPackStatus>();
      api.getRecoveryPackStatus
        .mockReturnValueOnce(oldRead.promise)
        .mockReturnValueOnce(newRead.promise);
      const reads = api.getRecoveryPackStatus.mock.calls.length;
      const { make } = await openDialog(el);
      make();
      await expect.poll(() => api.getRecoveryPackStatus.mock.calls.length).toBe(reads + 1);
      dialogOf(el).dismiss();
      await expect.poll(() => api.getRecoveryPackStatus.mock.calls.length).toBe(reads + 2);
      if (order === "before") oldRead.resolve(STATES.unreceived);
      else newRead.resolve(STATES["up to date"]);
      await settle(el);
      if (order === "before") newRead.resolve(STATES["up to date"]);
      else oldRead.resolve(STATES.unreceived);
      await settle(el);
      expect(line(el)).toBe(
        `${fill("recovery_pack.up_to_date", { number: "3", date: "12 October", name: "Marta Puig" })} ${fill(
          "recovery_pack.keep_server_key",
          { number: "1", date: "2 September" },
        )}`,
      );
    },
  );

  describe("a receipt confirmation that completes late", () => {
    function watchUrls() {
      const created: string[] = [];
      const create = URL.createObjectURL.bind(URL);
      vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
        const url = create(blob as Blob);
        created.push(url);
        return url;
      });
      const revoked: string[] = [];
      const revoke = URL.revokeObjectURL.bind(URL);
      vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
        revoked.push(url);
        revoke(url);
      });
      return { created, revoked };
    }

    it.each([
      ["the card is removed", (el: RecoveryPackCard) => el.remove()],
      [
        "system.manage is taken away",
        (el: RecoveryPackCard) => {
          el.canManage = false;
        },
      ],
    ] as const)("makes no link to the pack when %s while it is out", async (_what, change) => {
      const { created, revoked } = watchUrls();
      const api = stubApi(STATES.none);
      const marked = deferred<void>();
      api.markRecoveryPackReceived.mockReturnValue(marked.promise);
      const el = await mount(api);
      const { make } = await openDialog(el);
      make();
      await expect.poll(() => api.markRecoveryPackReceived.mock.calls.length).toBe(1);
      change(el);
      await settle(el);
      marked.resolve();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(el);
      expect(created).toEqual([]);
      expect(revoked).toEqual([]);
    });

    it("never swaps a newer pack's link for an older one's", async () => {
      const api = stubApi(STATES.none);
      api.makeRecoveryPack
        .mockResolvedValueOnce({ pdf: pdf(), number: 1, key: "replaced" })
        .mockResolvedValueOnce({ pdf: pdf(), number: 2, key: "replaced" });
      const first = deferred<void>();
      const second = deferred<void>();
      api.markRecoveryPackReceived
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const el = await mount(api);
      (await openDialog(el)).make();
      await expect.poll(() => api.markRecoveryPackReceived.mock.calls.length).toBe(1);
      dialogOf(el).dismiss();
      await settle(el);
      (await openDialog(el)).make();
      await expect.poll(() => api.markRecoveryPackReceived.mock.calls.length).toBe(2);
      second.resolve();
      const download = () =>
        el
          .shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=download-pack]")
          ?.getAttribute("download") ?? null;
      await expect.poll(download).toBe("waitron-recovery-pack-2.pdf");
      first.resolve();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(el);
      expect(download()).toBe("waitron-recovery-pack-2.pdf");
      expect(words(el.shadowRoot!.querySelector("[data-test=pack-ready]"))).toContain("2");
    });
  });

  it("tells the screen when Make is pressed", async () => {
    const el = await mount(stubApi(STATES.none));
    const pressed = vi.fn();
    el.addEventListener("recovery-pack-make", pressed);
    el.shadowRoot!.querySelector<HTMLElement>("wt-button[data-test=make-recovery-pack]")!.click();
    expect(pressed).toHaveBeenCalledOnce();
  });

  it("keeps the made pack's links when the status cannot be read afterwards, saying so as a read failure", async () => {
    const api = stubApi(STATES.none);
    const el = await mount(api);
    api.getRecoveryPackStatus.mockRejectedValue({ code: "connection.failed" });
    dialogOf(el).dispatchEvent(
      new CustomEvent("recovery-pack-made", {
        detail: { pdf: pdf(), number: 4, key: "unchanged", received: true },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(el);
    expect(el.shadowRoot!.querySelector("[data-test=download-pack]")).not.toBeNull();
    expect(words(el.shadowRoot!.querySelector("[data-test=pack-load-failed]"))).toBe(
      t("recovery_pack.load_failed"),
    );
  });
});
