import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens, leaveCoordinatorFor } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";
import { setLocale } from "./i18n/t.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { venue, initial, wizardApi } from "../test/first-setup-browser.js";
const mounted: HTMLElement[] = [];
beforeEach(() => sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY));
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

it("sends the chosen working language in the real Live claim request", async () => {
  const { app, requests } = await mount();
  await screen(app, "mode");
  emit(app, "setup-patch", { patch: { mode: "live", venue } });
  emit(app, "setup-goto", { screen: "venue" });
  const form = await screen(app, "venue");
  const picker = form.shadowRoot!.querySelector("[data-test=staffLanguage]")!;
  picker.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "en" }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
  await expect.poll(() => requests.filter((r) => r.path.endsWith("/claim"))).toHaveLength(1);
  expect(requests.find((r) => r.path.endsWith("/claim"))!.body).toMatchObject({
    venue: { staffLanguage: "en", invoiceLocales: ["es-ES"] },
  });
});
it.each(["demo", "prepare"])("keeps %s free of custody claims", async (mode) => {
  const { app, requests } = await mount();
  await liveVenue(app, mode);
  await screen(app, mode === "prepare" ? "email" : "review");
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
type Intercept = NonNullable<Parameters<typeof wizardApi>[0]>["intercept"];
/** Claims in one tab, closes it, and opens a second tab holding the first one's saved key. */
async function reloadHoldingKey(intercept?: Intercept) {
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
  return mount({ claimed: true, intercept });
}
const ownerStatus = (state: Record<string, unknown>): Intercept =>
  function (path, _body, headers) {
    if (path.endsWith("/first-setup/status") && headers.has("X-Waitron-Setup-Owner"))
      return Response.json({ claimed: true, state: { ...initial, ...state } });
  };
const firstSetupPaths = (requests: { path: string }[]) =>
  requests.map((r) => r.path).filter((path) => path.startsWith("/setup-api/first-setup/"));
const enabled = (owner: HTMLElement, name: string) =>
  (owner.querySelector(`[data-test=${name}]`) as (HTMLElement & { disabled: boolean }) | null)
    ?.disabled === false;

it.each(["claimed", "consumption-intent"])(
  "a reload with a saved key carries on to the next step, sends no password, and claims and activates nothing again (%s)",
  async (status) => {
    const { app, requests } = await reloadHoldingKey(ownerStatus({ status }));
    await screen(app, "cert");
    expect(firstSetupPaths(requests)).toEqual([
      "/setup-api/first-setup/status",
      "/setup-api/first-setup/status",
      "/setup-api/first-setup/offerings",
    ]);
    expect(requests.filter((r) => r.headers.has("X-Waitron-Setup-Owner"))).toHaveLength(1);
    expect(JSON.stringify(requests.map((r) => r.body))).not.toContain(venue.admin.password);
    expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain(venue.admin.password);
    emit(app, "setup-goto", { screen: "review" });
    const allocation = await screen(app, "first-setup");
    expect(allocation.shadowRoot!.querySelector("vf-first-fiscal-screen")).not.toBeNull();
  },
);
it.each(["claimed", "consumption-intent"])(
  "a reloaded tab whose next-step read fails says Reconnect goes on, and Reconnect carries on (%s)",
  async (status) => {
    let offeringReads = 0;
    const { app, requests } = await reloadHoldingKey(function (path, body, headers) {
      if (path.endsWith("/offerings") && ++offeringReads === 1)
        return new Response(null, { status: 503 });
      return ownerStatus({ status })!(path, body, headers);
    });
    const owner = await screen(app, "first-owner");
    await expect.poll(() => enabled(owner, "reconnect-first")).toBe(true);
    const words = owner.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error;
    expect(words).toBe(
      "This page could not read the next step of this setup. Reconnect tries again and goes on with this setup.",
    );
    owner.querySelector<HTMLElement>("[data-test=reconnect-first]")!.click();
    await screen(app, "cert");
    expect(offeringReads).toBe(2);
    expect(
      requests.filter((r) => r.path.endsWith("/claim") || r.path.endsWith("/provision")),
    ).toEqual([]);
  },
);
it("a reloaded tab sent back from the certificate screen says Reconnect goes on, and Reconnect carries on", async () => {
  const { app, requests } = await reloadHoldingKey(ownerStatus({ status: "claimed" }));
  await screen(app, "cert");
  emit(app, "setup-goto", { screen: "venue" });
  const owner = await screen(app, "first-owner");
  const words = owner.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error;
  expect(words).toBe(
    "Setup details are frozen. Reconnect goes on with them; Abandon this attempt to change them.",
  );
  expect(enabled(owner, "abandon-attempt")).toBe(true);
  owner.querySelector<HTMLElement>("[data-test=reconnect-first]")!.click();
  await screen(app, "cert");
  expect(requests.filter((r) => r.path.endsWith("/claim"))).toEqual([]);
});
it("the words for a reloaded tab whose next-step read fails, and for frozen details, in Spanish", async () => {
  try {
    let offeringReads = 0;
    const { app } = await reloadHoldingKey(function (path, body, headers) {
      if (path.endsWith("/offerings") && ++offeringReads === 1)
        return new Response(null, { status: 503 });
      return ownerStatus({ status: "claimed" })!(path, body, headers);
    });
    setLocale("es-ES");
    const owner = await screen(app, "first-owner");
    await expect.poll(() => enabled(owner, "reconnect-first")).toBe(true);
    await app.updateComplete;
    expect(owner.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error).toBe(
      "Esta página no pudo leer el siguiente paso de esta configuración. Reconectar lo vuelve a intentar y sigue con esta configuración.",
    );
    owner.querySelector<HTMLElement>("[data-test=reconnect-first]")!.click();
    await screen(app, "cert");
    emit(app, "setup-goto", { screen: "venue" });
    const frozen = await screen(app, "first-owner");
    expect(frozen.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error).toBe(
      "Los datos están fijados. Reconectar sigue con ellos; abandona este intento para cambiarlos.",
    );
  } finally {
    setLocale("en-GB");
  }
});
it("a tab holding its key that reaches the box through the connection screen's Continue carries on", async () => {
  let keylessReads = 0;
  const { app, requests } = await reloadHoldingKey(function (path, _body, headers) {
    if (path.endsWith("/discovery")) return Response.json({ caDownloadAvailable: true });
    if (path.endsWith("/first-setup/status") && !headers.has("X-Waitron-Setup-Owner"))
      return Response.json({ claimed: ++keylessReads > 1 });
  });
  const connection = await screen(app, "connection");
  await new Promise((resolve) => setTimeout(resolve, 0));
  connection.dispatchEvent(
    new CustomEvent("connection-continue", { bubbles: true, composed: true }),
  );
  await screen(app, "cert");
  expect(requests.filter((r) => r.path.endsWith("/offerings"))).toHaveLength(1);
  expect(requests.filter((r) => r.path.endsWith("/claim"))).toEqual([]);
});
it.each(["claimed", "consumption-intent"])(
  "deliberately: a reload with a saved key at %s carries on when the setup database was deleted under the running server; the next server start shows the repair page",
  async (status) => {
    const { app, requests } = await reloadHoldingKey(function (path, body, headers) {
      if (path.endsWith("/first-setup/resolution"))
        return Response.json({
          version: 2,
          inspectionId: "a".repeat(64),
          pair: "valid",
          database: "missing",
          revision: 1,
          ownerGeneration: 1,
          emptyDatabase: false,
          artifacts: [],
        });
      return ownerStatus({ status })!(path, body, headers);
    });
    await screen(app, "cert");
    expect(requests.filter((r) => r.path.endsWith("/first-setup/resolution"))).toEqual([]);
  },
);
it("a reload while the box is on its repair page reads the inspection and offers Start again", async () => {
  const { app, requests } = await reloadHoldingKey(function (path, _body, headers) {
    if (path.endsWith("/first-setup/status") && headers.has("X-Waitron-Setup-Owner"))
      return Response.json({ claimed: true, resolution: true });
  });
  const owner = await screen(app, "first-owner");
  await expect.poll(() => enabled(owner, "start-again")).toBe(true);
  expect(requests.filter((r) => r.path.endsWith("/first-setup/resolution"))).toHaveLength(1);
  expect(requests.filter((r) => r.path.endsWith("/claim"))).toEqual([]);
});
it.each(["activation-started", "committed", "publication"])(
  "a reload after a failed activation draws Start again and Recover from backup, and no Finish setup (%s)",
  async (status) => {
    const { app, requests } = await reloadHoldingKey(ownerStatus({ status }));
    const owner = await screen(app, "first-owner");
    await expect.poll(() => enabled(owner, "start-again")).toBe(true);
    expect(enabled(owner, "recover-backup")).toBe(true);
    expect(owner.textContent).not.toContain("Finish setup");
    expect(
      requests.filter((r) => r.path.endsWith("/claim") || r.path.endsWith("/provision")),
    ).toEqual([]);
  },
);
it.each([
  ["abandoned", false],
  ["abandoned", true],
  ["uncertain", false],
  ["uncertain", true],
] as const)(
  "a reload of an abandoned or uncertain attempt says the box no longer lets this page carry it on and offers Start again (%s, consumed %s)",
  async (status, consumptionIntent) => {
    const { app } = await reloadHoldingKey(ownerStatus({ status, consumptionIntent }));
    const owner = await screen(app, "first-owner");
    await expect.poll(() => enabled(owner, "start-again")).toBe(true);
    expect(owner.textContent).toContain("The box no longer lets this page carry this setup on.");
    expect(owner.textContent).not.toContain("resolve the incident");
  },
);
it.each(["en-GB", "es-ES"])(
  "beside Start again, the words that the box no longer lets this page carry the setup on name no button (%s)",
  async (locale) => {
    try {
      const { app } = await reloadHoldingKey(ownerStatus({ status: "abandoned" }));
      setLocale(locale);
      const owner = await screen(app, "first-owner");
      await expect.poll(() => enabled(owner, "start-again")).toBe(true);
      const words = owner.querySelector("[data-test=owner-required]")!.textContent!;
      expect(words).toBe(
        locale === "es-ES"
          ? "El equipo ya no deja que esta página continúe esta configuración."
          : "The box no longer lets this page carry this setup on.",
      );
    } finally {
      setLocale("en-GB");
    }
  },
);
it("a reload whose saved key the box refuses says the box no longer lets this page carry the setup on and offers Start again", async () => {
  const { app, requests } = await reloadHoldingKey(function (path, _body, headers) {
    if (path.endsWith("/first-setup/status") && headers.has("X-Waitron-Setup-Owner"))
      return Response.json(
        { error: { code: "setup.owner_required", params: {} } },
        { status: 403 },
      );
  });
  const owner = await screen(app, "first-owner");
  await expect.poll(() => enabled(owner, "start-again")).toBe(true);
  expect(owner.textContent).toContain("The box no longer lets this page carry this setup on.");
  expect(requests.filter((r) => r.path.endsWith("/claim"))).toEqual([]);
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
    identity: "0CRHE",
    input: {
      allocation: {
        installationIdentity: "0CRHE",
        series: [
          { code: "A-0CRHE", purpose: "standard" },
          { code: "FF-0CRHE", purpose: "full" },
          { code: "R-0CRHE", purpose: "rectificative" },
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
                    secondClock: true,
                    disagreement: false,
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
  await userEvent.click(
    hour.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-details-confirmed"]')!,
  );
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
  expect(requests.filter((r) => r.path.endsWith("/provision"))).toHaveLength(1);
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
    patch: { venue: { ...venue, ...venue, fiscalTerritory: "GB-vat" } },
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
it("claims a staged preview's venue with only the venue fields the claim accepts", async () => {
  const { admin, ...exported } = venue;
  const preview = {
    venue: {
      ...exported,
      operationDescription: "Venta en establecimiento",
      dayCutover: "05:00:00",
      somethingNew: "not a setup field",
    },
    counts: { products: 4 },
    reconnect: [],
  };
  const { app, api, requests } = await mount();
  api.stageConfiguration = () => Promise.resolve(preview);
  await screen(app, "mode");
  emit(app, "setup-patch", { patch: { mode: "live" } });
  emit(app, "configuration-requested", {
    request: { artifact: new File(["encrypted"], "prepared.waitron-config"), passphrase: "pass" },
  });
  const choice = await screen(app, "configuration-preview");
  choice.shadowRoot!.querySelector<HTMLElement>("wt-choice-row[data-test=same-tax-id]")!.click();
  await screen(app, "admin");
  emit(app, "setup-patch", { patch: { venue: { admin } } });
  emit(app, "setup-goto", { screen: "venue" });
  const venueScreen = await screen(app, "venue");
  venueScreen.shadowRoot!.querySelector<HTMLElement>("wt-button[data-test=next]")!.click();
  await expect.poll(() => requests.filter((r) => r.path.endsWith("/claim"))).toHaveLength(1);
  const claim = requests.find((r) => r.path.endsWith("/claim"))!.body as {
    venue: Record<string, unknown>;
  };
  expect(Object.keys(claim.venue).sort()).toEqual(
    [
      "admin",
      "addressLine1",
      "addressLine2",
      "city",
      "country",
      "dayCutover",
      "fiscalTerritory",
      "fullSeriesCode",
      "invoiceLocales",
      "legalName",
      "name",
      "postalCode",
      "province",
      "rectificativeSeriesCode",
      "seriesCode",
      "staffLanguage",
      "taxId",
      "taxpayerDomicile",
      "timeZone",
    ].sort(),
  );
  expect(claim.venue.dayCutover).toBe("05:00:00");
});
