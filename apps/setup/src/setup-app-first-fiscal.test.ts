import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens, leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { venue, initial, wizardApi } from "../test/first-setup-browser.js";
const mounted: HTMLElement[] = [];
afterEach(async () => {
  mounted.splice(0).forEach((el) => el.remove());
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await new Promise((resolve) => setTimeout(resolve, 0));
});
async function mount(options: Parameters<typeof wizardApi>[0] = {}) {
  const fixture = wizardApi(options);
  const host = document.createElement("div");
  document.body.append(host);
  applyTokens(host);
  mounted.push(host);
  const app = new SetupApp();
  app.api = fixture.api;
  host.append(app);
  await app.updateComplete;
  return { app, ...fixture };
}
function emit(app: SetupApp, name: string, detail?: unknown) {
  app
    .shadowRoot!.querySelector("main")!
    .dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
async function screen(app: SetupApp, name: string) {
  await expect
    .poll(() => app.shadowRoot!.querySelector(`[data-test=screen-${name}]`))
    .not.toBeNull();
  const el = app.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    `[data-test=screen-${name}]`,
  )!;
  await el.updateComplete;
  return el;
}
async function liveVenue(app: SetupApp, mode = "live") {
  await screen(app, "mode");
  emit(app, "setup-patch", { patch: { mode, venue } });
  emit(app, "setup-goto", { screen: "venue" });
  await screen(app, "venue");
  emit(app, "setup-advance");
}

it("claims the frozen Live identity before certificate/readiness and mounts its module screen before review", async () => {
  const { app, requests } = await mount();
  await liveVenue(app);
  await screen(app, "cert");
  const claims = requests.filter((r) => r.path.endsWith("/claim"));
  expect(claims).toHaveLength(1);
  expect(claims[0]!.body).toMatchObject({ venue });
  emit(app, "setup-patch", {
    patch: {
      aeatCert: { pfxBase64: "certificate", passphrase: "certificate password", certKind: "sello" },
    },
  });
  emit(app, "setup-goto", { screen: "fiscal-test" });
  const readiness = await screen(app, "fiscal-test");
  readiness.dispatchEvent(
    new CustomEvent("fiscal-test-requested", { bubbles: true, composed: true }),
  );
  await expect.poll(() => requests.some((r) => r.path.endsWith("/fiscal-test"))).toBe(true);
  const read = requests.find((r) => r.path.endsWith("/fiscal-test"))!;
  expect(read.headers.get("X-Waitron-Setup-Attempt")).toBe(initial.attemptId);
  expect(read.body).toEqual({
    mode: "live",
    firstSetup: { attemptId: initial.attemptId, revision: 1 },
    aeatCert: { pfxBase64: "certificate", passphrase: "certificate password", certKind: "sello" },
  });
  emit(app, "setup-goto", { screen: "email" });
  await screen(app, "email");
  emit(app, "setup-goto", { screen: "review" });
  const allocation = await screen(app, "first-setup");
  expect(allocation.shadowRoot!.querySelector("vf-first-fiscal-screen")).not.toBeNull();
  expect(requests.filter((r) => r.path.endsWith("/provision"))).toEqual([]);
  expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain(venue.admin.password);
});
it.each(["demo", "prepare"])("keeps %s free of custody claims", async (mode) => {
  const { app, requests } = await mount();
  await liveVenue(app, mode);
  await screen(app, "review");
  expect(
    requests.filter((r) => r.path.endsWith("/claim") || r.path.endsWith("/offerings")),
  ).toEqual([]);
});
it("skips the owner activation flow when the host offers none", async () => {
  const { app, requests } = await mount({ offering: false });
  await liveVenue(app);
  await screen(app, "cert");
  expect(requests.filter((r) => r.path.endsWith("/offerings"))).toHaveLength(1);
  expect(requests.filter((r) => r.path.endsWith("/claim"))).toEqual([]);
});
it("keeps development Live on the disposable setup path", async () => {
  const { app, requests } = await mount({ developmentMode: true });
  await liveVenue(app);
  await screen(app, "review");
  expect(
    requests.filter((r) => r.path.endsWith("/claim") || r.path.endsWith("/offerings")),
  ).toEqual([]);
});
it("reloads into owner recovery without automatically claiming, activating or reusing the secret draft", async () => {
  const { app, requests } = await mount({ claimed: true });
  const owner = await screen(app, "first-owner");
  expect(owner.textContent).toContain("Continue with your setup password");
  expect(
    requests.filter((r) => r.path.endsWith("/claim") || r.path.endsWith("/provision")),
  ).toEqual([]);
});

it("ignores a late offering answer after navigation, before sending any claim", async () => {
  let release!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const { app, requests } = await mount({
    intercept(path) {
      if (path.endsWith("/offerings")) return pending;
    },
  });
  await liveVenue(app);
  await screen(app, "first-owner");
  emit(app, "setup-goto", { screen: "mode" });
  await screen(app, "mode");
  release(Response.json({ modules: [{ module: "fiscal-verifactu", version: "0.0.0" }] }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await app.updateComplete;
  expect(app.shadowRoot!.querySelector("[data-test=screen-mode]")).not.toBeNull();
  expect(requests.filter((r) => r.path.endsWith("/claim"))).toEqual([]);
});
it("checks saved ownership again on connection Continue", async () => {
  let checks = 0;
  const fixture = wizardApi({
    intercept(path) {
      if (path.endsWith("/first-setup/status")) return Response.json({ claimed: ++checks > 1 });
      if (path.endsWith("/discovery")) return Response.json({ caDownloadAvailable: true });
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  applyTokens(host);
  mounted.push(host);
  const app = new SetupApp();
  app.api = fixture.api;
  host.append(app);
  const connection = await screen(app, "connection");
  await new Promise((resolve) => setTimeout(resolve, 0));
  connection.dispatchEvent(
    new CustomEvent("connection-continue", { bubbles: true, composed: true }),
  );
  await screen(app, "first-owner");
  expect(
    fixture.requests.filter((r) => r.path.endsWith("/claim") || r.path.endsWith("/provision")),
  ).toEqual([]);
});

it("shows the duplicate-tab refusal without discarding the original owner's proof", async () => {
  const first = await mount();
  await liveVenue(first.app);
  await screen(first.app, "cert");
  const saved = sessionStorage.getItem(FIRST_SETUP_SESSION_KEY);
  const second = await mount({ claimed: true });
  const recovery = await screen(second.app, "first-owner");
  expect(
    (recovery.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
  ).toContain("Another setup attempt owns this venue.");
  expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).toBe(saved);
  expect(first.app.shadowRoot!.querySelector("[data-test=screen-cert]")).not.toBeNull();
  expect(second.requests.filter((request) => request.path.endsWith("/claim"))).toEqual([]);
});

it("reads back a completed activation after a lost response and offers no second activation", async () => {
  let retained = { ...initial };
  const publicRequest = {
    kind: "waitron-hour-setup",
    status: "selected",
    identity: "06TH",
    input: {
      allocation: {
        installationIdentity: "06TH",
        series: [
          { code: "A-06TH", purpose: "standard" },
          { code: "FF-06TH", purpose: "full" },
          { code: "R-06TH", purpose: "rectificative" },
        ],
      },
    },
  };
  const instant = Date.parse("2026-10-18T12:30:00Z");
  const { app, requests } = await mount({
    intercept(path, _body, headers) {
      if (path.endsWith("/preparation"))
        return Response.json({
          state: retained,
          preparation:
            (_body as { proposal: { action: string } }).proposal.action === "clock-challenge"
              ? { id: "challenge" }
              : {
                  id: "comparison",
                  clock: {
                    usable: ["box", "browser", "internet"].map((source) => ({
                      source,
                      lowerMs: instant,
                      upperMs: instant,
                    })),
                    unavailable: [],
                    disagreement: false,
                    requiresConfirmation: false,
                    boundaryWait: false,
                    releaseBlocked: false,
                    rangeBlocked: false,
                  },
                },
        });
      if (path.endsWith("/node-key"))
        return Response.json({
          stage: { stageId: "stage", nodeId: initial.nodeId, name: "Olivo key" },
          key: {
            nodeId: initial.nodeId,
            name: "Olivo key",
            secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
          },
        });
      if (path.endsWith("/recovery-document") || path.endsWith("/recovery-document-kept"))
        return Response.json({ accepted: true });
      if (path.endsWith("/reconfirm")) return Response.json({ reconfirmation: "proof" });
      if (path.endsWith("/candidates")) {
        retained = {
          ...retained,
          status: "consumption-intent",
          consumptionIntent: true,
          revision: 3,
        };
        return Response.json({ state: retained });
      }
      if (path.endsWith("/request"))
        return Response.json({
          attemptId: initial.attemptId,
          modules: [{ module: "fiscal-verifactu", request: publicRequest }],
        });
      if (path.endsWith("/input")) {
        retained = { ...retained, revision: 4 };
        return Response.json({ state: retained });
      }
      if (path.endsWith("/enrol") || path.endsWith("/current-master"))
        return Response.json({ state: retained });
      if (path.endsWith("/provision")) {
        retained = { ...retained, status: "complete", revision: 7 };
        return Promise.reject(new TypeError("lost response"));
      }
      if (path.endsWith("/first-setup/status") && headers.has("X-Waitron-Setup-Owner"))
        return Response.json({ claimed: true, state: retained });
    },
  });
  await liveVenue(app);
  await screen(app, "cert");
  emit(app, "setup-patch", {
    patch: {
      aeatCert: {
        pfxBase64: "public-test-cert",
        passphrase: "certificate password",
        certKind: "sello",
      },
    },
  });
  emit(app, "setup-goto", { screen: "review" });
  const shell = await screen(app, "first-setup");
  const module = shell.shadowRoot!.querySelector<
    HTMLElement & { updateComplete: Promise<unknown> }
  >("vf-first-fiscal-screen")!;
  await module.updateComplete;
  const click = async (el: HTMLElement, test: string) => {
    el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!.click();
    await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  };
  const field = async (el: HTMLElement, test: string, value: string) => {
    el.shadowRoot!.querySelector(`[data-test=${test}]`)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value } }),
    );
    await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  };
  const proof = async () => {
    await expect
      .poll(() => shell.shadowRoot!.querySelector("[data-test=owner-password]"))
      .not.toBeNull();
    await field(shell, "owner-password", venue.admin.password);
    await click(shell, "reconfirm");
  };
  const hour = module.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "vf-first-setup-hour",
  )!;
  await hour.updateComplete;
  await expect
    .poll(() => hour.shadowRoot!.querySelector("[data-test=clock-readings]"))
    .not.toBeNull();
  for (const selector of [
    'input[name="setup-details-confirmed"]',
    'input[name="taxpayer-hour"][value="no"]',
  ])
    await userEvent.click(hour.shadowRoot!.querySelector<HTMLInputElement>(selector)!);
  await click(hour, "select");
  await proof();
  await expect
    .poll(() => hour.shadowRoot!.querySelector("[data-test=selected-hour]"))
    .not.toBeNull();
  expect(leaveCoordinatorFor(hour)!.isDirty([shell])).toBe(true);
  await click(hour, "prepare-pdf");
  await proof();
  await expect
    .poll(() => hour.shadowRoot!.querySelector("[data-test=download-pdf]"))
    .not.toBeNull();
  await userEvent.click(
    hour.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-pdf-kept"]')!,
  );
  await click(hour, "kept");
  await proof();
  await expect
    .poll(() => shell.shadowRoot!.querySelector("[data-test=next]")?.hasAttribute("disabled"))
    .toBe(false);
  expect(
    requests.filter((r) => r.path.endsWith("/enrol") || r.path.endsWith("/current-master")),
  ).toEqual([]);
  expect(requests.filter((r) => r.path.endsWith("/recovery-document-kept"))).toHaveLength(1);
  expect(leaveCoordinatorFor(hour)!.isDirty([shell])).toBe(false);
  await click(shell, "next");
  const review = await screen(app, "review");
  await click(review, "provision");
  const owner = await screen(app, "first-owner");
  expect(requests.filter((r) => r.path.endsWith("/provision"))).toHaveLength(1);
  expect(requests.find((r) => r.path.endsWith("/provision"))!.body).toEqual({
    mode: "live",
    firstSetup: { attemptId: initial.attemptId, revision: 4 },
    aeatCert: {
      pfxBase64: "public-test-cert",
      passphrase: "certificate password",
      certKind: "sello",
    },
  });
  owner.querySelector<HTMLElement>("[data-test=reconnect-first]")!.click();
  await expect.poll(() => owner.textContent).toContain("Setup is complete.");
  expect(owner.textContent).not.toContain("resolve the incident");
  expect(owner.querySelector("[data-test=resume]")).toBeNull();
  expect(requests.filter((r) => r.path.endsWith("/provision"))).toHaveLength(1);
});

it("resumes the same frozen identity with fresh administrator proof after a reload", async () => {
  const first = await mount();
  await liveVenue(first.app);
  await screen(first.app, "cert");
  first.app.remove();
  await expect
    .poll(async () =>
      (await navigator.locks.query()).held?.some(
        (lock) => lock.name === `waitron:first-setup:attempt:${initial.attemptId}`,
      ),
    )
    .toBe(false);
  const resumed = { ...initial, revision: 2, ownerGeneration: 2 };
  const second = await mount({
    claimed: true,
    intercept(path) {
      if (path.endsWith("/resume"))
        return Response.json({ state: resumed, capability: "B".repeat(43), ownerGeneration: 2 });
    },
  });
  const owner = await screen(second.app, "first-owner");
  owner
    .querySelector("[data-test=resume-password]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: venue.admin.password } }));
  await second.app.updateComplete;
  owner.querySelector<HTMLElement>("[data-test=resume]")!.click();
  await screen(second.app, "cert");
  expect(second.requests.filter((r) => r.path.endsWith("/claim"))).toEqual([]);
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toMatchObject({
    attemptId: initial.attemptId,
    revision: 2,
    ownerGeneration: 2,
    capability: "B".repeat(43),
  });
  expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain(venue.admin.password);
});
it("shows an owner-proof refusal and keeps the resume action usable for a corrected password", async () => {
  const { app } = await mount({
    claimed: true,
    intercept(path) {
      if (path.endsWith("/resolution/recover"))
        return Response.json(
          { error: { code: "setup.owner_required", params: {} } },
          { status: 403 },
        );
    },
  });
  const owner = await screen(app, "first-owner");
  owner
    .querySelector("[data-test=resume-password]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "wrong password" } }));
  await app.updateComplete;
  owner.querySelector<HTMLElement>("[data-test=resume]")!.click();
  await expect
    .poll(
      () =>
        (owner.querySelector("wt-form-actions") as (HTMLElement & { error: string }) | null)?.error,
    )
    .toContain("Resume setup in its owner tab.");
  expect(owner.querySelector("[data-test=resume-password]")!.hasAttribute("invalid")).toBe(false);
  owner
    .querySelector("[data-test=resume-password]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "corrected password" } }));
  await app.updateComplete;
  expect(owner.querySelector("[data-test=resume]")!.hasAttribute("disabled")).toBe(false);
});
it("abandons an unconsumed attempt explicitly and collects fresh details before replacing it", async () => {
  let abandoned = false;
  const replacement = {
    ...initial,
    attemptId: "46e8d046-783d-450b-a355-a6343d33f551",
    nodeId: "8319e8c4-f671-45bf-bdd2-df3d99118c28",
    administratorId: "c3ef72ed-f19b-4f85-8eef-413843ed8475",
  };
  const { app, requests } = await mount({
    intercept(path) {
      if (path.endsWith("/abandon")) {
        abandoned = true;
        return Response.json({ state: { ...initial, status: "abandoned", revision: 2 } });
      }
      if (path.endsWith("/claim") && abandoned)
        return Response.json({
          state: replacement,
          capability: "B".repeat(43),
          ownerGeneration: 1,
        });
    },
  });
  await liveVenue(app);
  await screen(app, "cert");
  emit(app, "setup-goto", { screen: "venue" });
  const owner = await screen(app, "first-owner");
  expect(
    (owner.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
  ).toContain("frozen");
  owner.querySelector<HTMLElement>("[data-test=abandon-attempt]")!.click();
  await expect.poll(() => owner.querySelector("[data-test=replace-attempt]")).not.toBeNull();
  owner.querySelector<HTMLElement>("[data-test=replace-attempt]")!.click();
  await screen(app, "admin");
  emit(app, "setup-patch", { patch: { venue } });
  emit(app, "setup-goto", { screen: "venue" });
  await screen(app, "venue");
  emit(app, "setup-advance");
  await screen(app, "cert");
  expect(requests.filter((request) => request.path.endsWith("/claim"))).toHaveLength(2);
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner.attemptId).toBe(
    replacement.attemptId,
  );
});
it.each(["abandoned", "uncertain"])(
  "does not offer a replacement for a consumed %s attempt",
  async (status) => {
    const { app, requests } = await mount({
      intercept(path, _body, headers) {
        if (path.endsWith("/first-setup/status") && headers.has("X-Waitron-Setup-Owner"))
          return Response.json({
            claimed: true,
            state: { ...initial, status, consumptionIntent: true, revision: 3 },
          });
      },
    });
    await liveVenue(app);
    await screen(app, "cert");
    emit(app, "setup-goto", { screen: "venue" });
    const owner = await screen(app, "first-owner");
    owner.querySelector<HTMLElement>("[data-test=reconnect-first]")!.click();
    await expect.poll(() => owner.textContent).toContain("Keep it consumed");
    expect(owner.querySelector("[data-test=replace-attempt]")).toBeNull();
    expect(owner.querySelector("[data-test=resume]")).toBeNull();
    expect(requests.filter((r) => r.path.endsWith("/claim"))).toHaveLength(1);
  },
);
it("keeps the attempt when abandonment is refused", async () => {
  const { app } = await mount({
    intercept(path) {
      if (path.endsWith("/abandon"))
        return Response.json(
          { error: { code: "setup.attempt_conflict", params: {} } },
          { status: 409 },
        );
    },
  });
  await liveVenue(app);
  await screen(app, "cert");
  emit(app, "setup-goto", { screen: "venue" });
  const owner = await screen(app, "first-owner");
  owner.querySelector<HTMLElement>("[data-test=abandon-attempt]")!.click();
  await expect
    .poll(
      () =>
        (owner.querySelector("wt-form-actions") as (HTMLElement & { error: string }) | null)?.error,
    )
    .toContain("Another setup attempt");
  expect(owner.querySelector("[data-test=replace-attempt]")).toBeNull();
});
it("refuses a direct provision action while owner confirmations are incomplete", async () => {
  const { app, requests } = await mount();
  await liveVenue(app);
  await screen(app, "cert");
  emit(app, "provision-requested");
  await screen(app, "first-owner");
  expect(requests.filter((r) => r.path.endsWith("/provision"))).toEqual([]);
});

it("refuses a scope edit after claim and keeps the frozen venue details", async () => {
  const { app, requests } = await mount();
  await liveVenue(app);
  await screen(app, "cert");
  emit(app, "setup-patch", { patch: { venue: { legalName: "Another venue" } } });
  const owner = await screen(app, "first-owner");
  expect(
    (owner.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
  ).toContain("frozen");
  expect(
    (app as unknown as { draft: { venue: { legalName: string } } }).draft.venue.legalName,
  ).toBe(venue.legalName);
  expect(requests.filter((r) => r.path.endsWith("/claim"))).toHaveLength(1);
});
it("lets a new navigation begin after retiring a late offering answer", async () => {
  let release!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const { app } = await mount({
    intercept(path) {
      if (path.endsWith("/offerings") && ++reads === 1) return pending;
    },
  });
  await liveVenue(app);
  await screen(app, "first-owner");
  emit(app, "setup-goto", { screen: "mode" });
  await screen(app, "mode");
  release(Response.json({ modules: [{ module: "fiscal-verifactu", version: "0.0.0" }] }));
  await liveVenue(app);
  await screen(app, "cert");
});
it("can choose a host without an offering after explicitly abandoning an unconsumed attempt", async () => {
  let reads = 0;
  const { app, requests } = await mount({
    intercept(path) {
      if (path.endsWith("/offerings") && ++reads > 1) return Response.json({ modules: [] });
      if (path.endsWith("/abandon"))
        return Response.json({ state: { ...initial, status: "abandoned", revision: 2 } });
    },
  });
  await liveVenue(app);
  await screen(app, "cert");
  emit(app, "setup-goto", { screen: "venue" });
  const owner = await screen(app, "first-owner");
  owner.querySelector<HTMLElement>("[data-test=abandon-attempt]")!.click();
  await expect.poll(() => owner.querySelector("[data-test=replace-attempt]")).not.toBeNull();
  owner.querySelector<HTMLElement>("[data-test=replace-attempt]")!.click();
  await screen(app, "admin");
  emit(app, "setup-patch", {
    patch: { venue: { ...venue, location: { ...venue.location, fiscalTerritory: "GB-vat" } } },
  });
  emit(app, "setup-goto", { screen: "venue" });
  await screen(app, "venue");
  emit(app, "setup-advance");
  await screen(app, "email");
  emit(app, "setup-goto", { screen: "review" });
  await screen(app, "review");
  expect(requests.filter((r) => r.path.endsWith("/claim"))).toHaveLength(1);
});

it("returns to editable details only after reconnect confirms an offering failure created no claim", async () => {
  let reads = 0;
  const { app, requests } = await mount({
    intercept(path) {
      if (path.endsWith("/offerings") && ++reads === 1)
        return Promise.reject(new TypeError("network unavailable"));
    },
  });
  await liveVenue(app);
  const owner = await screen(app, "first-owner");
  await expect
    .poll(
      () =>
        (owner.querySelector("wt-form-actions") as (HTMLElement & { error: string }) | null)?.error,
    )
    .toContain("Reconnect to check");
  expect(requests.filter((r) => r.path.endsWith("/claim"))).toEqual([]);
  owner.querySelector<HTMLElement>("[data-test=reconnect-first]")!.click();
  await screen(app, "venue");
  emit(app, "setup-advance");
  await screen(app, "cert");
  expect(requests.filter((r) => r.path.endsWith("/claim"))).toHaveLength(1);
});

it("labels the frozen series inputs as bases on the owner-bound review", async () => {
  const { app } = await mount();
  await liveVenue(app);
  await screen(app, "cert");
  emit(app, "setup-goto", { screen: "review" });
  const allocation = await screen(app, "first-setup");
  allocation.dispatchEvent(
    new CustomEvent("initial-setup-ready", { bubbles: true, composed: true }),
  );
  const review = await screen(app, "review");
  expect(review.shadowRoot!.textContent).toContain("Invoice series base");
  expect(review.shadowRoot!.textContent).toContain("Full invoice series base");
  expect(review.shadowRoot!.textContent).toContain("Corrections series base");
  expect(review.shadowRoot!.querySelector("[data-test=summary-seriesCode]")!.textContent).toBe("A");
});

it.each([false, true])(
  "binds the selected staged configuration at claim, new taxpayer %s",
  async (newTaxpayer) => {
    const { app, requests } = await mount();
    await screen(app, "mode");
    emit(app, "setup-patch", {
      patch: { mode: "live", venue, configurationImport: true, newTaxpayer },
    });
    emit(app, "setup-goto", { screen: "venue" });
    await screen(app, "venue");
    emit(app, "setup-advance");
    await screen(app, "cert");
    expect(requests.find((r) => r.path.endsWith("/claim"))?.body).toMatchObject({
      configurationImport: true,
      newTaxpayer,
    });
    expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain("configurationImport");
  },
);

it("keeps a fresh Live choice after Start empty discards the previous draft", async () => {
  const { app, requests } = await mount();
  const mode = await screen(app, "mode");
  const nativeClick = async (owner: HTMLElement, selector: string) => {
    const host = owner.shadowRoot!.querySelector<HTMLElement>(selector)!;
    await userEvent.click(host.shadowRoot!.querySelector<HTMLElement>("button, input")!);
  };
  await nativeClick(mode, "[data-test=choose-live]");
  await (mode as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  await nativeClick(mode, "[data-test=understand]");
  await nativeClick(mode, "[data-test=confirm-live]");
  const source = await screen(app, "live-source");
  await nativeClick(source, "[data-test=empty]");
  const warning = app.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
    "wt-unsaved-changes",
  )!;
  await expect.poll(() => warning.open).toBe(true);
  await nativeClick(warning, "[data-choice=discard]");
  await screen(app, "admin");
  expect((app as unknown as { draft: { mode: string } }).draft.mode).toBe("live");
  emit(app, "setup-patch", { patch: { venue } });
  emit(app, "setup-goto", { screen: "venue" });
  await screen(app, "venue");
  emit(app, "setup-advance");
  await screen(app, "cert");
  expect(requests.filter((request) => request.path.endsWith("/claim"))).toHaveLength(1);
});

it("tests email as the current owner without sending a replacement administrator", async () => {
  const email = {
    server: "smtp.example.test",
    port: 465,
    encryption: "tls" as const,
    from: "owner@example.test",
    user: "",
    password: "",
  };
  const { app, requests } = await mount({
    intercept(path) {
      if (path.endsWith("/email-test")) return Response.json({ accepted: true });
    },
  });
  await liveVenue(app);
  await screen(app, "cert");
  emit(app, "setup-patch", { patch: { email } });
  emit(app, "setup-goto", { screen: "email" });
  const emailScreen = await screen(app, "email");
  const test = emailScreen.shadowRoot!.querySelector<HTMLElement>("[data-test=test]")!;
  await userEvent.click(test.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
  await expect.poll(() => requests.some((r) => r.path.endsWith("/email-test"))).toBe(true);
  const sent = requests.find((r) => r.path.endsWith("/email-test"))!;
  expect(sent.body).toEqual({ email });
  expect(sent.headers.get("X-Waitron-Setup-Owner")).toBe("A".repeat(43));
  expect(sent.headers.get("X-Waitron-Setup-Attempt")).toBe(initial.attemptId);
  expect(sent.headers.get("X-Waitron-Setup-Revision")).toBe("1");
  await expect
    .poll(() =>
      emailScreen
        .shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!
        .hasAttribute("disabled"),
    )
    .toBe(false);
});
