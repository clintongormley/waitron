import { afterEach, expect, it, vi } from "vitest";
import type { WtButton, WtInput } from "@waitron/ui";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { dispatchSetupGoto } from "./events.js";
import { initial, venue } from "../test/first-setup-browser.js";
import { missingDatabaseFixture, recoverMissing } from "../test/missing-database-browser.js";
import {
  q,
  click,
  enterPassword,
  selection,
  selectionFixture,
} from "../test/workspace-selection-browser.js";

afterEach(async () => {
  cleanupWidgets();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
});

it("resumes only the displayed interrupted workspace with fresh evidence and the original password", async () => {
  const { app, requests } = await selectionFixture();
  expect(q(app, "resume-password")).not.toBeNull();
  expect(q(app, "start-again")).toBeNull();
  expect(q(app, "finish-setup")).toBeNull();
  await enterPassword(app);
  await click(app, "resume");
  await expect.poll(() => app.shadowRoot!.textContent).toContain("The old attempt is retained.");
  const sent = requests.find((r) => r.path.endsWith("/resume-selection"))!;
  expect(sent.body).toEqual({ ...selection, password: venue.admin.password });
  expect(requests.at(-2)?.path).toBe("/setup-api/first-setup/resolution/selection");
  expect(requests.filter((r) => r.path.endsWith("/resume-selection"))).toHaveLength(1);
  expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).toBeNull();
  expect(requests.some((r) => /\/(recover|claim|provision|start-again|resume)$/.test(r.path))).toBe(
    false,
  );
});

it("keeps a refused password retry available without continuing to certificates", async () => {
  let tries = 0;
  const { app, requests } = await selectionFixture({
    intercept(path) {
      if (path.endsWith("/resume-selection") && tries++ === 0)
        return Response.json(
          { error: { code: "setup.owner_required", params: {} } },
          { status: 403 },
        );
    },
  });
  expect(q(app, "resume-password")).not.toBeNull();
  await enterPassword(app);
  await click(app, "resume");
  await expect.poll(() => q(app, "resume-password")).not.toBeNull();
  expect(q<WtInput>(app, "resume-password")!.value).toBe("");
  expect(q<WtButton>(app, "resume")!.disabled).toBe(false);
  expect(app.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent).toContain(
    "Password not accepted",
  );
  expect(q(app, "screen-cert")).toBeNull();
  await enterPassword(app);
  await click(app, "resume");
  await expect.poll(() => app.shadowRoot!.textContent).toContain("The old attempt is retained.");
  expect(requests.filter((r) => r.path.endsWith("/resume-selection"))).toHaveLength(2);
});

it.each([
  false,
  [],
  {},
  { ...selection, inspectionId: "bad" },
  { ...selection, revision: 0 },
  { ...selection, ownerGeneration: 1.5 },
  { ...selection, workspaceId: "../another" },
  { ...selection, selectionGeneration: -1 },
  { ...selection, password: "must not be retained" },
])("does not collect a password for malformed selection evidence %j", async (snapshot) => {
  const { app, requests } = await selectionFixture({
    intercept(path) {
      if (path.endsWith("/resolution/selection")) return Response.json(snapshot);
    },
  });
  expect(q(app, "resume-password")).toBeNull();
  expect(q(app, "screen-cert")).toBeNull();
  expect(requests.some((r) => /\/(resume-selection|recover|resume)$/.test(r.path))).toBe(false);
});

it.each([
  null,
  { ...selection, inspectionId: "b".repeat(64) },
  { ...selection, revision: 8 },
  { ...selection, ownerGeneration: 4 },
  { ...selection, workspaceId: "72cd3641-f93b-4be5-97c2-bba093bc52b4" },
  { ...selection, selectionGeneration: 3 },
])("refuses changed evidence before sending the password %j", async (snapshot) => {
  let reads = 0;
  const { app, requests } = await selectionFixture({
    intercept(path) {
      if (path.endsWith("/resolution/selection") && reads++ > 0) return Response.json(snapshot);
    },
  });
  await enterPassword(app);
  await click(app, "resume");
  await expect.poll(() => q(app, "resume-password")).not.toBeNull();
  expect(q<WtInput>(app, "resume-password")!.value).toBe("");
  expect(requests.some((r) => r.path.endsWith("/resume-selection"))).toBe(false);
  expect(app.shadowRoot!.textContent).not.toContain("The old attempt is retained.");
});

it.each([
  {},
  { restarting: false, workspaceId: selection.workspaceId, selectionGeneration: 2 },
  { restarting: true, workspaceId: "other", selectionGeneration: 2 },
  { restarting: true, workspaceId: selection.workspaceId, selectionGeneration: 3 },
])("does not show a restart for an incomplete or foreign result %j", async (result) => {
  const { app, requests } = await selectionFixture({
    intercept(path) {
      if (path.endsWith("/resume-selection")) return Response.json(result);
    },
  });
  await enterPassword(app);
  await click(app, "resume");
  await expect.poll(() => q(app, "resume-password")).not.toBeNull();
  expect(app.shadowRoot!.textContent).not.toContain("The old attempt is retained.");
  expect(requests.filter((r) => r.path.endsWith("/resume-selection"))).toHaveLength(1);
});

it("requires an entered password, prevents duplicate submission and forgets the native password", async () => {
  let answer!: (response: Response) => void;
  const { app, requests } = await selectionFixture({
    intercept(path) {
      if (path.endsWith("/resume-selection"))
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
    },
  });
  await click(app, "resume");
  expect(q<WtInput>(app, "resume-password")!.invalid).toBe(true);
  expect(q<WtButton>(app, "resume")!.disabled).toBe(true);
  expect(requests.some((r) => r.path.endsWith("/resume-selection"))).toBe(false);
  await enterPassword(app);
  const button = q<WtButton>(app, "resume")!.shadowRoot!.querySelector("button")!;
  button.click();
  button.click();
  await expect.poll(() => answer).toBeTypeOf("function");
  expect(q(app, "resume-password")).toBeNull();
  answer(
    Response.json({ workspaceId: selection.workspaceId, selectionGeneration: 2, restarting: true }),
  );
  await expect.poll(() => app.shadowRoot!.textContent).toContain("The old attempt is retained.");
  expect(requests.filter((r) => r.path.endsWith("/resume-selection"))).toHaveLength(1);
});

it.each(["inspection", "submission"] as const)(
  "ignores a late %s reply after leaving the repair page",
  async (stage) => {
    let reads = 0;
    let answer!: (response: Response) => void;
    const { app, api, requests } = await selectionFixture({
      intercept(path) {
        if (
          (stage === "inspection" && path.endsWith("/selection") && reads++ > 0) ||
          (stage === "submission" && path.endsWith("/resume-selection"))
        )
          return new Promise<Response>((resolve) => {
            answer = resolve;
          });
      },
    });
    const pending = vi.spyOn(
      api,
      stage === "inspection"
        ? "inspectFirstSetupWorkspaceSelection"
        : "resumeFirstSetupWorkspaceSelection",
    );
    await enterPassword(app);
    await click(app, "resume");
    await expect.poll(() => answer).toBeTypeOf("function");
    dispatchSetupGoto(q(app, "screen-first-owner")!, "email");
    await app.updateComplete;
    expect(q(app, "screen-email")).not.toBeNull();
    answer(
      Response.json(
        stage === "inspection"
          ? selection
          : { workspaceId: selection.workspaceId, selectionGeneration: 2, restarting: true },
      ),
    );
    await pending.mock.results.at(-1)!.value;
    await new Promise(requestAnimationFrame);
    await app.updateComplete;
    expect(q(app, "screen-email")).not.toBeNull();
    expect(requests.filter((r) => r.path.endsWith("/resume-selection"))).toHaveLength(
      stage === "inspection" ? 0 : 1,
    );
    dispatchSetupGoto(q(app, "screen-email")!, "first-owner");
    await app.updateComplete;
    expect(app.shadowRoot!.textContent).not.toContain("The old attempt is retained.");
  },
);

it("reconnects to inspect the current workspace rather than reusing a saved snapshot", async () => {
  let reads = 0;
  const { app, requests } = await selectionFixture({
    intercept(path) {
      if (path.endsWith("/selection") && reads++ > 0)
        return Response.json({ ...selection, inspectionId: "b".repeat(64), revision: 8 });
    },
  });
  await click(app, "reconnect-first");
  await expect.poll(() => reads).toBe(2);
  await expect.poll(() => q<WtButton>(app, "reconnect-first")?.disabled).toBe(false);
  await enterPassword(app);
  await click(app, "resume");
  await expect.poll(() => app.shadowRoot!.textContent).toContain("The old attempt is retained.");
  expect(requests.find((r) => r.path.endsWith("/resume-selection"))!.body).toEqual({
    ...selection,
    inspectionId: "b".repeat(64),
    revision: 8,
    password: venue.admin.password,
  });
});

it("does not reopen repair or store a late initial selection after navigation", async () => {
  let answer!: (response: Response) => void;
  const { app, api, requests, selectionRead } = await selectionFixture({
    wait: false,
    intercept(path) {
      if (path.endsWith("/selection"))
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
    },
  });
  await expect.poll(() => answer).toBeTypeOf("function");
  const status = vi.spyOn(api, "firstSetupStatus");
  dispatchSetupGoto(app.shadowRoot!.querySelector("[data-test=screen-connection]")!, "email");
  await app.updateComplete;
  answer(Response.json(selection));
  await selectionRead.mock.results[0]!.value;
  await new Promise(requestAnimationFrame);
  await app.updateComplete;
  expect(q(app, "screen-email")).not.toBeNull();
  expect(status).not.toHaveBeenCalled();
  expect(requests.some((r) => r.path.endsWith("/resolution"))).toBe(false);
  dispatchSetupGoto(q(app, "screen-email")!, "first-owner");
  await app.updateComplete;
  expect(q(app, "resume-password")).toBeNull();
});

it("checks workspace selection when continuing from secure-connection guidance", async () => {
  let statusReads = 0;
  const { app, requests } = await selectionFixture({
    wait: false,
    intercept(path) {
      if (path.endsWith("/first-setup/status") && statusReads++ === 0)
        return Response.json({ claimed: false });
    },
  });
  await expect.poll(() => q(app, "screen-mode")).not.toBeNull();
  dispatchSetupGoto(q(app, "screen-mode")!, "connection");
  await app.updateComplete;
  const connection = q<HTMLElement & { updateComplete: Promise<unknown> }>(
    app,
    "screen-connection",
  )!;
  await connection.updateComplete;
  connection.dispatchEvent(new CustomEvent("connection-continue"));
  await expect.poll(() => q(app, "resume-password")).not.toBeNull();
  await enterPassword(app);
  await click(app, "resume");
  await expect.poll(() => app.shadowRoot!.textContent).toContain("The old attempt is retained.");
  expect(requests.filter((r) => r.path.endsWith("/resume-selection"))).toHaveLength(1);
});

it("retains ordinary password repair when the resolution listener has no interrupted selection", async () => {
  const { app, requests } = await selectionFixture({
    intercept(path) {
      if (path.endsWith("/selection")) return Response.json(null);
      if (path.endsWith("/resolution"))
        return Response.json({
          version: 2,
          inspectionId: "b".repeat(64),
          pair: "valid",
          database: "no-venue-rows",
          password: "checkable",
          revision: 7,
          ownerGeneration: 3,
          repairEligible: false,
          emptyDatabase: true,
          artifacts: [],
        });
    },
  });
  expect(q(app, "resume-password")).not.toBeNull();
  expect(q(app, "start-again")).not.toBeNull();
  expect(requests.some((r) => r.path.endsWith("/resolution"))).toBe(true);
  expect(requests.some((r) => r.path.endsWith("/resume-selection"))).toBe(false);
});

it("a newly interrupted workspace supersedes a previously recovered missing-database session", async () => {
  let selecting = false;
  const { app } = await missingDatabaseFixture({
    intercept(path) {
      if (selecting && path.endsWith("/first-setup/status"))
        return Response.json({ claimed: true, resolution: true });
      if (path.endsWith("/selection")) return Response.json(selection);
    },
  });
  await recoverMissing(app);
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
  selecting = true;
  await click(app, "reconnect-first");
  await expect.poll(() => q<WtButton>(app, "reconnect-first")?.disabled).toBe(false);
  expect(q(app, "resume-password")).not.toBeNull();
  expect(q(app, "start-again")).toBeNull();
  expect(q(app, "abandon-attempt")).toBeNull();
  expect(q(app, "finish-setup")).toBeNull();
});

it("ignores a selection read from a departed connection check", async () => {
  let statusReads = 0;
  let answer!: (response: Response) => void;
  const { app, requests, selectionRead } = await selectionFixture({
    wait: false,
    intercept(path) {
      if (path.endsWith("/first-setup/status") && statusReads++ === 0)
        return Response.json({ claimed: false });
      if (path.endsWith("/selection"))
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
    },
  });
  await expect.poll(() => q(app, "screen-mode")).not.toBeNull();
  dispatchSetupGoto(q(app, "screen-mode")!, "connection");
  await app.updateComplete;
  q(app, "screen-connection")!.dispatchEvent(new CustomEvent("connection-continue"));
  await expect.poll(() => answer).toBeTypeOf("function");
  dispatchSetupGoto(q(app, "screen-connection")!, "email");
  await app.updateComplete;
  answer(Response.json(selection));
  await selectionRead.mock.results[0]!.value;
  await new Promise(requestAnimationFrame);
  await app.updateComplete;
  expect(q(app, "screen-email")).not.toBeNull();
  expect(requests.some((r) => r.path.endsWith("/resolution"))).toBe(false);
  dispatchSetupGoto(q(app, "screen-email")!, "first-owner");
  await app.updateComplete;
  expect(q(app, "resume-password")).toBeNull();
});

it("discards a resolved selection when reconnecting to an unclaimed workspace", async () => {
  let reads = 0;
  const { app, requests } = await selectionFixture({
    intercept(path) {
      if (path.endsWith("/first-setup/status") && reads++ > 0)
        return Response.json({ claimed: false });
    },
  });
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "screen-venue")).not.toBeNull();
  expect(requests.filter((r) => r.path.endsWith("/selection"))).toHaveLength(1);
  expect(requests.some((r) => r.path.endsWith("/resume-selection"))).toBe(false);
  expect(q(app, "resume-password")).toBeNull();
});

it("recovers a failed selection read only after a fresh reconnect", async () => {
  let reads = 0;
  const { app, requests } = await selectionFixture({
    intercept(path) {
      if (path.endsWith("/selection") && reads++ === 0)
        return Response.json(
          { error: { code: "setup.attempt_uncertain", params: {} } },
          { status: 409 },
        );
    },
  });
  expect(q(app, "resume-password")).toBeNull();
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "resume-password")).not.toBeNull();
  expect(requests.filter((r) => r.path.endsWith("/selection"))).toHaveLength(2);
  expect(requests.some((r) => /\/(claim|recover|resume-selection)$/.test(r.path))).toBe(false);
});
