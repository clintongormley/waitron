import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import type { FirstSetupInspection } from "./api/first-setup-types.js";
import { setLocale } from "./i18n/t.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";
import { shellEn, shellEs } from "./i18n/strings/shell.js";
import { initial, venue, wizardApi } from "../test/first-setup-browser.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

const inspection: FirstSetupInspection = {
  version: 2,
  inspectionId: "a".repeat(64),
  pair: "valid",
  database: "no-venue-rows",
  password: "checkable",
  revision: 1,
  ownerGeneration: 1,
  repairEligible: false,
  emptyDatabase: true,
  artifacts: [],
};
afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
});
async function mount(
  options: {
    inspection?: Partial<typeof inspection>;
    intercept?: NonNullable<Parameters<typeof wizardApi>[0]>["intercept"];
  } = {},
) {
  const fixture = wizardApi({
    claimed: true,
    intercept(path, body, headers) {
      const intercepted = options.intercept?.(path, body, headers);
      if (intercepted !== undefined) return intercepted;
      if (path.endsWith("/resolution"))
        return Response.json({ ...inspection, ...options.inspection });
      if (path.endsWith("/resolution/recover"))
        return Response.json({
          state: { ...initial, revision: 2, ownerGeneration: 2 },
          capability: "B".repeat(43),
          ownerGeneration: 2,
        });
      if (path.endsWith("/resolution/start-again")) return Response.json({ restarting: true });
    },
  });
  const { el } = await mountWidget<SetupApp>("setup-app", { api: fixture.api });
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=screen-first-owner]"))
    .not.toBeNull();
  await el.updateComplete;
  return { app: el, ...fixture };
}
const q = <T extends Element>(app: SetupApp, name: string) =>
  app.shadowRoot!.querySelector<T>(`[data-test=${name}]`)!;
async function password(app: SetupApp) {
  const field = q<WtInput>(app, "resume-password");
  const input = field.shadowRoot!.querySelector("input")!;
  await userEvent.fill(input, venue.admin.password);
  await app.updateComplete;
}

it("recovers from a new tab with the original password, before offering Start again", async () => {
  const { app, requests } = await mount();
  const resume = q<WtButton>(app, "resume");
  const restart = q<WtButton>(app, "start-again");
  expect(restart).not.toBeNull();
  expect(resume.textContent).toContain("Continue with your setup password");
  expect(resume.compareDocumentPosition(restart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(app.shadowRoot!.textContent).not.toContain("original setup tab");
  await password(app);
  await userEvent.click(resume.shadowRoot!.querySelector("button")!);
  await expect.poll(() => q(app, "screen-cert")).not.toBeNull();
  const request = requests.find((r) => r.path.endsWith("/resolution/recover"))!;
  expect(request.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 1,
    ownerGeneration: 1,
    clientClaimNonce: JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).clientClaimNonce,
    password: venue.admin.password,
  });
  expect(request.headers.has("X-Waitron-Setup-Owner")).toBe(false);
  expect(requests.some((r) => /\/(claim|resume|provision)$/.test(r.path))).toBe(false);
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toEqual({
    attemptId: initial.attemptId,
    revision: 2,
    ownerGeneration: 2,
    capability: "B".repeat(43),
  });
  expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain(venue.admin.password);
});

it("sends no Start again request until it is confirmed", async () => {
  const { app, requests } = await mount();
  await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  expect(q<WtButton>(app, "confirm-start-again").disabled).toBe(true);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await userEvent.click(
    q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => requests.filter((r) => r.path.endsWith("/start-again"))).toHaveLength(1);
  expect(requests.find((r) => r.path.endsWith("/start-again"))!.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 1,
    ownerGeneration: 1,
  });
  await expect.poll(() => app.shadowRoot!.textContent).toContain("Reconnect");
  expect(q<WtButton>(app, "resume")).toBeNull();
  expect(requests.some((r) => /\/(claim|abandon|provision)$/.test(r.path))).toBe(false);
});

it("says in English that Start again deletes the attempt", () => {
  expect(initialOwnerStrings.en.startAgainHelp).toBe(
    "Deletes this attempt. This box will not use its invoice series names again.",
  );
  expect(initialOwnerStrings.en.retireConfirmed).toBe("Delete the old attempt and start again.");
  expect(initialOwnerStrings.en.restarting).toBe(
    "The old attempt is deleted. Reconnect to continue.",
  );
});

it.each(["en-GB", "es-ES"])(
  "in %s the confirmation says the attempt is deleted, and the page says so after Start again",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app, requests } = await mount();
    setLocale(locale);
    await app.updateComplete;
    await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
    await app.updateComplete;
    const section = q<HTMLElement>(app, "screen-first-owner");
    expect(section.textContent).toContain(t.startAgainHelp);
    expect(q<HTMLInputElement>(app, "retire-confirmed").closest("label")!.textContent).toBe(
      t.retireConfirmed,
    );
    expect(section.textContent).not.toContain(t.restarting);
    await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
    await app.updateComplete;
    await userEvent.click(
      q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
    );
    await expect
      .poll(() => app.shadowRoot!.querySelector('[role="status"]')?.textContent)
      .toBe(t.restarting);
    expect(app.shadowRoot!.textContent).not.toContain(t.startAgainHelp);
    expect(requests.filter((r) => r.path.endsWith("/start-again"))).toHaveLength(1);
  },
);

it.each(["missing", "occupied", "unknown", "corrupt"] as const)(
  "does not offer password-free retirement of a %s database",
  async (database) => {
    const { app, requests } = await mount({ inspection: { database, emptyDatabase: false } });
    expect(q<WtButton>(app, "start-again").disabled).toBe(true);
    expect(q<WtButton>(app, "resume").disabled).toBe(false);
    expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  },
);

it("explains an uncheckable password and sends no secret", async () => {
  const { app, requests } = await mount({
    inspection: {
      password: "uncheckable",
      revision: null,
      ownerGeneration: null,
      emptyDatabase: false,
      database: "unknown",
      pair: "invalid",
    },
  });
  expect(q(app, "resume-password")).toBeNull();
  expect(app.shadowRoot!.textContent).toContain("cannot check the original setup password");
  expect(q<WtButton>(app, "start-again").disabled).toBe(true);
  expect(requests.some((r) => r.path.endsWith("/recover"))).toBe(false);
});

it("keeps a refused recovery retryable without persisting the entered password", async () => {
  let attempts = 0;
  const { app } = await mount({
    intercept(path) {
      if (path.endsWith("/resolution/recover") && attempts++ === 0)
        return Response.json(
          { error: { code: "setup.owner_required", params: {} } },
          { status: 403 },
        );
    },
  });
  await password(app);
  await userEvent.click(q<WtButton>(app, "resume").shadowRoot!.querySelector("button")!);
  await expect
    .poll(
      () =>
        (app.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string })
          ?.error,
    )
    .toBeTruthy();
  await expect.poll(() => q<WtButton>(app, "resume")?.disabled).toBe(false);
  expect(q<WtInput>(app, "resume-password").value).toBe("");
  expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain(venue.admin.password);
  await password(app);
  await userEvent.click(q<WtButton>(app, "resume").shadowRoot!.querySelector("button")!);
  await expect.poll(() => q(app, "screen-cert")).not.toBeNull();
});

it("offers password recovery after a conflicting public ownership read", async () => {
  const { app } = await mount({
    intercept(path) {
      if (path.endsWith("/first-setup/status"))
        return Response.json({ claimed: true, conflict: true });
    },
  });
  await expect.poll(() => app.shadowRoot!.textContent).toContain("First setup was interrupted");
  expect(q<WtInput>(app, "resume-password")).not.toBeNull();
  await userEvent.click(q<WtButton>(app, "reconnect-first").shadowRoot!.querySelector("button")!);
  await expect.poll(() => q(app, "resume-password")).not.toBeNull();
  await expect.poll(() => q<WtButton>(app, "reconnect-first").disabled).toBe(false);
  await password(app);
  await userEvent.click(q<WtButton>(app, "resume").shadowRoot!.querySelector("button")!);
  await expect.poll(() => q(app, "screen-cert")).not.toBeNull();
});

it("does not collect a password when inspection fails, and retries the read on Reconnect", async () => {
  let reads = 0;
  const { app } = await mount({
    intercept(path) {
      if (path.endsWith("/resolution") && reads++ === 0)
        return Response.json({ error: { code: "setup.not_ready", params: {} } }, { status: 409 });
    },
  });
  expect(q(app, "resume-password")).toBeNull();
  await userEvent.click(q<WtButton>(app, "reconnect-first").shadowRoot!.querySelector("button")!);
  await expect.poll(() => q(app, "resume-password")).not.toBeNull();
});

it.each([
  "abandoned",
  "uncertain",
  "complete",
  "activation-started",
  "committed",
  "publication",
] as const)("keeps recovered %s work away from certificate and activation", async (status) => {
  const { app, requests } = await mount({
    intercept(path) {
      if (path.endsWith("/resolution/recover"))
        return Response.json({
          state: {
            ...initial,
            status,
            consumptionIntent: status !== "abandoned",
            revision: 2,
            ownerGeneration: 2,
          },
          capability: "B".repeat(43),
          ownerGeneration: 2,
        });
    },
  });
  await password(app);
  await userEvent.click(q<WtButton>(app, "resume").shadowRoot!.querySelector("button")!);
  await expect
    .poll(() => JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner?.ownerGeneration)
    .toBe(2);
  await app.updateComplete;
  expect(q(app, "screen-cert")).toBeNull();
  expect(q(app, "resume")).toBeNull();
  expect(app.shadowRoot!.textContent).toContain(
    status === "complete"
      ? "Setup is complete"
      : status === "abandoned"
        ? "attempt is abandoned"
        : "may have been used",
  );
  expect(requests.some((r) => /\/(claim|provision)$/.test(r.path))).toBe(false);
});

it("cancels Start again without losing the password draft or sending retirement", async () => {
  const { app, requests } = await mount();
  await password(app);
  await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await userEvent.click(
    q<WtButton>(app, "cancel-start-again").shadowRoot!.querySelector("button")!,
  );
  await app.updateComplete;
  expect(q(app, "confirm-start-again")).toBeNull();
  expect(q<WtInput>(app, "resume-password").shadowRoot!.querySelector("input")!.value).toBe(
    venue.admin.password,
  );
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
  expect(q<WtButton>(app, "confirm-start-again").disabled).toBe(true);
});

it("clears an interrupted password draft when the app is removed and put back", async () => {
  const { app } = await mount();
  await password(app);
  const parent = app.parentNode!;
  app.remove();
  parent.append(app);
  await app.updateComplete;
  expect(q(app, "resume-password")).toBeNull();
  await userEvent.click(q<WtButton>(app, "reconnect-first").shadowRoot!.querySelector("button")!);
  await expect.poll(() => q<WtInput>(app, "resume-password")?.value).toBe("");
});

it("ignores a recovered capability that arrives after the app was removed", async () => {
  let answer!: (value: Response) => void;
  const { app, api, requests } = await mount({
    intercept(path) {
      if (path.endsWith("/resolution/recover"))
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
    },
  });
  const recovery = vi.spyOn(api, "recoverFirstSetupOwner");
  await password(app);
  await userEvent.click(q<WtButton>(app, "resume").shadowRoot!.querySelector("button")!);
  await expect.poll(() => requests.some((r) => r.path.endsWith("/recover"))).toBe(true);
  app.remove();
  answer(
    Response.json({
      state: { ...initial, revision: 2, ownerGeneration: 2 },
      capability: "B".repeat(43),
      ownerGeneration: 2,
    }),
  );
  await recovery.mock.results[0]!.value;
  await app.updateComplete;
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  expect(requests.some((r) => /\/(claim|provision)$/.test(r.path))).toBe(false);
});

it("keeps retirement failures retryable and never reports them as a completed restart", async () => {
  let attempts = 0;
  const { app } = await mount({
    intercept(path) {
      if (path.endsWith("/start-again") && attempts++ === 0)
        return Response.json(
          { error: { code: "setup.attempt_conflict", params: {} } },
          { status: 409 },
        );
    },
  });
  await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await userEvent.click(
    q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
  );
  await expect
    .poll(() =>
      [
        ...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions"),
      ].some((f) => Boolean(f.error)),
    )
    .toBe(true);
  expect(app.shadowRoot!.textContent).not.toContain(initialOwnerStrings.en.restarting);
  expect(q<WtButton>(app, "confirm-start-again").disabled).toBe(false);
  await userEvent.click(
    q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => app.shadowRoot!.textContent).toContain(initialOwnerStrings.en.restarting);
});

it("does not publish a late retirement answer into a departed page", async () => {
  let answer!: (value: Response) => void;
  const { app, api, requests } = await mount({
    intercept(path) {
      if (path.endsWith("/start-again"))
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
    },
  });
  const retirement = vi.spyOn(api, "startAgainFirstSetup");
  await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  const button = q<WtButton>(app, "confirm-start-again");
  button.dispatchEvent(new MouseEvent("click"));
  button.dispatchEvent(new MouseEvent("click"));
  await expect.poll(() => requests.filter((r) => r.path.endsWith("/start-again"))).toHaveLength(1);
  app.remove();
  answer(Response.json({ restarting: true }));
  await retirement.mock.results[0]!.value;
  await app.updateComplete;
  expect(app.shadowRoot!.textContent).not.toContain(initialOwnerStrings.en.restarting);
});

it("refuses a malformed recovered identity before saving its capability", async () => {
  const { app } = await mount({
    intercept(path) {
      if (path.endsWith("/recover"))
        return Response.json({
          state: { ...initial, nodeId: "invalid" },
          capability: "B".repeat(43),
          ownerGeneration: 1,
        });
    },
  });
  await password(app);
  await userEvent.click(q<WtButton>(app, "resume").shadowRoot!.querySelector("button")!);
  await expect
    .poll(
      () =>
        (app.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string })
          ?.error,
    )
    .toBeTruthy();
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  expect(q(app, "screen-cert")).toBeNull();
});

it("reports a failed Reconnect read without restoring the old password draft", async () => {
  let reads = 0;
  const { app } = await mount({
    intercept(path) {
      if (path.endsWith("/resolution") && reads++ > 0)
        return Response.json({ error: { code: "setup.not_ready", params: {} } }, { status: 409 });
    },
  });
  await userEvent.click(q<WtButton>(app, "reconnect-first").shadowRoot!.querySelector("button")!);
  await expect
    .poll(
      () =>
        (app.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string })
          ?.error,
    )
    .toBeTruthy();
  expect(q(app, "resume-password")).toBeNull();
});

it("ignores an inspection response after Reconnect's page is removed", async () => {
  let reads = 0;
  let answer!: (value: Response) => void;
  const { app, requests } = await mount({
    intercept(path) {
      if (path.endsWith("/resolution") && reads++ > 0)
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
    },
  });
  await userEvent.click(q<WtButton>(app, "reconnect-first").shadowRoot!.querySelector("button")!);
  await expect.poll(() => requests.filter((r) => r.path.endsWith("/resolution"))).toHaveLength(2);
  const parent = app.parentNode!;
  app.remove();
  answer(Response.json(inspection));
  parent.append(app);
  await app.updateComplete;
  expect(q(app, "resume-password")).toBeNull();
});

it("keeps a failed ownership inspection on the repair page when connection Continue discovers it", async () => {
  let checks = 0;
  const { api } = wizardApi({
    intercept(path) {
      if (path.endsWith("/first-setup/status")) return Response.json({ claimed: ++checks > 1 });
      if (path.endsWith("/discovery")) return Response.json({ caDownloadAvailable: true });
      if (path.endsWith("/resolution"))
        return Response.json({ error: { code: "setup.not_ready", params: {} } }, { status: 409 });
    },
  });
  const { el: app } = await mountWidget<SetupApp>("setup-app", { api });
  await expect.poll(() => checks).toBe(1);
  q(app, "screen-connection").dispatchEvent(
    new CustomEvent("connection-continue", { bubbles: true, composed: true }),
  );
  await expect.poll(() => q(app, "screen-first-owner")).not.toBeNull();
  expect(q(app, "resume-password")).toBeNull();
  expect(q<WtButton>(app, "reconnect-first").disabled).toBe(false);
});

it.each(["en-GB", "es-ES"])(
  "opens public secure connection help separately in %s without submitting a private draft",
  async (locale) => {
    const { app, requests } = await mount();
    setLocale(locale);
    await app.updateComplete;
    await password(app);
    await app.updateComplete;
    const link = q<HTMLAnchorElement>(app, "secure-connection");
    expect(link).not.toBeNull();
    expect(link.textContent).toBe(
      initialOwnerStrings[locale.startsWith("es") ? "es" : "en"].secureConnection,
    );
    expect(link.getAttribute("href")).toBe("/setup/connection");
    expect(link.target).toBe("_blank");
    expect(link.rel.split(" ")).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    expect(q<WtInput>(app, "resume-password").shadowRoot!.querySelector("input")!.value).toBe(
      venue.admin.password,
    );
    expect(requests.some((r) => /\/(recover|start-again|provision)$/.test(r.path))).toBe(false);
  },
);

it.each(["checkable", "uncheckable"] as const)(
  "opens independent backup repair with an %s setup password and no normal restore preview",
  async (check) => {
    const { app, requests } = await mount({
      inspection: { password: check, database: "unknown", emptyDatabase: false },
      intercept(path) {
        if (path.endsWith("/backup/status"))
          return Response.json({ phase: "unstarted", proofRequired: true });
      },
    });
    const recover = q<WtButton>(app, "recover-backup");
    expect(recover).not.toBeNull();
    await userEvent.click(recover.shadowRoot!.querySelector("button")!);
    await expect.poll(() => app.shadowRoot!.querySelector("setup-first-backup")).not.toBeNull();
    expect(
      requests.some((request) => /\/(recover|restore|preview|claim|provision)$/.test(request.path)),
    ).toBe(false);
    const repair = app.shadowRoot!.querySelector<HTMLElement & { inspection: unknown }>(
      "setup-first-backup",
    )!;
    expect(repair.inspection).toEqual({
      ...inspection,
      password: check,
      database: "unknown",
      emptyDatabase: false,
    });
  },
);

const shellText = (locale: string) => (locale.startsWith("es") ? shellEs : shellEn);

it.each([
  ["setup.start_again_incomplete", "shell.first_setup.start_again_incomplete", "en-GB"],
  ["setup.start_again_incomplete", "shell.first_setup.start_again_incomplete", "es-ES"],
  ["setup.workspace_unsupported", "shell.first_setup.workspace_unsupported", "en-GB"],
  ["setup.workspace_unsupported", "shell.first_setup.workspace_unsupported", "es-ES"],
] as const)(
  "explains a refused Start again's %s (%s) on the repair page in %s",
  async (code, key, locale) => {
    const { app } = await mount({
      intercept(path) {
        if (path.endsWith("/start-again"))
          return Response.json({ error: { code, params: {} } }, { status: 409 });
      },
    });
    setLocale(locale);
    await app.updateComplete;
    await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
    await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
    await userEvent.click(
      q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
    );
    await expect
      .poll(() =>
        [
          ...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions"),
        ].map((f) => f.error),
      )
      .toContain(shellText(locale)[key]);
  },
);

it.each(["en-GB", "es-ES"])(
  "explains an unfinished Start again on the bucket restore screen in %s",
  async (locale) => {
    const { api } = wizardApi({
      intercept(path) {
        if (path === "/setup-api/restore-bucket")
          return Response.json(
            { error: { code: "setup.start_again_incomplete", params: {} } },
            { status: 409 },
          );
      },
    });
    const { el: app } = await mountWidget<SetupApp>("setup-app", { api });
    setLocale(locale);
    await app.updateComplete;
    app.shadowRoot!.querySelector("main")!.dispatchEvent(
      new CustomEvent("bucket-restore-requested", {
        detail: {
          request: { kit: "k", environment: "production", oldBoxGone: false, venueConfirmed: null },
        },
        bubbles: true,
        composed: true,
      }),
    );
    const screen = () =>
      app.shadowRoot!.querySelector<HTMLElement & { errorMessage?: string }>(
        "[data-test=screen-restore-bucket]",
      );
    await expect.poll(() => screen()?.errorMessage).toBeTypeOf("string");
    expect(screen()!.errorMessage).toBe(
      shellText(locale)["shell.first_setup.start_again_incomplete"],
    );
  },
);

const ownerHeader = "X-Waitron-Setup-Owner";
async function damagedRecord(
  options: {
    status?: "claimed" | "consumption-intent" | "abandoned";
    locale?: string;
    refuseFlagged?: number;
    inspectionFailsAfterRefusal?: boolean;
  } = {},
) {
  let generation = 1;
  let refusals = options.refuseFlagged ?? 0;
  let refused = false;
  const fixture = await mount({
    intercept(path, body, headers) {
      if (path.endsWith("/resolution/start-again") && !headers.has(ownerHeader))
        return Response.json(
          { error: { code: "setup.start_again_password_required", params: {} } },
          { status: 403 },
        );
      if (path.endsWith("/resolution/start-again") && refusals > 0) {
        refusals -= 1;
        refused = true;
        return Response.json(
          { error: { code: "setup.attempt_conflict", params: {} } },
          { status: 409 },
        );
      }
      const status = options.status ?? "claimed";
      if (path.endsWith("/first-setup/resume") && status === "abandoned")
        return Response.json(
          { error: { code: "setup.attempt_conflict", params: {} } },
          { status: 409 },
        );
      if (path.endsWith("/resolution/recover") || path.endsWith("/first-setup/resume")) {
        const sent = body as { revision: number; ownerGeneration: number; password: string };
        if (sent.password !== venue.admin.password)
          return Response.json(
            { error: { code: "setup.owner_required", params: {} } },
            { status: 403 },
          );
        if (
          path.endsWith("/resolution/recover") &&
          (sent.revision !== generation || sent.ownerGeneration !== generation)
        )
          return Response.json(
            { error: { code: "setup.attempt_conflict", params: {} } },
            { status: 409 },
          );
        generation += 1;
        return Response.json({
          state: {
            ...initial,
            status,
            consumptionIntent: status === "consumption-intent",
            revision: generation,
            ownerGeneration: generation,
          },
          capability: "B".repeat(43),
          ownerGeneration: generation,
        });
      }
      if (path.endsWith("/resolution") && refused && options.inspectionFailsAfterRefusal)
        return Response.json({ error: { code: "setup.not_ready", params: {} } }, { status: 503 });
      if (path.endsWith("/resolution"))
        return Response.json({ ...inspection, revision: generation, ownerGeneration: generation });
    },
  });
  const { app } = fixture;
  if (options.locale) {
    setLocale(options.locale);
    await app.updateComplete;
  }
  const before = app.shadowRoot!.textContent!;
  await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await userEvent.click(
    q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
  return { ...fixture, before };
}
const startAgainRequests = <R extends { path: string }>(requests: R[]) =>
  requests.filter((r) => r.path.endsWith("/resolution/start-again"));
async function unlockDamagedRecord(app: SetupApp) {
  await password(app);
  await userEvent.click(
    q<WtButton>(app, "damaged-record-continue").shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => q(app, "recovery-record-damaged")).not.toBeNull();
}

it.each(["en-GB", "es-ES"])(
  "a damaged recovery-key record asks for the administrator password, and shows no error, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const shell = shellText(locale);
    const { app, requests } = await damagedRecord({ locale });
    await app.updateComplete;
    expect(q(app, "damaged-record-password").textContent).toBe(t.damagedRecordPassword);
    expect(q<WtInput>(app, "resume-password")).not.toBeNull();
    expect(q(app, "damaged-record-continue").textContent).toContain(t.resume);
    expect(q(app, "cancel-damaged-record").textContent).toContain(t.cancel);
    expect(q(app, "confirm-start-again")).toBeNull();
    const text = app.shadowRoot!.textContent!;
    for (const message of [
      shell["shell.not_ready"],
      shell["shell.first_setup.attempt_invalid"],
      shell["shell.first_setup.owner_required"],
      t.error,
    ])
      expect(text).not.toContain(message);
    expect(
      [...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions")].map(
        (f) => f.error,
      ),
    ).toEqual([""]);
    expect(startAgainRequests(requests)).toHaveLength(1);
  },
);

it.each(["en-GB", "es-ES"])(
  "after the password, the warning is shown above what Start again deletes, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app, requests } = await damagedRecord({ locale });
    await unlockDamagedRecord(app);
    await app.updateComplete;
    const warning = q(app, "recovery-record-damaged");
    expect(warning.textContent).toBe(t.recoveryRecordDamaged);
    const help = [...app.shadowRoot!.querySelectorAll("p")].find(
      (p) => p.textContent === t.startAgainHelp,
    )!;
    expect(help).toBeDefined();
    expect(warning.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q<HTMLInputElement>(app, "retire-confirmed").checked).toBe(false);
    expect(q<HTMLInputElement>(app, "retire-confirmed").closest("label")!.textContent).toBe(
      t.retireConfirmed,
    );
    expect(q(app, "cancel-start-again")).not.toBeNull();
    expect(q<WtButton>(app, "confirm-start-again").disabled).toBe(true);
    expect(q(app, "damaged-record-password")).toBeNull();
    expect(startAgainRequests(requests)).toHaveLength(1);
  },
);

it("confirming sends the warning flag with the recovered owner", async () => {
  const { app, requests } = await damagedRecord();
  await unlockDamagedRecord(app);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await userEvent.click(
    q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(2);
  const sent = startAgainRequests(requests)[1]!;
  expect(sent.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 2,
    ownerGeneration: 2,
    recoveryRecordDamagedShown: true,
  });
  expect(sent.headers.get(ownerHeader)).toBe("B".repeat(43));
  await expect.poll(() => app.shadowRoot!.textContent).toContain(initialOwnerStrings.en.restarting);
});

it("Cancel at the password step sends nothing and offers Start again again", async () => {
  const { app, requests } = await damagedRecord();
  await password(app);
  await userEvent.click(
    q<WtButton>(app, "cancel-damaged-record").shadowRoot!.querySelector("button")!,
  );
  await app.updateComplete;
  expect(q(app, "damaged-record-password")).toBeNull();
  expect(q<WtInput>(app, "resume-password").value).toBe("");
  expect(q<WtButton>(app, "resume")).not.toBeNull();
  expect(q<WtButton>(app, "start-again").disabled).toBe(false);
  expect(q(app, "confirm-start-again")).toBeNull();
  expect(requests.some((r) => /\/(recover|resume)$/.test(r.path))).toBe(false);
  expect(startAgainRequests(requests)).toHaveLength(1);
});

it("Cancel at the warning sends nothing", async () => {
  const { app, requests } = await damagedRecord();
  await unlockDamagedRecord(app);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await userEvent.click(
    q<WtButton>(app, "cancel-start-again").shadowRoot!.querySelector("button")!,
  );
  await app.updateComplete;
  expect(q(app, "recovery-record-damaged")).toBeNull();
  expect(q(app, "confirm-start-again")).toBeNull();
  expect(q(app, "damaged-record-password")).toBeNull();
  expect(startAgainRequests(requests)).toHaveLength(1);
});

it("Cancel at the warning lands on the page as it was, and Start again from there goes straight to the warning", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await damagedRecord();
  await unlockDamagedRecord(app);
  await userEvent.click(
    q<WtButton>(app, "cancel-start-again").shadowRoot!.querySelector("button")!,
  );
  await app.updateComplete;
  expect(app.shadowRoot!.querySelector("h1")!.textContent).toBe(t.interrupted);
  expect(q<WtButton>(app, "start-again").disabled).toBe(false);
  expect(q(app, "recover-backup")).not.toBeNull();
  expect(q<WtButton>(app, "resume")).not.toBeNull();
  expect(q<WtInput>(app, "resume-password").value).toBe("");
  expect(q(app, "abandon-attempt")).toBeNull();
  expect(app.shadowRoot!.textContent).not.toContain(t.startUnavailable);

  await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
  await app.updateComplete;
  expect(q(app, "recovery-record-damaged").textContent).toBe(t.recoveryRecordDamaged);
  expect(q(app, "damaged-record-password")).toBeNull();
  expect(q<HTMLInputElement>(app, "retire-confirmed").checked).toBe(false);
  await confirmDamagedRecord(app);
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(2);
  const sent = startAgainRequests(requests)[1]!;
  expect(sent.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 2,
    ownerGeneration: 2,
    recoveryRecordDamagedShown: true,
  });
  expect(sent.headers.get(ownerHeader)).toBe("B".repeat(43));
  expect(requests.filter((r) => r.path.endsWith("/resolution/recover"))).toHaveLength(1);
  await expect.poll(() => app.shadowRoot!.textContent).toContain(t.restarting);
});

async function cancelAtWarning(options: Parameters<typeof damagedRecord>[0] = {}) {
  const fixture = await damagedRecord(options);
  await unlockDamagedRecord(fixture.app);
  await userEvent.click(
    q<WtButton>(fixture.app, "cancel-start-again").shadowRoot!.querySelector("button")!,
  );
  await fixture.app.updateComplete;
  return fixture;
}
const formErrors = (app: SetupApp) =>
  [...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions")].map(
    (f) => f.error,
  );

it.each(["claimed", "abandoned"] as const)(
  "Continue after Cancel at the warning sends recover, never resume, for a %s attempt",
  async (status) => {
    const t = initialOwnerStrings.en;
    const { app, requests } = await cancelAtWarning({ status });
    const from = requests.length;
    await password(app);
    await userEvent.click(q<WtButton>(app, "resume").shadowRoot!.querySelector("button")!);
    await expect
      .poll(() => requests.filter((r) => r.path.endsWith("/resolution/recover")))
      .toHaveLength(2);
    expect(requests.filter((r) => r.path.endsWith("/first-setup/resume"))).toHaveLength(0);
    expect(requests.slice(from, from + 2).map((r) => r.path)).toEqual([
      "/setup-api/first-setup/resolution",
      "/setup-api/first-setup/resolution/recover",
    ]);
    expect(requests[from + 1]!.body).toMatchObject({
      revision: 2,
      ownerGeneration: 2,
      password: venue.admin.password,
    });
    if (status === "claimed") await expect.poll(() => q(app, "screen-cert")).not.toBeNull();
    else {
      await expect.poll(() => app.shadowRoot!.textContent).toContain(t.retired);
      expect(app.shadowRoot!.textContent).not.toContain(
        shellEn["shell.first_setup.attempt_conflict"],
      );
    }
  },
);

it.each(["claimed", "abandoned"] as const)(
  "a wrong password there keeps Start again offered and shows the refusal, for a %s attempt",
  async (status) => {
    const t = initialOwnerStrings.en;
    const { app, requests } = await cancelAtWarning({ status });
    await userEvent.fill(
      q<WtInput>(app, "resume-password").shadowRoot!.querySelector("input")!,
      "not the password",
    );
    await app.updateComplete;
    await userEvent.click(q<WtButton>(app, "resume").shadowRoot!.querySelector("button")!);
    await expect.poll(() => formErrors(app)).toEqual([shellEn["shell.first_setup.owner_required"]]);
    expect(app.shadowRoot!.querySelector("h1")!.textContent).toBe(t.interrupted);
    expect(q<WtButton>(app, "start-again").disabled).toBe(false);
    expect(q<WtButton>(app, "resume")).not.toBeNull();
    expect(q(app, "abandon-attempt")).toBeNull();
    expect(q(app, "replace-attempt")).toBeNull();
    expect(app.shadowRoot!.textContent).not.toContain(t.retired);
    expect(requests.filter((r) => r.path.endsWith("/first-setup/resume"))).toHaveLength(0);

    await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
    await confirmDamagedRecord(app);
    await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
    expect(startAgainRequests(requests)).toHaveLength(2);
    expect(startAgainRequests(requests)[1]!.headers.has(ownerHeader)).toBe(false);
  },
);

it("Cancel at the password step reached from Start again lands on the page as it was", async () => {
  const { app, before } = await damagedRecord();
  await userEvent.click(
    q<WtButton>(app, "cancel-damaged-record").shadowRoot!.querySelector("button")!,
  );
  await app.updateComplete;
  expect(app.shadowRoot!.textContent).toBe(before);
  expect(app.shadowRoot!.querySelector("h1")!.textContent).toBe(initialOwnerStrings.en.interrupted);
  expect(q<WtButton>(app, "start-again").disabled).toBe(false);
});

it.each(["claimed", "abandoned"] as const)(
  "Cancel at the password step reached after a refused Start again lands on the page as it was, for a %s attempt",
  async (status) => {
    const t = initialOwnerStrings.en;
    const { app, requests, before } = await refusedAtWarning({ status });
    await userEvent.click(
      q<WtButton>(app, "cancel-damaged-record").shadowRoot!.querySelector("button")!,
    );
    await expect.poll(() => app.shadowRoot!.textContent).toBe(before);
    expect(app.shadowRoot!.querySelector("h1")!.textContent).toBe(t.interrupted);
    expect(q<WtButton>(app, "start-again").disabled).toBe(false);
    expect(q(app, "abandon-attempt")).toBeNull();
    expect(q(app, "replace-attempt")).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();

    await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
    await confirmDamagedRecord(app);
    await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
    expect(startAgainRequests(requests)).toHaveLength(3);
    expect(startAgainRequests(requests)[2]!.headers.has(ownerHeader)).toBe(false);
    await unlockDamagedRecord(app);
    await confirmDamagedRecord(app);
    await expect.poll(() => startAgainRequests(requests)).toHaveLength(4);
    const sent = startAgainRequests(requests)[3]!;
    expect(sent.body).toEqual({
      inspectionId: "a".repeat(64),
      revision: 3,
      ownerGeneration: 3,
      recoveryRecordDamagedShown: true,
    });
    expect(sent.headers.get(ownerHeader)).toBe("B".repeat(43));
    await expect.poll(() => app.shadowRoot!.textContent).toContain(t.restarting);
  },
);

it("the password step calls recover, never resume, for a consumption-intent attempt", async () => {
  const { app, requests } = await damagedRecord({ status: "consumption-intent" });
  await unlockDamagedRecord(app);
  expect(requests.filter((r) => r.path.endsWith("/resolution/recover"))).toHaveLength(1);
  expect(requests.filter((r) => r.path.endsWith("/first-setup/resume"))).toHaveLength(0);
});

it("a password-free Start again on a readable record is unchanged", async () => {
  const { app, requests } = await mount();
  await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await userEvent.click(
    q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => app.shadowRoot!.textContent).toContain(initialOwnerStrings.en.restarting);
  expect(q(app, "damaged-record-password")).toBeNull();
  expect(startAgainRequests(requests)).toHaveLength(1);
  expect(requests.some((r) => /\/(recover|resume)$/.test(r.path))).toBe(false);
});

async function confirmDamagedRecord(app: SetupApp) {
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await userEvent.click(
    q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
  );
}
async function refusedAtWarning(options: Parameters<typeof damagedRecord>[0] = {}) {
  const fixture = await damagedRecord({ ...options, refuseFlagged: 1 });
  await unlockDamagedRecord(fixture.app);
  await confirmDamagedRecord(fixture.app);
  await expect.poll(() => startAgainRequests(fixture.requests)).toHaveLength(2);
  await expect.poll(() => q(fixture.app, "damaged-record-password")).not.toBeNull();
  await fixture.app.updateComplete;
  return fixture;
}

it.each(["en-GB", "es-ES"])(
  "a refused Start again at the warning goes back to the password step with the reason shown, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const shell = shellText(locale);
    const { app, requests } = await refusedAtWarning({ locale });
    expect(q(app, "damaged-record-password").textContent).toBe(t.damagedRecordPassword);
    expect(q<WtInput>(app, "resume-password").value).toBe("");
    expect(q(app, "recovery-record-damaged")).toBeNull();
    expect(q(app, "retire-confirmed")).toBeNull();
    expect(q(app, "confirm-start-again")).toBeNull();
    expect(q<WtButton>(app, "start-again")?.disabled ?? true).toBe(true);
    expect(
      [...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions")].map(
        (f) => f.error,
      ),
    ).toEqual([shell["shell.first_setup.attempt_conflict"]]);
    expect(app.shadowRoot!.textContent).not.toContain(shell["shell.first_setup.owner_required"]);

    await unlockDamagedRecord(app);
    await app.updateComplete;
    expect(q(app, "recovery-record-damaged").textContent).toBe(t.recoveryRecordDamaged);
    expect(q<HTMLInputElement>(app, "retire-confirmed").checked).toBe(false);
    expect(q(app, "damaged-record-password")).toBeNull();
    await confirmDamagedRecord(app);
    await expect.poll(() => startAgainRequests(requests)).toHaveLength(3);
    const sent = startAgainRequests(requests)[2]!;
    expect(sent.body).toEqual({
      inspectionId: "a".repeat(64),
      revision: 3,
      ownerGeneration: 3,
      recoveryRecordDamagedShown: true,
    });
    expect(sent.headers.get(ownerHeader)).toBe("B".repeat(43));
    await expect.poll(() => app.shadowRoot!.textContent).toContain(t.restarting);
  },
);

it.each(["claimed", "abandoned"] as const)(
  "the warning step draws neither Abandon nor Enter new setup details, for a %s attempt",
  async (status) => {
    const t = initialOwnerStrings.en;
    const { app } = await damagedRecord({ status });
    await unlockDamagedRecord(app);
    await app.updateComplete;
    expect(q(app, "abandon-attempt")).toBeNull();
    expect(q(app, "replace-attempt")).toBeNull();
    expect(app.shadowRoot!.textContent).not.toContain(t.abandon);
    expect(app.shadowRoot!.textContent).not.toContain(t.replace);
  },
);

it.each(["claimed", "abandoned"] as const)(
  "the password step draws neither Abandon nor Enter new setup details, for a %s attempt",
  async (status) => {
    const t = initialOwnerStrings.en;
    const { app, requests } = await damagedRecord({ status, refuseFlagged: 1 });
    expect(q(app, "abandon-attempt")).toBeNull();
    expect(q(app, "replace-attempt")).toBeNull();
    await unlockDamagedRecord(app);
    await confirmDamagedRecord(app);
    await expect.poll(() => startAgainRequests(requests)).toHaveLength(2);
    await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
    await app.updateComplete;
    expect(q(app, "abandon-attempt")).toBeNull();
    expect(q(app, "replace-attempt")).toBeNull();
    expect(app.shadowRoot!.textContent).not.toContain(t.abandon);
    expect(app.shadowRoot!.textContent).not.toContain(t.replace);
  },
);

it("a refused Start again at the warning keeps its own reason when the fresh inspection fails", async () => {
  const { app, requests } = await refusedAtWarning({ inspectionFailsAfterRefusal: true });
  expect(q(app, "damaged-record-password").textContent).toBe(
    initialOwnerStrings.en.damagedRecordPassword,
  );
  expect(
    [...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions")].map(
      (f) => f.error,
    ),
  ).toEqual([shellEn["shell.first_setup.attempt_conflict"]]);
  const refusal = requests.indexOf(startAgainRequests(requests)[1]!);
  expect(
    requests.slice(refusal).filter((r) => r.path.endsWith("/first-setup/resolution")),
  ).toHaveLength(1);
});

it.each([
  { locale: "en-GB", strings: "en" },
  { locale: "es-ES", strings: "es" },
] as const)(
  "with the database present, while another device runs a recovery, draws no Start again, no Recover from backup and no password field ($locale)",
  async ({ locale, strings }) => {
    const startedAt = new Date(2026, 9, 25, 14, 35).toISOString();
    const lastActiveAt = new Date(2026, 9, 25, 14, 41).toISOString();
    const shown = {
      en: { started: "25 Oct 2026, 14:35", last: "25 Oct 2026, 14:41" },
      es: { started: "25 oct 2026, 14:35", last: "25 oct 2026, 14:41" },
    }[strings];
    const { app, requests } = await mount({
      intercept(path) {
        if (path.endsWith("/backup/activity"))
          return Response.json({ activity: { state: "running", startedAt, lastActiveAt } });
      },
    });
    setLocale(locale);
    await app.updateComplete;
    const t = initialOwnerStrings[strings];
    await expect
      .poll(() => app.shadowRoot!.querySelector("[data-test=recovery-running]"))
      .not.toBeNull();
    expect(
      [...q(app, "recovery-running").querySelectorAll("p")].map((p) => p.textContent!.trim()),
    ).toEqual([
      t.recoveryRunning.replace("{started}", shown.started),
      t.recoveryLastActive.replace("{at}", shown.last),
      t.recoveryRunningNext,
    ]);
    const shadow = app.shadowRoot!;
    expect(shadow.querySelector("[data-test=start-again]")).toBeNull();
    expect(shadow.querySelector("[data-test=recover-backup]")).toBeNull();
    expect(shadow.querySelector("[data-test=resume-password]")).toBeNull();
    expect(shadow.querySelector("[data-test=resume]")).toBeNull();
    expect(requests.some((r) => /\/(recover|start-again|summary)$/.test(r.path))).toBe(false);
  },
);
