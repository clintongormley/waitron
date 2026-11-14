import { afterEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import type { WtFileInput } from "@waitron/ui";
import { SetupApi } from "../api/client.js";
import { format, setLocale, t } from "../i18n/t.js";
import { chooseFiles, drawnFileName } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupHandoverScreen } from "./handover-screen.js";

const signIn = { email: "owner@example.com", password: "correct horse", totp: "123456" };
const saved = {
  operationId: "emergency-one",
  reason: "The old box has failed",
  declaredAtMs: 1792147200000,
};
const preview = {
  sourceNodeId: "old",
  destinationNodeId: "new",
  sourceServersUrl: "https://main.example/manage/servers",
  copy: {
    source: "followed-copy",
    sourceId: "c".repeat(64),
    identifier: "a".repeat(64),
    lastChangeAtMs: null,
  },
  joinedAtMs: 1789819200000,
  operation: null,
};
const heldActivityMs = 1790078400000;
const status = {
  operationId: saved.operationId,
  role: "destination",
  scenario: "emergency",
  state: "emergency_declared",
  sourceNodeId: "old",
  destinationNodeId: "new",
  waitingReason: null,
};
const binding = {
  module: "fiscal-verifactu",
  action: "promote",
  eventId: saved.operationId,
  sourceId: "old",
  targetNodeId: "new",
};
const selectedInput = {
  allocation: {
    installationIdentity: "0CSQW",
    series: [
      { code: "A-0CSQW", purpose: "standard" },
      { code: "FF-0CSQW", purpose: "full" },
      { code: "R-0CSQW", purpose: "rectificative" },
    ],
  },
};
const q = <T extends HTMLElement>(el: HTMLElement, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector)!;
async function edit(el: LitElement, name: string, value: string) {
  const field = q<LitElement>(el, `[name="${name}"]`);
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input,textarea",
  )!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}
async function mount(
  options: {
    saved?: boolean;
    lostAnswer?: boolean;
    expired?: boolean;
    refusal?: string;
    activationMismatch?: boolean;
    activationExpired?: boolean;
    statusUnavailable?: boolean;
    lostBeforeWrite?: boolean;
    changeBeforeDeclare?: boolean;
    backup?: boolean;
    backupRefusal?: string;
    backupNeedsKeyCode?: string;
    theme?: "light" | "dark";
    /** The spare still holds its joining copy; takes answer these in turn, the last repeating. */
    held?: boolean;
    takes?: string[];
    /** Each take waits for this before answering. */
    takeGate?: Promise<void>;
    joinedAtMs?: null;
    /** After a refused take the old process answers one more preview before it goes down. */
    lateRestart?: boolean;
    /** The signed-in person was enrolled after joining: only a followed copy knows them. */
    unknownToHeld?: boolean;
    /** A backup chosen earlier is already placed. */
    backupPlaced?: boolean;
  } = {},
) {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  let recorded = options.saved ?? false;
  let activated = false;
  let rejected = false;
  let attemptedActivation = false;
  let copyChanged = false;
  let backupSelected = options.backupPlaced ?? false;
  let followedPlaced = !options.held;
  let restartsLeft = 0;
  let answersBeforeRestart = 0;
  let takes = 0;
  const api = new SetupApi("", async (input, init) => {
    const path = String(input);
    if (init?.method === "GET" && options.statusUnavailable)
      throw new TypeError("progress unavailable");
    if (init?.method === "GET")
      return new Response(
        JSON.stringify({
          body: {
            ...status,
            operationId: saved.operationId,
            state: activated ? "activated" : status.state,
          },
        }),
      );
    const body =
      init?.body instanceof FormData
        ? (JSON.parse(String(init.body.get("request"))) as Record<string, unknown>)
        : (JSON.parse(init!.body as string) as Record<string, unknown>);
    posts.push({ path, body });
    if (path.endsWith("/emergency/backup")) {
      expect(init!.body).toBeInstanceOf(FormData);
      expect((init!.body as FormData).get("artifact")).toBeInstanceOf(File);
      if (options.backupRefusal || body.recoveryKey === undefined) {
        const code =
          options.backupRefusal ?? options.backupNeedsKeyCode ?? "handover.backup_key_missing";
        return new Response(
          JSON.stringify({
            error: { code },
          }),
          { status: code === "recovery.passphrase_invalid" ? 422 : 409 },
        );
      }
      backupSelected = true;
      return new Response(JSON.stringify({ restarting: true }));
    }
    if (path.endsWith("/emergency/followed")) {
      // A copy already placed at the follower's position, or a chosen backup, answers taken.
      const answers = options.takes ?? ["taken"];
      const answer = answers[Math.min(takes++, answers.length - 1)]!;
      await options.takeGate;
      // The box restarts after every refusal that follows a stopped follower.
      if (answer.includes(".")) {
        if (options.lateRestart) answersBeforeRestart = 1;
        else restartsLeft = 2;
        return new Response(JSON.stringify({ error: { code: answer } }), { status: 409 });
      }
      if (answer === "restarting") restartsLeft = 2;
      if (answer === "restarting" || answer === "taken") followedPlaced = true;
      return new Response(JSON.stringify({ state: answer }));
    }
    if (path.endsWith("/emergency/preview")) {
      if (restartsLeft > 0) {
        restartsLeft -= 1;
        throw new TypeError("box restarting");
      }
      if (answersBeforeRestart > 0 && --answersBeforeRestart === 0) restartsLeft = 2;
      if (options.unknownToHeld && !followedPlaced)
        return new Response(JSON.stringify({ error: { code: "password.invalid" } }), {
          status: 401,
        });
      if (options.activationMismatch && attemptedActivation)
        return new Response(JSON.stringify({ error: { code: "handover.copy_mismatch" } }), {
          status: 409,
        });
      if (options.refusal)
        return new Response(
          JSON.stringify({
            error: {
              code: options.refusal,
              params:
                options.refusal === "handover.controlled_unresolved"
                  ? { operationId: "controlled" }
                  : options.refusal === "handover.source_still_answering"
                    ? { sourceServersUrl: preview.sourceServersUrl }
                    : {},
            },
          }),
          { status: 409 },
        );
      return new Response(
        JSON.stringify({
          ...preview,
          ...(options.joinedAtMs === null ? { joinedAtMs: null } : {}),
          copy: {
            ...(followedPlaced
              ? preview.copy
              : {
                  source: "mirror-copy",
                  identifier: "d".repeat(64),
                  lastChangeAtMs: heldActivityMs,
                }),
            ...(backupSelected ? { source: "selected-backup", sourceId: "b".repeat(64) } : {}),
            ...(followedPlaced ? { lastChangeAtMs: copyChanged ? 1792152000000 : null } : {}),
          },
          operation: recorded ? saved : null,
        }),
      );
    }
    if (path.endsWith("/emergency/declare")) {
      if (options.changeBeforeDeclare && !copyChanged) {
        copyChanged = true;
        return new Response(JSON.stringify({ error: { code: "handover.copy_mismatch" } }), {
          status: 409,
        });
      }
      if (options.expired && !rejected) {
        rejected = true;
        return new Response(JSON.stringify({ error: { code: "password.invalid" } }), {
          status: 401,
        });
      }
      if (options.lostBeforeWrite && !rejected) {
        rejected = true;
        throw new TypeError("request lost before recording");
      }
      recorded = true;
      saved.operationId = body.operationId as string;
      if (options.lostAnswer) throw new TypeError("declaration answer lost");
      return new Response(
        JSON.stringify({ declaration: { body: { binding: { operationId: saved.operationId } } } }),
      );
    }
    if (path.endsWith("/activate")) {
      attemptedActivation = true;
      if (options.activationExpired)
        return new Response(JSON.stringify({ error: { code: "password.invalid" } }), {
          status: 401,
        });
      if (options.activationMismatch)
        return new Response(JSON.stringify({ error: { code: "handover.copy_mismatch" } }), {
          status: 409,
        });
      activated = true;
      return new Response(JSON.stringify({ activated: true, restarting: true }));
    }
    if (!path.endsWith("/preparation")) throw new Error(`Unexpected request: ${path}`);
    const action = (body.proposal as { action: string }).action;
    const clock = {
      usable: ["box", "internet", "browser"].map((source) => ({
        source,
        lowerMs: Date.now(),
        upperMs: Date.now(),
      })),
      unavailable: [],
      secondClock: true,
      disagreement: false,
      releaseBlocked: false,
      rangeBlocked: false,
    };
    return new Response(
      JSON.stringify(
        action === "clock-challenge"
          ? { id: "challenge" }
          : action === "compare-clocks"
            ? { id: "comparison", clock }
            : {
                status: "selected",
                identity: "0CSQW",
                binding: { ...binding, eventId: saved.operationId },
                input: selectedInput,
              },
      ),
    );
  });
  const { el, host } = await mountWidget<SetupHandoverScreen>(
    "setup-handover-screen",
    {
      api,
      emergency: true,
    },
    options.theme,
  );
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-preview]")).not.toBeNull());
  return { el, host, posts };
}
async function authenticate(el: SetupHandoverScreen) {
  await edit(el, "handover-email", signIn.email);
  await edit(el, "handover-password", signIn.password);
  await edit(el, "handover-code", signIn.totp);
  q(el, "[data-test=emergency-preview]").click();
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
}
async function declarationFields(el: SetupHandoverScreen) {
  await edit(el, "emergency-reason", saved.reason);
  for (const field of el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    field.checked = true;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await el.updateComplete;
}
async function startVenue(el: SetupHandoverScreen) {
  const entry = q<LitElement>(el, "vf-recovery-hour");
  await entry.updateComplete;
  const tick = q<HTMLInputElement>(entry, '[name="recovery-details-confirmed"]');
  tick.checked = true;
  tick.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(q<HTMLElement & { disabled: boolean }>(entry, "[data-test=compare]").disabled).toBe(
      false,
    ),
  );
  q(entry, "[data-test=compare]").click();
}
afterEach(() => {
  vi.useRealTimers();
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
  saved.operationId = "emergency-one";
});

it("draws the backup picker's words in the chooser's language, not the browser's", async () => {
  const { el } = await mount({ backup: true });
  await authenticate(el);
  setLocale("es-ES");
  await el.updateComplete;
  const picker = q<WtFileInput>(el, 'wt-file-input[name="handover-backup"]');
  expect(picker).not.toBeNull();
  await picker.updateComplete;
  const words = picker.shadowRoot!.textContent!;
  expect(words).toContain(t("file_input.drop", "es-ES"));
  expect(words).toContain(t("file_input.choose", "es-ES"));
  expect(words).not.toContain(t("file_input.choose", "en-GB"));
});

it("writes the chosen backup's size in the chooser's language", async () => {
  setLocale("es-ES");
  const { el } = await mount({ backup: true });
  await authenticate(el);
  const picker = q<WtFileInput>(el, 'wt-file-input[name="handover-backup"]');
  chooseFiles(picker, new File([new Uint8Array(48_200)], "venue.enc"));
  await el.updateComplete;
  await picker.updateComplete;
  expect(picker.shadowRoot!.textContent!).toContain("48,2 kB");
});

it.each(
  ["en-GB", "es-ES"].flatMap((locale) =>
    ["light", "dark"].map((theme) => ({ locale, theme: theme as "light" | "dark" })),
  ),
)(
  "asks for the archive key, resumes its preview, and declares that source ($locale, $theme)",
  async ({ locale, theme }) => {
    setLocale(locale);
    const { el, posts } = await mount({
      backup: true,
      theme,
      backupNeedsKeyCode:
        theme === "dark" ? "recovery.passphrase_invalid" : "handover.backup_key_missing",
    });
    await authenticate(el);
    const input = q(el, 'wt-file-input[name="handover-backup"]');
    expect(input).not.toBeNull();
    chooseFiles(input, new File(["archive"], "venue.enc"));
    await el.updateComplete;
    q(el, "[data-test=emergency-backup]").click();
    await vi.waitFor(() => expect(q(el, '[name="handover-backup-key"]')).not.toBeNull());
    if (import.meta.env.VITE_A1188_VISUAL === "1") {
      const { page } = await import("vitest/browser");
      try {
        for (const width of [390, 1280]) {
          await page.viewport(width, 1400);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          await page.screenshot({
            path: `__screenshots__/a1188-key-${locale}-${theme}-${width}.png`,
          });
        }
      } finally {
        await page.viewport(1280, 720);
      }
    }
    await edit(el, "handover-backup-key", "synthetic-recovery-key");
    q(el, "[data-test=emergency-backup]").click();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
        t("handover.emergency.selected_backup"),
      ),
    );
    expect(posts.filter(({ path }) => path.endsWith("/backup")).map(({ body }) => body)).toEqual([
      { signIn },
      { signIn, recoveryKey: "synthetic-recovery-key" },
    ]);
    await edit(el, "emergency-reason", saved.reason);
    for (const field of el.shadowRoot!.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    )) {
      field.checked = true;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await el.updateComplete;
    q(el, "[data-test=emergency-declare]").click();
    await vi.waitFor(() => expect(posts.some(({ path }) => path.endsWith("/declare"))).toBe(true));
    expect(posts.find(({ path }) => path.endsWith("/declare"))!.body.expectedCopy).toEqual({
      ...preview.copy,
      source: "selected-backup",
      sourceId: "b".repeat(64),
    });
  },
);

it.each([
  ["handover.copy_predates_destination", "handover.emergency.backup_too_old", "en-GB"],
  ["restore.archive_resource_limit", "shell.restore.archive_resource_limit", "en-GB"],
  ["restore.archive_resource_limit", "shell.restore.archive_resource_limit", "es-ES"],
] as const)(
  "keeps the archive choice after admission is refused: %s (%s, %s)",
  async (code, key, locale) => {
    setLocale(locale);
    const { el, posts } = await mount({
      backup: true,
      backupRefusal: code,
    });
    await authenticate(el);
    const input = q(el, 'wt-file-input[name="handover-backup"]');
    expect(input).not.toBeNull();
    chooseFiles(input, new File(["archive"], "venue.enc"));
    await el.updateComplete;
    q(el, "[data-test=emergency-backup]").click();
    await vi.waitFor(() =>
      expect(q(el, "wt-form-actions").shadowRoot!.textContent).toContain(t(key)),
    );
    const picker = q<WtFileInput>(el, 'wt-file-input[name="handover-backup"]');
    expect(picker.files[0]?.name).toBe("venue.enc");
    await picker.updateComplete;
    expect(drawnFileName(picker)).toBe("venue.enc");
    expect(posts.some(({ path }) => path.endsWith("/declare"))).toBe(false);
  },
);

it.each(["en-GB", "es-ES"])(
  "requires all emergency declarations and explains the one-way choice in %s",
  async (locale) => {
    setLocale(locale);
    const { el, posts } = await mount();
    await authenticate(el);
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.one_way"));
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.split"));
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.no_date"));
    const action = q<HTMLElement & { disabled: boolean }>(el, "[data-test=emergency-declare]");
    expect(action.disabled).toBe(true);
    await edit(el, "emergency-reason", "x".repeat(501));
    expect(action.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    await vi.waitFor(() =>
      expect(q(el, "wt-form-actions").shadowRoot!.textContent).toContain(t("handover.fix")),
    );
    await edit(el, "emergency-reason", saved.reason);
    for (const field of el.shadowRoot!.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    )) {
      expect(action.shadowRoot!.querySelector("button")!.disabled).toBe(true);
      field.checked = true;
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await el.updateComplete;
    }
    expect(action.disabled).toBe(false);
    action.click();
    await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
    const declaration = posts.find(({ path }) => path.endsWith("/declare"))!;
    expect(declaration.body).toEqual({
      operationId: expect.any(String),
      expectedCopy: { ...preview.copy },
      signIn,
      statements: { sourceSwitchedOff: true, noParallelRecovery: true, missingTailAccepted: true },
      reason: saved.reason,
      locale: locale.startsWith("es") ? "es" : "en",
    });
  },
);

it("recovers a lost declaration answer through preview, without declaring it again", async () => {
  const { el, posts } = await mount({ lostAnswer: true });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  expect(posts.filter(({ path }) => path.endsWith("/declare"))).toHaveLength(1);
  expect(posts.map(({ path }) => path.split("/").at(-1)).slice(0, 5)).toEqual([
    "preview",
    "followed",
    "preview",
    "declare",
    "preview",
  ]);
  expect(location.pathname).toBe(`/handover/${saved.operationId}`);
});

it("resumes a saved declaration on another page, prepares and starts without replaying the declaration", async () => {
  const { el, posts } = await mount({ saved: true });
  await authenticate(el);
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  await startVenue(el);
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(t("handover.done")));
  expect(posts.some(({ path }) => path.endsWith("/declare"))).toBe(false);
  const preparation = posts.filter(({ path }) => path.endsWith("/preparation"));
  expect(preparation.map(({ body }) => (body.proposal as { action: string }).action)).toEqual(
    expect.arrayContaining(["clock-challenge", "compare-clocks", "select"]),
  );
  expect(posts.filter(({ path }) => path.endsWith("/activate"))).toHaveLength(1);
  for (const { body } of posts) expect(body.signIn).toEqual(signIn);
  expect(Reflect.get(el, "password")).toBe("");
  expect(Reflect.get(el, "code")).toBe("");
});

it("keeps the reason and statements when a code expires, and retries the same declaration with the new code", async () => {
  const { el, posts } = await mount({ expired: true });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() =>
    expect(q(el, "wt-form-actions").shadowRoot!.textContent).toContain(
      t("handover.emergency.code_expired"),
    ),
  );
  await edit(el, "handover-code", "654321");
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  const calls = posts.filter(({ path }) => path.endsWith("/declare"));
  expect(calls).toHaveLength(2);
  expect(calls[1]!.body).toEqual({ ...calls[0]!.body, signIn: { ...signIn, totp: "654321" } });
});

// A sign-in refusal from the held copy goes on to the take, which signs in against the newer copy.
it.each([
  [
    "handover.source_still_answering",
    "handover.emergency.source_answered",
    "https://main.example/manage/servers",
    ["preview"],
  ],
  [
    "handover.controlled_unresolved",
    "handover.emergency.controlled",
    "/handover/controlled",
    ["preview"],
  ],
  ["handover.copy_mismatch", "handover.emergency.copy_failed", null, ["preview"]],
  ["password.throttled", "handover.emergency.throttled", null, ["preview"]],
  ["authorization.not_permitted", "handover.emergency.permission", null, ["preview", "followed"]],
] as const)("offers the next step for %s", async (refusal, key, link, requests) => {
  const { el, posts } = await mount({ refusal, takes: [refusal] });
  await edit(el, "handover-email", signIn.email);
  await edit(el, "handover-password", signIn.password);
  q(el, "[data-test=emergency-preview]").click();
  await vi.waitFor(() =>
    expect(q(el, "wt-form-actions").shadowRoot!.textContent).toContain(t(key)),
  );
  expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual(requests);
  if (link)
    expect(el.shadowRoot!.querySelector<HTMLAnchorElement>(`a[href="${link}"]`)).not.toBeNull();
  expect(el.shadowRoot!.querySelector<HTMLAnchorElement>('a[href="/"]')!.textContent).toBe(
    t("handover.emergency.stop"),
  );
  expect(q(el, "[data-test=emergency-preview]").shadowRoot!.querySelector("button")!.disabled).toBe(
    false,
  );
});

it("clears saved reason and secret inputs on an account change, and clears secrets when the page closes", async () => {
  const { el } = await mount({ saved: true });
  await authenticate(el);
  expect(el.shadowRoot!.textContent).toContain(saved.reason);
  await edit(el, "handover-email", "another@example.com");
  expect(el.shadowRoot!.textContent).not.toContain(saved.reason);
  expect(q(el, '[name="handover-password"]').shadowRoot!.querySelector("input")!.value).toBe("");
  await edit(el, "handover-password", signIn.password);
  await edit(el, "handover-code", signIn.totp);
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  await el.updateComplete;
  expect(q(el, '[name="handover-password"]').shadowRoot!.querySelector("input")!.value).toBe("");
  expect(q(el, '[name="handover-code"]').shadowRoot!.querySelector("input")!.value).toBe("");
});

it("stops activation when the post-restart comparison finds a changed copy", async () => {
  const { el, posts } = await mount({ saved: true, activationMismatch: true });
  await authenticate(el);
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  await startVenue(el);
  await vi.waitFor(() =>
    expect(q(el, "wt-form-actions").shadowRoot!.textContent).toContain(
      t("handover.emergency.copy_failed"),
    ),
  );
  expect(q(el, "[data-test=retry-activation]")).toBeNull();
  expect(q(el, "[data-test=authenticate]").shadowRoot!.querySelector("button")!.disabled).toBe(
    true,
  );
  expect(posts.filter(({ path }) => path.endsWith("/preview"))).toHaveLength(2);
  expect(posts.filter(({ path }) => path.endsWith("/declare"))).toHaveLength(0);
});

it("checks an uncertain declaration before retrying the same frozen request", async () => {
  const { el, posts } = await mount({ lostBeforeWrite: true });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() =>
    expect(q(el, "wt-form-actions").shadowRoot!.textContent).toContain(
      t("handover.emergency.failed"),
    ),
  );
  expect(q(el, '[name="emergency-reason"]').shadowRoot!.querySelector("textarea")!.disabled).toBe(
    true,
  );
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  const declarations = posts.filter(({ path }) => path.endsWith("/declare"));
  expect(declarations).toHaveLength(2);
  expect(declarations[1]!.body).toEqual(declarations[0]!.body);
  expect(posts.map(({ path }) => path.split("/").at(-1)).slice(0, 7)).toEqual([
    "preview",
    "followed",
    "preview",
    "declare",
    "preview",
    "preview",
    "declare",
  ]);
});

it("leaves the declaration form after a successful write even when progress cannot load", async () => {
  const { el, posts } = await mount({ statusUnavailable: true });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(t("handover.read_failed")));
  expect(q(el, '[name="emergency-reason"]')).toBeNull();
  expect(q(el, "[data-test=emergency-declare]")).toBeNull();
  expect(posts.filter(({ path }) => path.endsWith("/declare"))).toHaveLength(1);
  expect(q(el, "wt-form-actions").shadowRoot!.querySelector("[data-error]")).toBeNull();
});

it("asks for password and code checks on the first refused sign-in, without assuming code expiry", async () => {
  const { el, posts } = await mount({ refusal: "password.invalid", takes: ["password.invalid"] });
  await edit(el, "handover-email", signIn.email);
  await edit(el, "handover-password", "mistyped");
  await edit(el, "handover-code", signIn.totp);
  q(el, "[data-test=emergency-preview]").click();
  await vi.waitFor(() =>
    expect(q(el, "wt-form-actions").shadowRoot!.textContent).toContain(
      t("handover.emergency.sign_in_failed"),
    ),
  );
  expect(q(el, "wt-form-actions").shadowRoot!.textContent).not.toContain(
    t("handover.emergency.code_expired"),
  );
  expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual(["preview", "followed"]);
  expect(posts[1]!.body).toEqual({ signIn: { ...signIn, password: "mistyped" } });
});

it("shows a fresh copy and asks for confirmation again when it changed before declaration", async () => {
  const { el, posts } = await mount({ changeBeforeDeclare: true });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() =>
    expect(q(el, "wt-form-actions").shadowRoot!.textContent).toContain(
      "The copy changed while you were reading",
    ),
  );
  expect(
    [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(
      (input) => input.checked,
    ),
  ).toEqual([false, false, false]);
  expect(q(el, '[name="emergency-reason"]').shadowRoot!.querySelector("textarea")!.disabled).toBe(
    false,
  );
  expect(q(el, "[data-test=emergency-declare]").shadowRoot!.querySelector("button")!.disabled).toBe(
    true,
  );
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  const declarations = posts.filter(({ path }) => path.endsWith("/declare"));
  expect(declarations.map(({ body }) => body.expectedCopy)).toEqual([
    { ...preview.copy, lastChangeAtMs: null },
    { ...preview.copy, lastChangeAtMs: 1792152000000 },
  ]);
});

it("explains a second code expiry after replacing only the code and pressing Try again", async () => {
  const { el, posts } = await mount({ saved: true, activationExpired: true });
  await authenticate(el);
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  await startVenue(el);
  await vi.waitFor(() =>
    expect(q(el, "wt-form-actions").shadowRoot!.textContent).toContain(
      t("handover.emergency.code_expired"),
    ),
  );
  await edit(el, "handover-code", "654321");
  q(el, "[data-test=retry-activation]").click();
  await vi.waitFor(() =>
    expect(posts.filter(({ path }) => path.endsWith("/activate"))).toHaveLength(2),
  );
  await vi.waitFor(() =>
    expect(q(el, "wt-form-actions").shadowRoot!.textContent).toContain(
      t("handover.emergency.code_expired"),
    ),
  );
  expect(posts.filter(({ path }) => path.endsWith("/preview"))).toHaveLength(1);
  expect(
    posts
      .filter(({ path }) => path.endsWith("/activate"))
      .map(({ body }) => (body.signIn as { totp: string }).totp),
  ).toEqual(["123456", "654321"]);
});

const actions = (el: SetupHandoverScreen) => q(el, "wt-form-actions").shadowRoot!.textContent!;
const followedTakes = (posts: { path: string }[]) =>
  posts.filter(({ path }) => path.endsWith("/emergency/followed")).length;
async function check(el: SetupHandoverScreen) {
  await edit(el, "handover-email", signIn.email);
  await edit(el, "handover-password", signIn.password);
  await edit(el, "handover-code", signIn.totp);
  q(el, "[data-test=emergency-preview]").click();
}

it("Check this copy first brings the copy up to date, waits for the restart, then shows it", async () => {
  const { el, posts } = await mount({ held: true, takes: ["restarting"] });
  await check(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.followed_restarting")),
  );
  await vi.waitFor(
    () =>
      expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
        t("handover.emergency.followed"),
      ),
    { timeout: 10_000 },
  );
  expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual([
    "preview",
    "followed",
    "preview",
    "preview",
    "preview",
  ]);
  expect(followedTakes(posts)).toBe(1);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(posts.some(({ path }) => path.endsWith("/declare"))).toBe(true));
  expect(posts.find(({ path }) => path.endsWith("/declare"))!.body.expectedCopy).toEqual(
    preview.copy,
  );
});

it("while the spare catches up the page waits and says so, then offers the copy this spare holds", async () => {
  const { el, posts } = await mount({ held: true, takes: ["catching-up"] });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await check(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.catching_up")),
  );
  expect(followedTakes(posts)).toBe(1);
  expect(q(el, "[data-test=emergency-held]")).toBeNull();
  expect(q(el, 'input[name="handover-backup"]')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(2000);
  expect(followedTakes(posts)).toBe(2);
  await vi.advanceTimersByTimeAsync(56_000);
  expect(q(el, "[data-test=emergency-held]")).toBeNull();
  await vi.advanceTimersByTimeAsync(2000);
  await el.updateComplete;
  expect(q(el, "[data-test=emergency-held]")).not.toBeNull();
  expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.still_catching_up"));
  expect(q<HTMLInputElement>(el, 'input[name="handover-backup"]').disabled).toBe(false);
  const taken = followedTakes(posts);
  vi.useRealTimers();
  q(el, "[data-test=emergency-held]").click();
  await vi.waitFor(() =>
    expect(q(el, "[data-test=emergency-copy]").textContent).toContain(t("handover.emergency.copy")),
  );
  await new Promise((resolve) => setTimeout(resolve, 2500));
  expect(followedTakes(posts)).toBe(taken);
  expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.catching_up"));
});

it.each([
  ["handover.copy_predates_destination", "handover.emergency.followed_not_admitted"],
  ["handover.chain_broken", "handover.emergency.followed_failed"],
  ["provisioning.database_ahead", "handover.emergency.followed_ahead"],
  ["restore.schema_too_new", "handover.emergency.followed_ahead"],
  ["handover.copy_damaged", "handover.emergency.followed_failed"],
  ["handover.copy_check_failed", "handover.emergency.followed_failed"],
] as const)(
  "a refused take (%s) names its cause and, once the box answers again, offers the copy this spare holds",
  async (code, key) => {
    const { el, posts } = await mount({ held: true, takes: [code] });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await check(el);
    await vi.waitFor(() => expect(actions(el)).toContain(t(key)));
    expect(q(el, "[data-test=emergency-held]")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.held_waiting"));
    // Reading a response body takes a real browser task, so each answer is awaited, not assumed.
    await vi.advanceTimersByTimeAsync(6000);
    await vi.waitFor(() => expect(q(el, "[data-test=emergency-held]")).not.toBeNull());
    expect(actions(el)).toContain(t(key));
    expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.held_waiting"));
    expect(q(el, 'input[name="handover-backup"]')).not.toBeNull();
    expect(q(el, "[data-test=emergency-copy]")).toBeNull();
    expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual([
      "preview",
      "followed",
      "preview",
      "preview",
      "preview",
    ]);
  },
);

it("says the held copy is from when this spare joined when the joining date is unknown", async () => {
  const { el } = await mount({ held: true, takes: ["handover.chain_broken"], joinedAtMs: null });
  await check(el);
  await vi.waitFor(() => expect(q(el, "[data-test=held-copy]")).not.toBeNull(), {
    timeout: 10_000,
  });
  expect(q(el, "[data-test=held-copy]").textContent).toContain(
    t("handover.emergency.held_undated"),
  );
});

it("from the press, waits visibly with Choose a backup open, and offers the held copy at 60 seconds even while a take is still held", async () => {
  let release!: () => void;
  const takeGate = new Promise<void>((resolve) => (release = resolve));
  const { el, posts } = await mount({ held: true, takes: ["catching-up"], takeGate });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await check(el);
  await vi.waitFor(() => expect(followedTakes(posts)).toBe(1));
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.catching_up"));
  expect(q<HTMLInputElement>(el, 'input[name="handover-backup"]').disabled).toBe(false);
  await vi.advanceTimersByTimeAsync(59_000);
  expect(q(el, "[data-test=emergency-held]")).toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  await el.updateComplete;
  expect(q(el, "[data-test=emergency-held]")).not.toBeNull();
  expect(followedTakes(posts)).toBe(1);
  release();
});

it.each(["en-GB", "es-ES"])(
  "the held-copy action says it is the copy from when this spare joined, with its date (%s)",
  async (locale) => {
    setLocale(locale);
    const { el, posts } = await mount({ held: true, takes: ["handover.chain_broken"] });
    await check(el);
    await vi.waitFor(() => expect(q(el, "[data-test=emergency-held]")).not.toBeNull(), {
      timeout: 10_000,
    });
    const joined = new Date(preview.joinedAtMs).toLocaleString(locale);
    const activity = new Date(heldActivityMs).toLocaleString(locale);
    const offer = q(el, "[data-test=held-copy]").textContent!;
    expect(offer).toContain(format("handover.emergency.held_joined", { joined }));
    expect(offer).toContain(`${t("handover.emergency.latest_activity")} ${activity}`);
    expect(q(el, "[data-test=emergency-held]").textContent).toContain(
      t("handover.emergency.use_held"),
    );
    q(el, "[data-test=emergency-held]").click();
    await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
    const copy = q(el, "[data-test=emergency-copy]").textContent!;
    expect(copy).toContain(t("handover.emergency.copy"));
    expect(copy).toContain(format("handover.emergency.held_joined", { joined }));
    expect(q(el, "[data-test=emergency-held]")).toBeNull();
    await declarationFields(el);
    q(el, "[data-test=emergency-declare]").click();
    await vi.waitFor(() => expect(posts.some(({ path }) => path.endsWith("/declare"))).toBe(true));
    expect(posts.find(({ path }) => path.endsWith("/declare"))!.body.expectedCopy).toEqual({
      source: "mirror-copy",
      identifier: "d".repeat(64),
      lastChangeAtMs: heldActivityMs,
    });
    expect(followedTakes(posts)).toBe(1);
  },
);

it("a saved declaration is resumed without taking a copy again", async () => {
  const { el, posts } = await mount({ saved: true, held: true, takes: ["restarting"] });
  await check(el);
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(saved.reason));
  expect(followedTakes(posts)).toBe(0);
});

it("the waiting line renders in Spanish", async () => {
  setLocale("es-ES");
  const waiting = t("handover.emergency.catching_up");
  expect(waiting).not.toBe(t("handover.emergency.catching_up", "en-GB"));
  const { el } = await mount({ held: true, takes: ["catching-up"] });
  await check(el);
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(waiting));
});

it("a take answering taken shows the followed copy without waiting for a restart", async () => {
  const { el, posts } = await mount({ held: true, takes: ["taken"] });
  await check(el);
  await vi.waitFor(() =>
    expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
      t("handover.emergency.followed"),
    ),
  );
  expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual([
    "preview",
    "followed",
    "preview",
  ]);
});

it("pressing the held copy while the old process is still going down waits for the restart", async () => {
  const { el, posts } = await mount({
    held: true,
    takes: ["handover.chain_broken"],
    lateRestart: true,
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await check(el);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.followed_failed")));
  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-held]")).not.toBeNull());
  q(el, "[data-test=emergency-held]").click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.held_waiting")),
  );
  expect(actions(el)).not.toContain(t("handover.emergency.failed"));
  expect(q<HTMLInputElement>(el, 'input[name="handover-backup"]').disabled).toBe(false);
  await vi.advanceTimersByTimeAsync(4000);
  await vi.waitFor(() =>
    expect(q(el, "[data-test=emergency-copy]").textContent).toContain(t("handover.emergency.copy")),
  );
  expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.held_waiting"));
  expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual([
    "preview",
    "followed",
    "preview",
    "preview",
    "preview",
    "preview",
  ]);
});

it.each(["en-GB", "es-ES"])(
  "a person only the up-to-date copy knows reaches the take and sees the copy it placed (%s)",
  async (locale) => {
    setLocale(locale);
    const { el, posts } = await mount({ held: true, unknownToHeld: true, takes: ["restarting"] });
    await check(el);
    await vi.waitFor(
      () =>
        expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
          t("handover.emergency.followed"),
        ),
      { timeout: 10_000 },
    );
    expect(followedTakes(posts)).toBe(1);
    expect(posts.find(({ path }) => path.endsWith("/followed"))!.body).toEqual({ signIn });
    expect(actions(el)).not.toContain(t("handover.emergency.sign_in_failed"));
  },
);

it("a person only the up-to-date copy knows waits for it, with no held copy to offer", async () => {
  const { el, posts } = await mount({ held: true, unknownToHeld: true, takes: ["catching-up"] });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await check(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.catching_up")),
  );
  await vi.advanceTimersByTimeAsync(62_000);
  await el.updateComplete;
  expect(followedTakes(posts)).toBeGreaterThan(1);
  expect(q(el, "[data-test=emergency-held]")).toBeNull();
  expect(q(el, "[data-test=held-copy]")).toBeNull();
  expect(actions(el)).not.toContain(t("handover.emergency.sign_in_failed"));
  expect(q<HTMLInputElement>(el, 'input[name="handover-backup"]').disabled).toBe(false);
});

it("a followed copy placed earlier goes through the take, which may find a newer one", async () => {
  const { el, posts } = await mount({ takes: ["restarting"] });
  await check(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.followed_restarting")),
  );
  await vi.waitFor(
    () =>
      expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
        t("handover.emergency.followed"),
      ),
    { timeout: 10_000 },
  );
  expect(followedTakes(posts)).toBe(1);
});

it.each(["en-GB", "es-ES"])(
  "a followed copy placed earlier is offered as the held copy when a newer take is refused, and named as held once chosen (%s)",
  async (locale) => {
    setLocale(locale);
    const { el, posts } = await mount({ takes: ["handover.chain_broken"] });
    await check(el);
    await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.followed_failed")));
    await vi.waitFor(() => expect(q(el, "[data-test=emergency-held]")).not.toBeNull(), {
      timeout: 10_000,
    });
    expect(q(el, "[data-test=emergency-copy]")).toBeNull();
    expect(q(el, "[data-test=held-copy]").textContent).toContain(t("handover.emergency.no_date"));
    q(el, "[data-test=emergency-held]").click();
    await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
    const heading = q(el, "[data-test=emergency-copy] h2").textContent!.trim();
    expect(heading).toBe(t("handover.emergency.copy"));
    expect(heading).not.toBe(t("handover.emergency.followed"));
    await declarationFields(el);
    q(el, "[data-test=emergency-declare]").click();
    await vi.waitFor(() => expect(posts.some(({ path }) => path.endsWith("/declare"))).toBe(true));
    expect(posts.find(({ path }) => path.endsWith("/declare"))!.body.expectedCopy).toEqual(
      preview.copy,
    );
    expect(followedTakes(posts)).toBe(1);
  },
);

it("a backup placed earlier is shown without a take", async () => {
  const { el, posts } = await mount({ backupPlaced: true, takes: ["restarting"] });
  await authenticate(el);
  expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
    t("handover.emergency.selected_backup"),
  );
  expect(followedTakes(posts)).toBe(0);
});

it("while a newer copy catches up, an earlier followed copy is offered as held without calling it the joining copy", async () => {
  const { el } = await mount({ takes: ["catching-up"] });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await check(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.catching_up")),
  );
  await vi.advanceTimersByTimeAsync(60_000);
  await el.updateComplete;
  expect(q(el, "[data-test=emergency-held]")).not.toBeNull();
  const offer = q(el, "[data-test=held-copy]").textContent!;
  expect(offer).not.toContain(
    format("handover.emergency.held_joined", {
      joined: new Date(preview.joinedAtMs).toLocaleString("en-GB"),
    }),
  );
  expect(offer).toContain(t("handover.emergency.no_date"));
});
