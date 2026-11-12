import { afterEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { SetupApi } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
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
  copy: { source: "mirror-copy", identifier: "a".repeat(64), lastChangeAtMs: null },
  operation: null,
};
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
  } = {},
) {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  let recorded = options.saved ?? false;
  let activated = false;
  let rejected = false;
  let attemptedActivation = false;
  let copyChanged = false;
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
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    posts.push({ path, body });
    if (path.endsWith("/emergency/preview")) {
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
          copy: { ...preview.copy, lastChangeAtMs: copyChanged ? 1792152000000 : null },
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
  const { el, host } = await mountWidget<SetupHandoverScreen>("setup-handover-screen", {
    api,
    emergency: true,
  });
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
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
  saved.operationId = "emergency-one";
});

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
      expectedCopy: { identifier: preview.copy.identifier, lastChangeAtMs: null },
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
  expect(posts.filter(({ path }) => path.endsWith("/preview"))).toHaveLength(2);
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

it.each([
  [
    "handover.source_still_answering",
    "handover.emergency.source_answered",
    "https://main.example/manage/servers",
  ],
  ["handover.controlled_unresolved", "handover.emergency.controlled", "/handover/controlled"],
  ["handover.copy_mismatch", "handover.emergency.copy_failed", null],
  ["password.throttled", "handover.emergency.throttled", null],
  ["authorization.not_permitted", "handover.emergency.permission", null],
] as const)("offers the next step for %s", async (refusal, key, link) => {
  const { el } = await mount({ refusal });
  await edit(el, "handover-email", signIn.email);
  await edit(el, "handover-password", signIn.password);
  q(el, "[data-test=emergency-preview]").click();
  await vi.waitFor(() =>
    expect(q(el, "wt-form-actions").shadowRoot!.textContent).toContain(t(key)),
  );
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
  expect(posts.map(({ path }) => path.split("/").at(-1)).slice(0, 5)).toEqual([
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
  const { el } = await mount({ refusal: "password.invalid" });
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
    { identifier: preview.copy.identifier, lastChangeAtMs: null },
    { identifier: preview.copy.identifier, lastChangeAtMs: 1792152000000 },
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
