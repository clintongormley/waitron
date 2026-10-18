import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial, venue } from "../test/first-setup-browser.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";

import {
  q,
  click,
  missingDatabaseFixture,
  recoverMissing,
} from "../test/missing-database-browser.js";

afterEach(async () => {
  cleanupWidgets();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
});
it.each([false, true])(
  "keeps a missing database on repair after password recovery (same tab %s)",
  async (sameTab) => {
    const { app, requests } = await missingDatabaseFixture({ sameTab });
    await recoverMissing(app);
    expect(q(app, "screen-cert")).toBeNull();
    expect(q(app, "screen-first-owner")).not.toBeNull();
    expect(q(app, "missing-database")).not.toBeNull();
    expect(q<WtButton>(app, "start-again")?.disabled).toBe(false);
    expect(requests.some((r) => /\/(resume|claim|provision|start-again)$/.test(r.path))).toBe(
      false,
    );
    expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain(venue.admin.password);
  },
);

it("retires only after password recovery, confirmation and a fresh owner-bound missing inspection", async () => {
  const { app, requests } = await missingDatabaseFixture();
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
  await recoverMissing(app);
  await click(app, "start-again");
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  expect(q<WtButton>(app, "confirm-start-again")!.disabled).toBe(true);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => app.shadowRoot!.textContent).toContain("The old attempt is retained.");
  const sent = requests.find((r) => r.path.endsWith("/start-again"))!;
  expect(sent.body).toEqual({ inspectionId: "b".repeat(64), revision: 2, ownerGeneration: 2 });
  expect(sent.headers.get("X-Waitron-Setup-Owner")).toBe("B".repeat(43));
  expect(sent.headers.get("X-Waitron-Setup-Attempt")).toBe(initial.attemptId);
  expect(sent.headers.get("X-Waitron-Setup-Revision")).toBe("2");
  expect(sent.headers.get("X-Waitron-Setup-Generation")).toBe("2");
  expect(requests.at(-2)?.path).toBe("/setup-api/first-setup/resolution");
  expect(q(app, "start-again")).toBeNull();
  expect(requests.some((r) => /\/(claim|provision|abandon)$/.test(r.path))).toBe(false);
});

it.each(["activation-started", "committed", "publication", "complete", "uncertain"] as const)(
  "does not offer missing-database retirement for %s work",
  async (recoveredStatus) => {
    const { app, requests } = await missingDatabaseFixture({ recoveredStatus });
    await recoverMissing(app);
    expect(q(app, "screen-cert")).toBeNull();
    expect(q(app, "finish-setup")).toBeNull();
    expect(app.shadowRoot!.textContent).not.toContain("Setup is complete");
    expect(q<WtButton>(app, "start-again")?.disabled ?? true).toBe(true);
    expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  },
);

it("requires password recovery again after a refused retirement and never retries it implicitly", async () => {
  const { app, requests } = await missingDatabaseFixture({
    intercept(path) {
      if (path.endsWith("/start-again"))
        return Response.json(
          { error: { code: "setup.attempt_conflict", params: {} } },
          { status: 409 },
        );
    },
  });
  await recoverMissing(app);
  await click(app, "start-again");
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => q(app, "resume-password")).not.toBeNull();
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
  expect(q(app, "confirm-start-again")).toBeNull();
  expect(q(app, "screen-cert")).toBeNull();
  expect(requests.filter((r) => r.path.endsWith("/start-again"))).toHaveLength(1);
  expect(app.shadowRoot!.textContent).not.toContain("The old attempt is retained.");
});

it("cancels missing-database retirement without sending it or continuing the wizard", async () => {
  const { app, requests } = await missingDatabaseFixture();
  await recoverMissing(app);
  await click(app, "start-again");
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "cancel-start-again");
  expect(q(app, "confirm-start-again")).toBeNull();
  expect(q(app, "screen-cert")).toBeNull();
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  await click(app, "start-again");
  expect(q<HTMLInputElement>(app, "retire-confirmed")!.checked).toBe(false);
  expect(q<WtButton>(app, "confirm-start-again")!.disabled).toBe(true);
});

it("ignores duplicate clicks and a retirement answer after the app has left", async () => {
  let answer!: (value: Response) => void;
  const { app, api, requests } = await missingDatabaseFixture({
    intercept(path) {
      if (path.endsWith("/start-again"))
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
    },
  });
  const operation = vi.spyOn(api, "startAgainFirstSetup");
  await recoverMissing(app);
  await click(app, "start-again");
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  q(app, "confirm-start-again")!.dispatchEvent(new MouseEvent("click"));
  q(app, "confirm-start-again")!.dispatchEvent(new MouseEvent("click"));
  await expect.poll(() => answer).toBeTypeOf("function");
  expect(requests.filter((r) => r.path.endsWith("/start-again"))).toHaveLength(1);
  app.remove();
  answer(Response.json({ restarting: true }));
  await operation.mock.results[0]!.value;
  await app.updateComplete;
  expect(app.shadowRoot!.textContent).not.toContain("The old attempt is retained.");
});

it("does not restore missing-database evidence when a password inspection outlives its page", async () => {
  let answer!: (value: Response) => void;
  const { app, api, requests } = await missingDatabaseFixture({
    sameTab: true,
    intercept(path) {
      if (path.endsWith("/resolution"))
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
    },
  });
  const inspection = vi.spyOn(api, "inspectFirstSetupResolution");
  const field = app.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(
    "[data-test=resume-password]",
  )!;
  await userEvent.fill(field.shadowRoot!.querySelector("input")!, venue.admin.password);
  await click(app, "resume");
  await expect.poll(() => answer).toBeTypeOf("function");
  const parent = app.parentNode!;
  app.remove();
  parent.append(app);
  answer(
    Response.json({
      version: 2,
      inspectionId: "a".repeat(64),
      pair: "valid",
      database: "missing",
      password: "checkable",
      revision: 1,
      ownerGeneration: 1,
      emptyDatabase: false,
      repairEligible: false,
      artifacts: [],
    }),
  );
  await inspection.mock.results[0]!.value;
  await app.updateComplete;
  expect(q(app, "missing-database")).toBeNull();
  expect(q(app, "resume-password")).toBeNull();
  expect(requests.some((r) => r.path.endsWith("/recover"))).toBe(false);
});
