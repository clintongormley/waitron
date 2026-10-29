import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import type { FirstSetupInspection, StartAgainSummary } from "./api/first-setup-types.js";
import { setLocale } from "./i18n/t.js";
import { initialOwnerStrings, namesFromText } from "./screens/initial-owner-strings.js";
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

it("Start again's confirmation words are the design's, in English and Spanish", () => {
  const { en, es } = initialOwnerStrings;
  expect(en.heldLost).toBe(
    "Start again deletes what was entered in the setup that stopped part way.",
  );
  expect(es.heldLost).toBe(
    "Empezar de nuevo borra lo que se introdujo en la configuración que se detuvo a medias.",
  );
  expect(en.noInvoiceSent).toBe("No invoice was sent to AEAT.");
  expect(es.noInvoiceSent).toBe("No se envió ninguna factura a la AEAT.");
  expect(en.startAgainHelp).toBe("This box will not use this setup's invoice series names again.");
  expect(es.startAgainHelp).toBe(
    "Este equipo no volverá a usar los nombres de serie de facturas de esta configuración.",
  );
  for (const strings of [en, es])
    for (const key of ["heldNoInvoices", "heldNoInvoicesOne"])
      expect(Object.hasOwn(strings, key)).toBe(false);
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
    expect(q(app, "start-again-deletes").textContent!.trim()).toBe(
      `${t.heldLost} ${t.noInvoiceSent}`,
    );
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

it.each(["en-GB", "es-ES"])(
  "with an empty setup database, the confirmation says what Start again deletes and that no invoice was sent, above the help line, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app } = await mount();
    setLocale(locale);
    await app.updateComplete;
    await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
    await app.updateComplete;
    const deletes = q(app, "start-again-deletes");
    expect(deletes.textContent!.trim()).toBe(`${t.heldLost} ${t.noInvoiceSent}`);
    const help = [...app.shadowRoot!.querySelectorAll("p")].find(
      (p) => p.textContent === t.startAgainHelp,
    )!;
    expect(help).toBeDefined();
    expect(deletes.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      help.compareDocumentPosition(q(app, "retire-confirmed")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
    /** The code those refused sends answer; `setup.attempt_conflict` when not given. */
    refuseCode?: string;
    inspectionFailsAfterRefusal?: boolean;
    /** Merged into every inspection read after the refused send. */
    inspectionAfterRefusal?: Partial<FirstSetupInspection>;
    /** The password refusal says the series picks file is damaged; the summary route answers this. */
    damagedSummary?: StartAgainSummary;
    /** The summary route refuses instead of answering `damagedSummary`. */
    summaryRefused?: boolean;
    /** The code of that refusal; `server.internal` when not given. */
    summaryRefusedCode?: string;
    /** That refusal's params; a full disk's say a restart deletes logs when not given. */
    summaryRefusedParams?: Record<string, unknown>;
    /** Answered by the summary route in place of `damagedSummary` once a send was refused. */
    damagedSummaryAfterRefusal?: StartAgainSummary;
  } = {},
) {
  let generation = 1;
  let refusals = options.refuseFlagged ?? 0;
  let refused = false;
  const fixture = await mount({
    intercept(path, body, headers) {
      if (path.endsWith("/resolution/start-again") && !headers.has(ownerHeader))
        return Response.json(
          {
            error: {
              code: "setup.start_again_password_required",
              params: options.damagedSummary ? { seriesPicksUnreadable: true } : {},
            },
          },
          { status: 403 },
        );
      if (path.endsWith("/start-again/summary") && options.damagedSummary)
        return options.summaryRefused
          ? Response.json(
              {
                error: {
                  code: options.summaryRefusedCode ?? "server.internal",
                  params:
                    options.summaryRefusedParams ??
                    (options.summaryRefusedCode === "storage.disk_full"
                      ? { restartDeletesLogs: true }
                      : {}),
                },
              },
              { status: options.summaryRefusedCode === "storage.disk_full" ? 507 : 500 },
            )
          : Response.json(
              (refused ? options.damagedSummaryAfterRefusal : undefined) ?? options.damagedSummary,
            );
      if (path.endsWith("/resolution/start-again") && refusals > 0) {
        refusals -= 1;
        refused = true;
        const code = options.refuseCode ?? "setup.attempt_conflict";
        return Response.json(
          {
            error: {
              code,
              params: code === "storage.disk_full" ? { restartDeletesLogs: true } : {},
            },
          },
          { status: code === "storage.disk_full" ? 507 : 409 },
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
            { error: { code: "setup.owner_required", params: {} } },
            { status: 403 },
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
        return Response.json({
          ...inspection,
          revision: generation,
          ownerGeneration: generation,
          ...(refused ? options.inspectionAfterRefusal : {}),
        });
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

const picksFloorMs = new Date(2026, 9, 25, 15, 3).getTime();
const picksSummary = (recoveryDamaged: boolean): StartAgainSummary => ({
  reached: "claimed",
  lastName: null,
  ...(recoveryDamaged ? { recoveryRecordDamaged: true as const } : {}),
  unreadable: { records: ["series-picks"], floorMs: picksFloorMs },
});
const summaryRequests = <R extends { path: string }>(requests: R[]) =>
  requests.filter((r) => r.path.endsWith("/start-again/summary"));

it("with the database present and only the series picks file damaged: the password, then the summary's lines, and no damaged recovery-key line; Cancel sends nothing, Confirm sends the summary", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await damagedRecord({ damagedSummary: picksSummary(false) });
  expect(summaryRequests(requests)).toEqual([]);
  await password(app);
  await click(app, "damaged-record-continue");
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(summaryRequests(requests)).toHaveLength(1);
  expect(summaryRequests(requests)[0]!.headers.get(ownerHeader)).toBe("B".repeat(43));
  expect(app.shadowRoot!.querySelector("[data-test=recovery-record-damaged]")).toBeNull();
  expect(
    [...app.shadowRoot!.querySelectorAll("[data-test=name-record-damaged]")].map((p) =>
      p.textContent!.trim(),
    ),
  ).toEqual([t.seriesPicksDamaged]);
  expect(app.shadowRoot!.textContent).toContain(t.startAgainHelp);
  expect(q(app, "names-from").textContent!.trim()).toBe(namesFromText("en-GB", picksFloorMs));
  expect(q(app, "retire-confirmed")).not.toBeNull();
  expect(startAgainRequests(requests)).toHaveLength(1);
  await click(app, "cancel-start-again");
  await app.updateComplete;
  expect(startAgainRequests(requests)).toHaveLength(1);
  await click(app, "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(2);
  const sent = startAgainRequests(requests)[1]!;
  expect(sent.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 2,
    ownerGeneration: 2,
    confirmUnreadable: { shown: picksSummary(false) },
  });
  expect(sent.headers.get(ownerHeader)).toBe("B".repeat(43));
});

it("with the database present, the series picks file and the recovery-key record both damaged: both lines, and the request carries both keys", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await damagedRecord({ damagedSummary: picksSummary(true) });
  await unlockDamagedRecord(app);
  expect(q(app, "recovery-record-damaged").textContent).toBe(t.recoveryRecordDamaged);
  expect(
    [...app.shadowRoot!.querySelectorAll("[data-test=name-record-damaged]")].map((p) =>
      p.textContent!.trim(),
    ),
  ).toEqual([t.seriesPicksDamaged]);
  expect(q(app, "names-from").textContent!.trim()).toBe(namesFromText("en-GB", picksFloorMs));
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(2);
  expect(startAgainRequests(requests)[1]!.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 2,
    ownerGeneration: 2,
    recoveryRecordDamagedShown: true,
    confirmUnreadable: { shown: picksSummary(true) },
  });
});

it("with the database present, a failed read of the damaged records' summary offers no Start again and says the details could not be read", async () => {
  const { app, requests } = await damagedRecord({
    damagedSummary: picksSummary(false),
    summaryRefused: true,
  });
  await password(app);
  await click(app, "damaged-record-continue");
  await expect.poll(() => q(app, "check-again")).not.toBeNull();
  expect(summaryRequests(requests)).toHaveLength(1);
  expect(app.shadowRoot!.querySelector("[data-test=confirm-start-again]")).toBeNull();
  expect(formErrors(app)).toContain(initialOwnerStrings.en.recoveryDetailsUnread);
  expect(startAgainRequests(requests)).toHaveLength(1);
});

it("with the database present, a damaged records' summary that also carries a stopped recovery the activity read did not show offers no Start again and sends nothing", async () => {
  const { app, requests } = await damagedRecord({
    damagedSummary: {
      ...picksSummary(false),
      recovery: { ...stoppedSummary(false).recovery, lastActiveSource: "memory" },
    },
  });
  await password(app);
  await click(app, "damaged-record-continue");
  await expect.poll(() => q(app, "check-again")).not.toBeNull();
  expect(summaryRequests(requests)).toHaveLength(1);
  expect(app.shadowRoot!.querySelector("[data-test=confirm-start-again]")).toBeNull();
  expect(formErrors(app)).toContain(initialOwnerStrings.en.recoveryDetailsUnread);
  expect(startAgainRequests(requests)).toHaveLength(1);
});

it("with the database present, a retry after a refused send draws and sends the damaged records' summary read again, not the one shown before", async () => {
  const laterFloorMs = new Date(2026, 9, 26, 9, 41).getTime();
  const later: StartAgainSummary = {
    ...picksSummary(false),
    unreadable: { records: ["series-picks"], floorMs: laterFloorMs },
  };
  const { app, requests } = await damagedRecord({
    damagedSummary: picksSummary(false),
    damagedSummaryAfterRefusal: later,
    refuseFlagged: 1,
  });
  await password(app);
  await click(app, "damaged-record-continue");
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(q(app, "names-from").textContent!.trim()).toBe(namesFromText("en-GB", picksFloorMs));
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
  expect(app.shadowRoot!.querySelector("[data-test=names-from]")).toBeNull();
  await password(app);
  await click(app, "damaged-record-continue");
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(summaryRequests(requests)).toHaveLength(2);
  expect(q(app, "names-from").textContent!.trim()).toBe(namesFromText("en-GB", laterFloorMs));
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(3);
  expect(startAgainRequests(requests)[2]!.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 3,
    ownerGeneration: 3,
    confirmUnreadable: { shown: later },
  });
});

it("with the database present, a password refusal without the picks flag reads no summary and keeps today's warning", async () => {
  const { app, requests } = await damagedRecord();
  await unlockDamagedRecord(app);
  expect(summaryRequests(requests)).toEqual([]);
  expect(app.shadowRoot!.querySelector("[data-test=name-record-damaged]")).toBeNull();
  expect(app.shadowRoot!.querySelector("[data-test=names-from]")).toBeNull();
});

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
    expect(
      warning.compareDocumentPosition(q(app, "start-again-deletes")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
  { name: "holding records", after: { database: "occupied", emptyDatabase: false } },
  { name: "missing", after: { database: "missing", emptyDatabase: false } },
] as const)(
  "a refused Start again at the warning, with the database now $name, leaves the damaged-record steps for the page as it now is, signed out, with the refusal shown",
  async ({ after }) => {
    const { app, requests } = await damagedRecord({
      refuseFlagged: 1,
      inspectionAfterRefusal: after,
    });
    await unlockDamagedRecord(app);
    await confirmDamagedRecord(app);
    await expect.poll(() => startAgainRequests(requests)).toHaveLength(2);
    await expect.poll(() => app.shadowRoot!.querySelector("[data-test=resume]")).not.toBeNull();
    expect(formErrors(app)).toEqual([shellEn["shell.first_setup.attempt_conflict"]]);
    for (const name of [
      "damaged-record-password",
      "recovery-record-damaged",
      "confirm-start-again",
      "abandon-attempt",
    ])
      expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
    expect(app.shadowRoot!.querySelector("h1")!.textContent).toBe(
      initialOwnerStrings.en.interrupted,
    );
    expect(q<WtButton>(app, "start-again").disabled).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
    expect(startAgainRequests(requests)).toHaveLength(2);
  },
);

const damagedSteps = {
  "the password step": (status: "claimed" | "abandoned") => damagedRecord({ status }),
  "the warning": async (status: "claimed" | "abandoned") => {
    const fixture = await damagedRecord({ status });
    await unlockDamagedRecord(fixture.app);
    return fixture;
  },
  "the page after Cancel at the warning": (status: "claimed" | "abandoned") =>
    cancelAtWarning({ status }),
  "the password step after a refused send": (status: "claimed" | "abandoned") =>
    refusedAtWarning({ status }),
};
it.each(
  (["claimed", "abandoned"] as const).flatMap((status) =>
    (Object.keys(damagedSteps) as (keyof typeof damagedSteps)[]).map((step) => ({
      status,
      step,
    })),
  ),
)(
  "Reconnect from $step lands on the page as it is, signed out, with Start again offered, for a $status attempt",
  async ({ status, step }) => {
    const t = initialOwnerStrings.en;
    const { app } = await damagedSteps[step](status);
    await click(app, "reconnect-first");
    await expect.poll(() => app.shadowRoot!.querySelector("[data-test=resume]")).not.toBeNull();
    await expect
      .poll(() => app.shadowRoot!.querySelector<WtButton>("[data-test=start-again]")?.disabled)
      .toBe(false);
    expect(app.shadowRoot!.querySelector("h1")!.textContent).toBe(t.interrupted);
    for (const name of [
      "damaged-record-password",
      "confirm-start-again",
      "abandon-attempt",
      "replace-attempt",
    ])
      expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
    expect(app.shadowRoot!.textContent).not.toContain(t.retired);
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  },
);

it("an abandoned attempt's warning and its password step after a refused send do not say the attempt is abandoned", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await damagedRecord({ status: "abandoned", refuseFlagged: 1 });
  await unlockDamagedRecord(app);
  await app.updateComplete;
  expect(app.shadowRoot!.textContent).not.toContain(t.retired);
  await confirmDamagedRecord(app);
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(2);
  await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
  await app.updateComplete;
  expect(app.shadowRoot!.textContent).not.toContain(t.retired);
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

it("with the database present, a tab that signed in before reads the activity on reload and, while another device runs a recovery, offers no password field, no Continue and no Abandon, and sends nothing", async () => {
  sessionStorage.setItem(
    FIRST_SETUP_SESSION_KEY,
    JSON.stringify({
      version: 1,
      clientClaimNonce: "N".repeat(43),
      claimPending: false,
      owner: {
        attemptId: initial.attemptId,
        revision: 1,
        ownerGeneration: 1,
        capability: "A".repeat(43),
      },
    }),
  );
  const startedAt = new Date(2026, 9, 25, 14, 35).toISOString();
  const lastActiveAt = new Date(2026, 9, 25, 14, 41).toISOString();
  const { app, requests } = await mount({
    intercept(path) {
      if (path.endsWith("/backup/activity"))
        return Response.json({ activity: { state: "running", startedAt, lastActiveAt } });
    },
  });
  await expect
    .poll(() => app.shadowRoot!.querySelector("[data-test=recovery-running]"))
    .not.toBeNull();
  const t = initialOwnerStrings.en;
  expect(
    [...q(app, "recovery-running").querySelectorAll("p")].map((p) => p.textContent!.trim()),
  ).toEqual([
    t.recoveryRunning.replace("{started}", "25 Oct 2026, 14:35"),
    t.recoveryLastActive.replace("{at}", "25 Oct 2026, 14:41"),
    t.recoveryRunningNext,
  ]);
  const shadow = app.shadowRoot!;
  for (const name of [
    "resume-password",
    "resume",
    "abandon-attempt",
    "start-again",
    "recover-backup",
    "finish-setup",
  ])
    expect(shadow.querySelector(`[data-test=${name}]`), name).toBeNull();
  expect(shadow.querySelector("h1")!.textContent).toBe(t.interrupted);
  expect(requests.filter((r) => r.body !== undefined)).toEqual([]);
  expect(requests.some((r) => r.path.endsWith("/first-setup/resume"))).toBe(false);
});

const stoppedAt = {
  startedAt: new Date(2026, 9, 25, 14, 35).toISOString(),
  lastActiveAt: new Date(2026, 9, 25, 14, 41).toISOString(),
};
/** The server's shape for a stopped recovery's activity. */
const stoppedActivity = (overrides: Record<string, unknown> = {}) => ({
  state: "stopped",
  ...stoppedAt,
  lastActiveSource: "memory",
  phase: "prepared",
  recoveryId: "r1",
  failed: false,
  cloud: false,
  ...overrides,
});
/** Read after the password, so it is later than the activity read when the page loaded. */
const summaryLastActiveAt = new Date(2026, 9, 25, 14, 47).toISOString();
const stoppedSummary = (damaged: boolean) => ({
  reached: "claimed",
  lastName: null,
  ...(damaged ? { recoveryRecordDamaged: true } : {}),
  recovery: {
    startedAt: stoppedAt.startedAt,
    lastActiveAt: summaryLastActiveAt,
    lastActiveSource: "memory",
    lastName: "ABCDE",
    failed: false,
    cloud: false,
  },
});
async function stoppedPresent(
  options: {
    damaged?: boolean;
    running?: boolean;
    /** The activity answered by each read, counted from 0; a `Response`, or a promise of one, is sent as it is. */
    activity?: (read: number) => unknown;
    /** The summary's answer for each read, counted from 0; the summary itself when undefined. */
    summary?: (read: number) => Response | Promise<Response> | undefined;
    /** A Start again without the owner header is refused as the server does for a stopped recovery. */
    passwordRequired?: boolean;
    /** Merged into every inspection read. */
    inspection?: Partial<FirstSetupInspection>;
    /** The answer to each Start again, counted from 0; the default answer when undefined. */
    startAgain?: (send: number) => Response | undefined;
  } = {},
) {
  let startAgainSends = 0;
  let generation = 1;
  let activityReads = 0;
  let summaryReads = 0;
  const fixture = await mount({
    intercept(path, body, headers) {
      if (path.endsWith("/backup/activity")) {
        const activity = options.activity
          ? options.activity(activityReads++)
          : options.running
            ? { state: "running", ...stoppedAt }
            : stoppedActivity();
        return activity instanceof Response || activity instanceof Promise
          ? (activity as Response | Promise<Response>)
          : Response.json({ activity });
      }
      if (path.endsWith("/start-again/summary"))
        return (
          options.summary?.(summaryReads++) ??
          Response.json(stoppedSummary(options.damaged === true))
        );
      if (path.endsWith("/resolution/start-again") && options.startAgain) {
        const answer = options.startAgain(startAgainSends++);
        if (answer) return answer;
      }
      if (
        options.passwordRequired &&
        path.endsWith("/resolution/start-again") &&
        !headers.has(ownerHeader)
      )
        return Response.json(
          { error: { code: "setup.start_again_password_required", params: {} } },
          { status: 403 },
        );
      if (path.endsWith("/resolution/recover")) {
        if ((body as { password: string }).password !== venue.admin.password)
          return Response.json(
            { error: { code: "setup.owner_required", params: {} } },
            { status: 403 },
          );
        generation += 1;
        return Response.json({
          state: { ...initial, revision: generation, ownerGeneration: generation },
          capability: "B".repeat(43),
          ownerGeneration: generation,
        });
      }
      if (path.endsWith("/resolution"))
        return Response.json({
          ...inspection,
          ...options.inspection,
          revision: generation,
          ownerGeneration: generation,
        });
    },
  });
  await expect
    .poll(() =>
      fixture.app.shadowRoot!.querySelector(
        options.running ? "[data-test=recovery-running]" : "[data-test=start-again]",
      ),
    )
    .not.toBeNull();
  return fixture;
}
const stoppedLines = (app: SetupApp) =>
  [...q(app, "recovery-stopped").querySelectorAll("p")].map((p) => p.textContent!.trim());
const click = (app: SetupApp, name: string) =>
  userEvent.click(q<WtButton>(app, name).shadowRoot!.querySelector("button")!);
async function passwordAccepted(app: SetupApp) {
  await click(app, "start-again");
  await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
  await password(app);
  await click(app, "damaged-record-continue");
}

it("with the database present and a stopped recovery: the stopped line, then the password, then the confirmation; nothing is sent before the tick and Confirm", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await stoppedPresent();
  const sentNothing = () => expect(startAgainRequests(requests)).toEqual([]);
  expect(stoppedLines(app)).toEqual([
    t.recoveryStopped.replace("{started}", "25 Oct 2026, 14:35"),
    t.recoveryLastActive.replace("{at}", "25 Oct 2026, 14:41"),
  ]);
  await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
  await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
  expect(q(app, "confirm-start-again")).toBeNull();
  sentNothing();
  await password(app);
  await userEvent.click(
    q<WtButton>(app, "damaged-record-continue").shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(app.shadowRoot!.querySelector("[data-test=recovery-record-damaged]")).toBeNull();
  // The confirmation is drawn from the summary read after the password, not the earlier activity.
  expect(stoppedLines(app)).toEqual([
    t.recoveryStopped.replace("{started}", "25 Oct 2026, 14:35"),
    t.recoveryLastActive.replace("{at}", "25 Oct 2026, 14:47"),
  ]);
  expect(q(app, "cancel-start-again")).not.toBeNull();
  expect(q<WtButton>(app, "confirm-start-again").disabled).toBe(true);
  sentNothing();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  sentNothing();
  await userEvent.click(
    q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
  const sent = startAgainRequests(requests)[0]!;
  expect(sent.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 2,
    ownerGeneration: 2,
    confirmRecoveryDiscard: { shown: stoppedSummary(false) },
  });
  expect(sent.headers.get(ownerHeader)).toBe("B".repeat(43));
  await expect.poll(() => app.shadowRoot!.textContent).toContain(t.restarting);
});

it("with the database present, a damaged record and a stopped recovery: both lines are drawn before Confirm, and the request carries both keys", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await stoppedPresent({ damaged: true });
  await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
  await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
  await password(app);
  await userEvent.click(
    q<WtButton>(app, "damaged-record-continue").shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  const damaged = q(app, "recovery-record-damaged");
  expect(damaged.textContent).toBe(t.recoveryRecordDamaged);
  expect(
    damaged.compareDocumentPosition(q(app, "recovery-stopped")) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(startAgainRequests(requests)).toEqual([]);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await userEvent.click(
    q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
  expect(startAgainRequests(requests)[0]!.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 2,
    ownerGeneration: 2,
    confirmRecoveryDiscard: { shown: stoppedSummary(true) },
    recoveryRecordDamagedShown: true,
  });
});

it("with the database present, a stopped recovery and a damaged series picks file: the stopped lines, the name-record line and when new names can start; Confirm sends the summary as the recovery discard only", async () => {
  const t = initialOwnerStrings.en;
  const shown = {
    ...stoppedSummary(false),
    unreadable: { records: ["series-picks"], floorMs: picksFloorMs },
  };
  const { app, requests } = await stoppedPresent({ summary: () => Response.json(shown) });
  await passwordAccepted(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(stoppedLines(app)).toEqual([
    t.recoveryStopped.replace("{started}", "25 Oct 2026, 14:35"),
    t.recoveryLastActive.replace("{at}", "25 Oct 2026, 14:47"),
  ]);
  expect(app.shadowRoot!.querySelector("[data-test=recovery-record-damaged]")).toBeNull();
  expect(
    [...app.shadowRoot!.querySelectorAll("[data-test=name-record-damaged]")].map((p) =>
      p.textContent!.trim(),
    ),
  ).toEqual([t.seriesPicksDamaged]);
  expect(q(app, "names-from").textContent!.trim()).toBe(namesFromText("en-GB", picksFloorMs));
  expect(startAgainRequests(requests)).toEqual([]);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
  const sent = startAgainRequests(requests)[0]!;
  expect(sent.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 2,
    ownerGeneration: 2,
    confirmRecoveryDiscard: { shown },
  });
  expect(sent.headers.get(ownerHeader)).toBe("B".repeat(43));
});

it("with the database present, while a recovery runs, no Start again, password or confirmation is offered and nothing is sent", async () => {
  const { app, requests } = await stoppedPresent({ running: true });
  for (const name of [
    "start-again",
    "resume-password",
    "damaged-record-password",
    "confirm-start-again",
    "recovery-stopped",
  ])
    expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
  expect(requests.some((r) => /\/(recover|start-again|summary)$/.test(r.path))).toBe(false);
});

it("with the database present, Recover from backup is not offered beside a stopped recovery", async () => {
  const { app } = await stoppedPresent();
  expect(q(app, "recovery-stopped")).not.toBeNull();
  expect(app.shadowRoot!.querySelector("[data-test=recover-backup]")).toBeNull();
  expect(q<WtButton>(app, "start-again").disabled).toBe(false);
});

it("with the database present and no recovery, Recover from backup is still offered", async () => {
  const { app } = await stoppedPresent({ activity: () => null });
  expect(app.shadowRoot!.querySelector("[data-test=recovery-stopped]")).toBeNull();
  expect(q(app, "recover-backup")).not.toBeNull();
});

it.each([
  {
    activity: { lastActiveSource: "saved-step" },
    lines: (t: (typeof initialOwnerStrings)["en"]) => [
      t.recoveryLastSaved.replace("{at}", "25 Oct 2026, 14:41"),
    ],
  },
  {
    activity: { cloud: true },
    lines: (t: (typeof initialOwnerStrings)["en"]) => [
      t.recoveryLastActive.replace("{at}", "25 Oct 2026, 14:41"),
      t.recoveryStoppedCloud,
    ],
  },
])(
  "with the database present, the stopped line before the password follows the activity's $activity",
  async ({ activity, lines }) => {
    const t = initialOwnerStrings.en;
    const { app } = await stoppedPresent({ activity: () => stoppedActivity(activity) });
    await expect
      .poll(() => app.shadowRoot!.querySelector("[data-test=recovery-stopped]"))
      .not.toBeNull();
    expect(stoppedLines(app)).toEqual([
      t.recoveryStopped.replace("{started}", "25 Oct 2026, 14:35"),
      ...lines(t),
    ]);
  },
);

it("with the database present, a recovery that stopped after the page loaded is drawn from the reads after the password: no damaged warning, and no damaged flag sent", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await stoppedPresent({
    activity: (read) => (read === 0 ? null : stoppedActivity()),
    passwordRequired: true,
  });
  expect(app.shadowRoot!.querySelector("[data-test=recovery-stopped]")).toBeNull();
  await click(app, "start-again");
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
  await password(app);
  await click(app, "damaged-record-continue");
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(app.shadowRoot!.querySelector("[data-test=recovery-record-damaged]")).toBeNull();
  expect(stoppedLines(app)).toEqual([
    t.recoveryStopped.replace("{started}", "25 Oct 2026, 14:35"),
    t.recoveryLastActive.replace("{at}", "25 Oct 2026, 14:47"),
  ]);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(2);
  expect(startAgainRequests(requests)[1]!.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 2,
    ownerGeneration: 2,
    confirmRecoveryDiscard: { shown: stoppedSummary(false) },
  });
});

it("with the database present, a stopped recovery that runs again by the time the password is accepted is drawn as running, signed out, and nothing is sent", async () => {
  const { app, requests } = await stoppedPresent({
    activity: (read) => (read === 0 ? stoppedActivity() : { state: "running", ...stoppedAt }),
  });
  await passwordAccepted(app);
  await expect
    .poll(() => app.shadowRoot!.querySelector("[data-test=recovery-running]"))
    .not.toBeNull();
  for (const name of [
    "confirm-start-again",
    "damaged-record-password",
    "start-again",
    "abandon-attempt",
  ])
    expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  expect(requests.some((r) => r.path.endsWith("/start-again/summary"))).toBe(false);
  expect(startAgainRequests(requests)).toEqual([]);
});

const refusal = (code: string, status: number) =>
  Response.json({ error: { code, params: {} } }, { status });
it.each([
  {
    name: "a refusal the page has no words for",
    locale: "en-GB",
    answer: () => refusal("setup.not_ready", 409),
    shown: () => initialOwnerStrings.en.recoveryDetailsUnread,
  },
  {
    name: "a refusal the page has no words for, in Spanish",
    locale: "es-ES",
    answer: () => refusal("setup.not_ready", 409),
    shown: () => initialOwnerStrings.es.recoveryDetailsUnread,
  },
  {
    name: "a summary that names no recovery",
    locale: "en-GB",
    answer: () => Response.json({ reached: "claimed", lastName: null }),
    shown: () => initialOwnerStrings.en.recoveryDetailsUnread,
  },
  {
    name: "a refusal the page has words for",
    locale: "en-GB",
    answer: () => refusal("setup.recovery_in_progress", 409),
    shown: () => shellEn["shell.first_setup.recovery_in_progress"],
  },
])(
  "with the database present, a summary read after the password that fails with $name says so, and Check again reads it again",
  async ({ locale, answer, shown }) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const shell = shellText(locale);
    const { app, requests } = await stoppedPresent({
      summary: (read) => (read === 0 ? answer() : undefined),
    });
    setLocale(locale);
    await app.updateComplete;
    await passwordAccepted(app);
    await expect.poll(() => formErrors(app)).toEqual([shown()]);
    const text = app.shadowRoot!.textContent!;
    for (const wrong of [t.error, shell["shell.first_setup.attempt_conflict"]])
      expect(text).not.toContain(wrong);
    expect(app.shadowRoot!.querySelector("[data-test=confirm-start-again]")).toBeNull();
    expect(app.shadowRoot!.querySelector("[data-test=abandon-attempt]")).toBeNull();
    expect(q(app, "recovery-stopped")).not.toBeNull();
    expect(q(app, "check-again").textContent).toContain(t.checkAgain);
    const activityReads = requests.filter((r) => r.path.endsWith("/backup/activity")).length;
    await click(app, "check-again");
    await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
    expect(requests.filter((r) => r.path.endsWith("/backup/activity")).length).toBe(
      activityReads + 1,
    );
    expect(requests.filter((r) => r.path.endsWith("/start-again/summary"))).toHaveLength(2);
    expect(formErrors(app)).toEqual([""]);
    expect(startAgainRequests(requests)).toEqual([]);
  },
);

it("with the database present, Cancel after a failed summary read returns to the stopped recovery, signed out", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await stoppedPresent({
    summary: (read) => (read === 0 ? refusal("setup.not_ready", 409) : undefined),
  });
  await passwordAccepted(app);
  await expect.poll(() => q(app, "check-again")).not.toBeNull();
  await click(app, "cancel-damaged-record");
  await expect
    .poll(() => app.shadowRoot!.querySelector<WtButton>("[data-test=start-again]")?.disabled)
    .toBe(false);
  expect(stoppedLines(app)[0]).toBe(t.recoveryStopped.replace("{started}", "25 Oct 2026, 14:35"));
  expect(q(app, "resume")).not.toBeNull();
  for (const name of ["abandon-attempt", "check-again", "recover-backup", "confirm-start-again"])
    expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
  expect(formErrors(app)).toEqual([""]);
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();

  await passwordAccepted(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  const recovers = requests.filter((r) => r.path.endsWith("/resolution/recover"));
  expect(recovers).toHaveLength(2);
  expect(recovers[1]!.body).toMatchObject({ revision: 2, ownerGeneration: 2 });
  expect(startAgainRequests(requests)).toEqual([]);
});

it("with the database present, Start again after Cancel at a stopped recovery's confirmation reads the activity and the summary again before drawing it", async () => {
  const t = initialOwnerStrings.en;
  const later = new Date(2026, 9, 25, 14, 52).toISOString();
  const { app, requests } = await stoppedPresent({
    summary: (read) =>
      read === 0
        ? undefined
        : Response.json({
            ...stoppedSummary(false),
            recovery: { ...stoppedSummary(false).recovery, lastActiveAt: later },
          }),
  });
  await passwordAccepted(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  await click(app, "cancel-start-again");
  await expect
    .poll(() => app.shadowRoot!.querySelector("[data-test=confirm-start-again]"))
    .toBeNull();
  const activityReads = requests.filter((r) => r.path.endsWith("/backup/activity")).length;
  await click(app, "start-again");
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(requests.filter((r) => r.path.endsWith("/backup/activity")).length).toBe(
    activityReads + 1,
  );
  expect(stoppedLines(app)).toEqual([
    t.recoveryStopped.replace("{started}", "25 Oct 2026, 14:35"),
    t.recoveryLastActive.replace("{at}", "25 Oct 2026, 14:52"),
  ]);
  expect(requests.filter((r) => r.path.endsWith("/resolution/recover"))).toHaveLength(1);
  expect(startAgainRequests(requests)).toEqual([]);
});

it("with the database present, a stopped recovery gone by the time the password is accepted: back to the repair page, signed out, with no damaged warning and nothing sent", async () => {
  const { app, requests } = await stoppedPresent({
    activity: (read) => (read === 0 ? stoppedActivity() : null),
  });
  await passwordAccepted(app);
  await expect.poll(() => q(app, "recover-backup")).not.toBeNull();
  for (const name of [
    "recovery-stopped",
    "recovery-record-damaged",
    "confirm-start-again",
    "damaged-record-password",
    "abandon-attempt",
  ])
    expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  expect(requests.some((r) => r.path.endsWith("/start-again/summary"))).toBe(false);
  expect(startAgainRequests(requests)).toEqual([]);
});

it("with the database present, a refused Start again reads the activity again: a recovery that stopped before the send and is gone before the password brings back no damaged warning", async () => {
  let activity: unknown = null;
  const { app, requests } = await stoppedPresent({
    activity: () => activity,
    passwordRequired: true,
  });
  await click(app, "start-again");
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  activity = stoppedActivity();
  await click(app, "confirm-start-again");
  await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
  activity = null;
  await password(app);
  await click(app, "damaged-record-continue");
  await expect.poll(() => app.shadowRoot!.querySelector("[data-test=resume]")).not.toBeNull();
  for (const name of [
    "recovery-record-damaged",
    "confirm-start-again",
    "damaged-record-password",
    "recovery-stopped",
  ])
    expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
  expect(q<WtButton>(app, "start-again").disabled).toBe(false);
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  expect(startAgainRequests(requests)).toHaveLength(1);
});

it("with the database present, while Check again reads after a failed summary, the stopped line and both buttons stay drawn, disabled", async () => {
  let answer: (response: Response) => void = () => undefined;
  const { app, requests } = await stoppedPresent({
    summary: (read) =>
      read === 0
        ? refusal("setup.not_ready", 409)
        : read === 1
          ? new Promise<Response>((done) => (answer = done))
          : undefined,
  });
  await passwordAccepted(app);
  await expect.poll(() => q(app, "check-again")).not.toBeNull();
  await click(app, "check-again");
  await expect
    .poll(() => requests.filter((r) => r.path.endsWith("/start-again/summary")))
    .toHaveLength(2);
  await app.updateComplete;
  expect(q<WtButton>(app, "check-again").disabled).toBe(true);
  expect(q(app, "recovery-stopped")).not.toBeNull();
  expect(q<WtButton>(app, "cancel-damaged-record").disabled).toBe(true);
  answer(Response.json(stoppedSummary(false)));
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
});

const heldSummary = (rows: number) => ({
  ...stoppedSummary(false),
  held: { rows, kept: 0, records: 0, accepted: 0 },
});
it.each(["en-GB", "es-ES"])(
  "with the database present and holding records beside a stopped recovery, Start again is offered and, after the password, says what the database holds, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app, requests } = await stoppedPresent({
      inspection: { database: "occupied", emptyDatabase: false },
      summary: () => Response.json(heldSummary(105)),
    });
    setLocale(locale);
    await expect.poll(() => q(app, "recovery-stopped")).not.toBeNull();
    await app.updateComplete;
    expect(q<WtButton>(app, "start-again").disabled).toBe(false);
    const text = app.shadowRoot!.textContent!;
    expect(text).not.toContain(t.startUnavailableOccupied);
    expect(text).not.toContain(t.startUnavailable);
    await passwordAccepted(app);
    await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
    expect(q(app, "start-again-deletes").textContent!.trim()).toBe(
      `${t.heldLost} ${t.noInvoiceSent}`,
    );
    expect(q(app, "screen-first-owner").textContent).not.toContain("105");
    expect(q(app, "screen-first-owner").textContent).not.toContain(
      t.heldRows.replace("{rows}", "105"),
    );
    expect(q(app, "recovery-stopped").textContent).toContain(
      t.recoveryStopped.split("{started}")[1]!,
    );
    const order = [
      q(app, "start-again-deletes"),
      q(app, "recovery-stopped"),
      [...q(app, "screen-first-owner").querySelectorAll("p")].find(
        (p) => p.textContent === t.startAgainHelp,
      )!,
      q(app, "retire-confirmed"),
      q(app, "cancel-start-again"),
      q(app, "confirm-start-again"),
    ];
    for (const [index, element] of order.slice(1).entries())
      expect(
        order[index]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
        String(index),
      ).toBeTruthy();
    expect(startAgainRequests(requests)).toEqual([]);
    await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
    await app.updateComplete;
    await click(app, "confirm-start-again");
    await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
    expect(startAgainRequests(requests)[0]!.body).toEqual({
      inspectionId: "a".repeat(64),
      revision: 2,
      ownerGeneration: 2,
      confirmRecoveryDiscard: { shown: heldSummary(105) },
    });
    await expect.poll(() => app.shadowRoot!.textContent).toContain(t.restarting);
  },
);

it.each(["en-GB", "es-ES"])(
  "a setup database holding one row in a table other than the venue's is described in words that carry no count, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app } = await stoppedPresent({
      inspection: { database: "no-venue-rows", emptyDatabase: false },
      summary: () => Response.json(heldSummary(1)),
    });
    setLocale(locale);
    await app.updateComplete;
    expect(q<WtButton>(app, "start-again").disabled).toBe(false);
    await passwordAccepted(app);
    await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
    expect(q(app, "start-again-deletes").textContent!.trim()).toBe(
      `${t.heldLost} ${t.noInvoiceSent}`,
    );
    expect(q(app, "screen-first-owner").textContent).not.toContain(t.heldRowsOne);
  },
);

it("an empty setup database beside a stopped recovery says what Start again deletes and that no invoice was sent", async () => {
  const { app } = await stoppedPresent({ inspection: { emptyDatabase: true } });
  await passwordAccepted(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  const t = initialOwnerStrings.en;
  expect(q(app, "start-again-deletes").textContent!.trim()).toBe(
    `${t.heldLost} ${t.noInvoiceSent}`,
  );
});

it("a refused Start again from the held confirmation goes back to the password step, still signed in, with the reason shown", async () => {
  const { app, requests } = await stoppedPresent({
    inspection: { database: "occupied", emptyDatabase: false },
    summary: () => Response.json(heldSummary(105)),
    startAgain: (send) => (send === 0 ? refusal("setup.attempt_conflict", 409) : undefined),
  });
  await passwordAccepted(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
  await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
  await app.updateComplete;
  expect(formErrors(app)).toEqual([shellEn["shell.first_setup.attempt_conflict"]]);
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeDefined();
});

it.each(["en-GB", "es-ES"])(
  "a database holding records with no stopped recovery keeps Start again disabled and says why, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app, requests } = await stoppedPresent({
      inspection: { database: "occupied", emptyDatabase: false },
      activity: () => null,
    });
    setLocale(locale);
    await app.updateComplete;
    expect(app.shadowRoot!.querySelector("[data-test=recovery-stopped]")).toBeNull();
    expect(q<WtButton>(app, "start-again").disabled).toBe(true);
    expect(app.shadowRoot!.textContent).toContain(t.startUnavailableOccupied);
    expect(startAgainRequests(requests)).toEqual([]);
  },
);

it("saved trading settings beside a stopped recovery and a database holding records keep Start again disabled", async () => {
  const { app, requests } = await stoppedPresent({
    inspection: {
      database: "occupied",
      emptyDatabase: false,
      artifacts: [{ name: "trading.env", status: "present", digest: "c".repeat(64) }],
    },
  });
  await expect.poll(() => q(app, "recovery-stopped")).not.toBeNull();
  await app.updateComplete;
  expect(q<WtButton>(app, "start-again").disabled).toBe(true);
  expect(startAgainRequests(requests)).toEqual([]);
});

it.each(["en-GB", "es-ES"])(
  "a wrong password at the damaged-record password step keeps that step, shows the refusal and sends no Start again, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const shell = shellText(locale);
    const { app, requests } = await damagedRecord({ locale });
    await userEvent.fill(
      q<WtInput>(app, "resume-password").shadowRoot!.querySelector("input")!,
      "not the password",
    );
    await app.updateComplete;
    await click(app, "damaged-record-continue");
    await expect.poll(() => formErrors(app)).toEqual([shell["shell.first_setup.owner_required"]]);
    expect(q(app, "damaged-record-password").textContent).toBe(t.damagedRecordPassword);
    expect(q<WtInput>(app, "resume-password").value).toBe("");
    expect(app.shadowRoot!.querySelector("[data-test=recovery-record-damaged]")).toBeNull();
    expect(app.shadowRoot!.querySelector("[data-test=confirm-start-again]")).toBeNull();
    expect(
      requests
        .filter((r) => r.path.endsWith("/resolution/recover"))
        .map((r) => (r.body as { password: string }).password),
    ).toEqual(["not the password"]);
    expect(startAgainRequests(requests)).toHaveLength(1);

    await unlockDamagedRecord(app);
    expect(q(app, "recovery-record-damaged").textContent).toBe(t.recoveryRecordDamaged);
    expect(startAgainRequests(requests)).toHaveLength(1);
  },
);

it.each(["en-GB", "es-ES"])(
  "Continue at the damaged-record password step with no password asks for it and sends nothing, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app, requests } = await damagedRecord({ locale });
    await click(app, "damaged-record-continue");
    await expect.poll(() => formErrors(app)).toEqual([t.fix]);
    expect(q<WtButton>(app, "damaged-record-continue").disabled).toBe(true);
    expect(q(app, "damaged-record-password").textContent).toBe(t.damagedRecordPassword);
    expect(requests.some((r) => /\/(recover|resume)$/.test(r.path))).toBe(false);
    expect(startAgainRequests(requests)).toHaveLength(1);
  },
);

it.each([
  {
    name: "an answer the page cannot read",
    locale: "en-GB",
    answer: () => ({ state: "stopped" }),
    shown: (): string => initialOwnerStrings.en.recoveryDetailsUnread,
  },
  {
    name: "an answer the page cannot read, in Spanish",
    locale: "es-ES",
    answer: () => ({ state: "stopped" }),
    shown: (): string => initialOwnerStrings.es.recoveryDetailsUnread,
  },
  {
    name: "a refusal the page has words for",
    locale: "en-GB",
    answer: () => refusal("setup.recovery_in_progress", 409),
    shown: (): string => shellEn["shell.first_setup.recovery_in_progress"],
  },
])(
  "with the database present, an activity read after the password that fails with $name says so, reads no summary, and Check again reads both",
  async ({ locale, answer, shown }) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app, requests } = await stoppedPresent({
      activity: (read) => (read === 1 ? answer() : stoppedActivity()),
    });
    setLocale(locale);
    await app.updateComplete;
    const summaries = () => requests.filter((r) => r.path.endsWith("/start-again/summary"));
    await passwordAccepted(app);
    await expect.poll(() => formErrors(app)).toEqual([shown()]);
    expect(app.shadowRoot!.querySelector("[data-test=confirm-start-again]")).toBeNull();
    expect(app.shadowRoot!.querySelector("[data-test=damaged-record-password]")).toBeNull();
    expect(q(app, "check-again").textContent).toContain(t.checkAgain);
    expect(q(app, "cancel-damaged-record").textContent).toContain(t.cancel);
    expect(summaries()).toEqual([]);
    await click(app, "check-again");
    await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
    expect(summaries()).toHaveLength(1);
    expect(formErrors(app)).toEqual([""]);
    expect(startAgainRequests(requests)).toEqual([]);
  },
);

it("with the database present, a stopped recovery running again after the password, when the page's next activity read is refused, shows the refusal and offers only Reconnect, signed out, with nothing sent", async () => {
  const { app, requests } = await stoppedPresent({
    activity: (read) =>
      read === 0
        ? stoppedActivity()
        : read === 1
          ? { state: "running", ...stoppedAt }
          : refusal("setup.recovery_in_progress", 409),
  });
  await passwordAccepted(app);
  await expect
    .poll(() => formErrors(app))
    .toEqual([shellEn["shell.first_setup.recovery_in_progress"]]);
  expect(q(app, "reconnect-first")).not.toBeNull();
  for (const name of [
    "start-again",
    "resume-password",
    "damaged-record-password",
    "confirm-start-again",
    "check-again",
  ])
    expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  expect(requests.some((r) => r.path.endsWith("/start-again/summary"))).toBe(false);
  expect(startAgainRequests(requests)).toEqual([]);
});

it("with the database present, a refused Start again whose activity read fails still asks for the password, and claims no damaged record when no recovery is found after it", async () => {
  const { app, requests } = await stoppedPresent({
    activity: (read) => (read === 1 ? refusal("server.internal", 500) : null),
    passwordRequired: true,
  });
  await click(app, "start-again");
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
  expect(formErrors(app)).toEqual([""]);
  expect(startAgainRequests(requests)).toHaveLength(1);
  await password(app);
  await click(app, "damaged-record-continue");
  await expect.poll(() => app.shadowRoot!.querySelector("[data-test=resume]")).not.toBeNull();
  for (const name of [
    "recovery-record-damaged",
    "confirm-start-again",
    "damaged-record-password",
    "recovery-stopped",
  ])
    expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
  expect(q<WtButton>(app, "start-again").disabled).toBe(false);
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  expect(startAgainRequests(requests)).toHaveLength(1);
});

async function detailsUnread() {
  const fixture = await stoppedPresent({
    summary: (read) => (read === 0 ? refusal("setup.not_ready", 409) : undefined),
  });
  await passwordAccepted(fixture.app);
  await expect.poll(() => q(fixture.app, "check-again")).not.toBeNull();
  await fixture.app.updateComplete;
  return fixture;
}

it("with the database present, a second click on Check again while the first is reading sends no second read", async () => {
  const { app, requests } = await detailsUnread();
  const reads = (suffix: string) => requests.filter((r) => r.path.endsWith(suffix)).length;
  const activityReads = reads("/backup/activity");
  q(app, "check-again").dispatchEvent(new MouseEvent("click"));
  q(app, "check-again").dispatchEvent(new MouseEvent("click"));
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(reads("/backup/activity")).toBe(activityReads + 1);
  expect(reads("/start-again/summary")).toBe(2);
  expect(formErrors(app)).toEqual([""]);
});

it("with the database present, Cancel clicked while Check again is reading does nothing, and the confirmation is drawn when the read answers", async () => {
  let answer: (response: Response) => void = () => undefined;
  const { app, requests } = await stoppedPresent({
    summary: (read) =>
      read === 0
        ? refusal("setup.not_ready", 409)
        : read === 1
          ? new Promise<Response>((done) => (answer = done))
          : undefined,
  });
  await passwordAccepted(app);
  await expect.poll(() => q(app, "check-again")).not.toBeNull();
  const inspections = () =>
    requests.filter((r) => r.path.endsWith("/first-setup/resolution")).length;
  await click(app, "check-again");
  await expect
    .poll(() => requests.filter((r) => r.path.endsWith("/start-again/summary")))
    .toHaveLength(2);
  const before = inspections();
  q(app, "cancel-damaged-record").dispatchEvent(new MouseEvent("click"));
  answer(Response.json(stoppedSummary(false)));
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(inspections()).toBe(before);
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeDefined();
  expect(startAgainRequests(requests)).toEqual([]);
});

const running = { state: "running", ...stoppedAt };
it("with the database present, a tab closed while it reads the page again after the password starts no activity re-reads", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    let answer: (response: Response) => void = () => undefined;
    const { app, api, requests } = await stoppedPresent({
      activity: (read) =>
        read === 0
          ? stoppedActivity()
          : read === 2
            ? new Promise<Response>((done) => (answer = done))
            : running,
    });
    const activity = vi.spyOn(api, "firstSetupBackupActivity");
    const activityReads = () => requests.filter((r) => r.path.endsWith("/backup/activity")).length;
    await passwordAccepted(app);
    await expect.poll(activityReads).toBe(3);
    app.remove();
    answer(Response.json({ activity: running }));
    await activity.mock.results.at(-1)!.value;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(activityReads()).toBe(3);
  } finally {
    vi.useRealTimers();
  }
});

it("with the database present, a tab closed while a refused Start again reads the activity starts no activity re-reads", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    let answer: (response: Response) => void = () => undefined;
    const { app, api, requests } = await stoppedPresent({
      activity: (read) => (read === 1 ? new Promise<Response>((done) => (answer = done)) : null),
      passwordRequired: true,
    });
    const activity = vi.spyOn(api, "firstSetupBackupActivity");
    const activityReads = () => requests.filter((r) => r.path.endsWith("/backup/activity")).length;
    await click(app, "start-again");
    await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
    await app.updateComplete;
    await click(app, "confirm-start-again");
    await expect.poll(activityReads).toBe(2);
    app.remove();
    answer(Response.json({ activity: running }));
    await activity.mock.results.at(-1)!.value;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(activityReads()).toBe(2);
    expect(startAgainRequests(requests)).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

const DISK_FULL = {
  "en-GB":
    "The box's disk is full, so Waitron cannot save anything. Restart the box: as it starts, it removes old logs and crash reports to make room. Then try again. If the disk is still full, Waitron cannot free more space by itself. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards.",
  "es-ES":
    "El disco del equipo está lleno, así que Waitron no puede guardar nada. Reinicia el equipo: al arrancar, quita registros y avisos de fallo antiguos para hacer sitio. Después, vuelve a intentarlo. Si el disco sigue lleno, Waitron no puede liberar más espacio por sí solo. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.",
} as const;
const DISK_FULL_RESTART_FREES_NOTHING = {
  "en-GB":
    "The box's disk is full, so Waitron cannot save anything, and restarting the box frees no space. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards.",
  "es-ES":
    "El disco del equipo está lleno, así que Waitron no puede guardar nada, y reiniciar el equipo no libera espacio. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.",
} as const;
const DISK_FULL_RESTART_UNKNOWN = {
  "en-GB":
    "The box's disk is full, so Waitron cannot save anything. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards.",
  "es-ES":
    "El disco del equipo está lleno, así que Waitron no puede guardar nada. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.",
} as const;
const diskFull = (params: Record<string, unknown> = { restartDeletesLogs: true }) =>
  Response.json({ error: { code: "storage.disk_full", params } }, { status: 507 });

/** Opens the Start-again confirmation and confirms it. */
async function confirmStartAgain(app: SetupApp) {
  await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await userEvent.click(
    q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
  );
}

it.each(["en-GB", "es-ES"] as const)(
  "a Start again refused storage.disk_full where a restart deletes no logs says restarting frees no space, in %s",
  async (locale) => {
    const { app } = await mount({
      intercept(path) {
        if (path.endsWith("/start-again")) return diskFull({ restartDeletesLogs: false });
      },
    });
    setLocale(locale);
    await app.updateComplete;
    await confirmStartAgain(app);
    await expect.poll(() => formErrors(app)).toContain(DISK_FULL_RESTART_FREES_NOTHING[locale]);
  },
);

it.each(["en-GB", "es-ES"] as const)(
  "a full-disk answer without the field says nothing about restarting, in %s",
  async (locale) => {
    const { app } = await mount({
      intercept(path) {
        if (path.endsWith("/start-again")) return diskFull({});
      },
    });
    setLocale(locale);
    await app.updateComplete;
    await confirmStartAgain(app);
    await expect.poll(() => formErrors(app)).toContain(DISK_FULL_RESTART_UNKNOWN[locale]);
    expect(formErrors(app).join(" ")).not.toMatch(/restart/i);
    expect(formErrors(app).join(" ")).not.toMatch(/reinici/i);
  },
);

it.each(["en-GB", "es-ES"] as const)(
  "a Start again refused storage.disk_full says the disk is full, in %s",
  async (locale) => {
    const { app } = await mount({
      intercept(path) {
        if (path.endsWith("/start-again")) return diskFull();
      },
    });
    setLocale(locale);
    await app.updateComplete;
    await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
    await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
    await userEvent.click(
      q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
    );
    await expect.poll(() => formErrors(app)).toContain(DISK_FULL[locale]);
  },
);

it("with the database present, a summary read refused storage.disk_full says the disk is full", async () => {
  const { app } = await damagedRecord({
    damagedSummary: picksSummary(false),
    summaryRefused: true,
    summaryRefusedCode: "storage.disk_full",
  });
  await password(app);
  await click(app, "damaged-record-continue");
  await expect.poll(() => formErrors(app)).toContain(DISK_FULL["en-GB"]);
  expect(app.shadowRoot!.querySelector("[data-test=confirm-start-again]")).toBeNull();
});

it("with the database present, a stopped recovery's summary read refused storage.disk_full keeps the server's word on restarting", async () => {
  const { app } = await stoppedPresent({
    summary: (read) => (read === 0 ? diskFull({ restartDeletesLogs: false }) : undefined),
  });
  await passwordAccepted(app);
  await expect.poll(() => formErrors(app)).toContain(DISK_FULL_RESTART_FREES_NOTHING["en-GB"]);
});

it("with the database present, a summary read refused storage.disk_full without the field says nothing about restarting", async () => {
  const { app } = await damagedRecord({
    damagedSummary: picksSummary(false),
    summaryRefused: true,
    summaryRefusedCode: "storage.disk_full",
    summaryRefusedParams: {},
  });
  await password(app);
  await click(app, "damaged-record-continue");
  await expect.poll(() => formErrors(app)).toContain(DISK_FULL_RESTART_UNKNOWN["en-GB"]);
});

it("a damaged record's Start again refused storage.disk_full says the disk is full and goes back to the password", async () => {
  const { app, requests } = await damagedRecord({
    refuseFlagged: 1,
    refuseCode: "storage.disk_full",
  });
  await unlockDamagedRecord(app);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => formErrors(app)).toContain(DISK_FULL["en-GB"]);
  await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
  expect(startAgainRequests(requests)).toHaveLength(2);
});

it("the password step refused storage.disk_full says the disk is full", async () => {
  const { app } = await mount({
    intercept(path) {
      if (path.endsWith("/resolution/recover")) return diskFull();
    },
  });
  await password(app);
  await userEvent.click(q<WtButton>(app, "resume").shadowRoot!.querySelector("button")!);
  await expect.poll(() => formErrors(app)).toContain(DISK_FULL["en-GB"]);
});

it("the repair page's inspection read refused storage.disk_full says the disk is full", async () => {
  const { api } = wizardApi({
    claimed: true,
    intercept(path) {
      if (path.endsWith("/resolution")) return diskFull();
    },
  });
  const { el: app } = await mountWidget<SetupApp>("setup-app", { api });
  await expect.poll(() => q(app, "screen-first-owner")).not.toBeNull();
  await expect.poll(() => formErrors(app)).toContain(DISK_FULL["en-GB"]);
});

it("a connection check refused storage.disk_full keeps the connection-failure words and stays on its screen", async () => {
  const { api } = wizardApi({
    intercept(path) {
      if (path === "/setup-api/status") return diskFull();
    },
  });
  const { el: app } = await mountWidget<SetupApp>("setup-app", { api });
  const screen = () => q<HTMLElement & { errorMessage?: string }>(app, "screen-connection");
  await expect.poll(() => screen()?.errorMessage).toBe(shellEn["shell.connection.server_problem"]);
  expect(q(app, "screen-first-owner")).toBeNull();
});
