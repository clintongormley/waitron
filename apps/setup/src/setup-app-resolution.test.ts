import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import type { FirstSetupInspection } from "./api/first-setup-types.js";
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
      if (path.endsWith("/resolution/start-again"))
        return Response.json({
          workspaceId: "new-workspace",
          selectionGeneration: 1,
          restarting: true,
        });
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

it("requires an explicit confirmation before asking to retire an empty workspace", async () => {
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
  expect(app.shadowRoot!.textContent).not.toContain("The old attempt is retained.");
  expect(q<WtButton>(app, "confirm-start-again").disabled).toBe(false);
  await userEvent.click(
    q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => app.shadowRoot!.textContent).toContain("The old attempt is retained.");
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
  expect(app.shadowRoot!.textContent).not.toContain("The old attempt is retained.");
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
