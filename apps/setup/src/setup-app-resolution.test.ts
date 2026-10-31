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
import { refusedCause } from "../test/held-database-browser.js";
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
      if (path.endsWith("/start-again/summary")) return Response.json({ reached: "named" });
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
/** Start again's confirmation is drawn once the box has said what Start again would delete. */
async function openStartAgain(app: SetupApp) {
  await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
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
  await openStartAgain(app);
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
  expect(en.recoverDeletes).toBe(
    "Recover from backup first deletes what was entered in the setup that stopped part way.",
  );
  expect(es.recoverDeletes).toBe(
    "Recuperar desde una copia primero borra lo que se introdujo en la configuración que se detuvo a medias.",
  );
  expect(en.recoverThen).toBe("Then you choose the backup.");
  expect(es.recoverThen).toBe("Después eliges la copia.");
  expect(`${en.recoverDeletes} ${en.noInvoiceSent} ${en.recoverThen}`).toBe(
    "Recover from backup first deletes what was entered in the setup that stopped part way. No invoice was sent to AEAT. Then you choose the backup.",
  );
  expect(`${es.recoverDeletes} ${es.noInvoiceSent} ${es.recoverThen}`).toBe(
    "Recuperar desde una copia primero borra lo que se introdujo en la configuración que se detuvo a medias. No se envió ninguna factura a la AEAT. Después eliges la copia.",
  );
  expect(en.retireRecover).toBe("Delete the old attempt and recover from a backup.");
  expect(es.retireRecover).toBe("Borrar el intento anterior y recuperar desde una copia.");
  expect(en.recoveryStoppedRecover).toBe(
    "A recovery from backup started on {started} and did not finish. Recover from backup deletes it first.",
  );
  expect(es.recoveryStoppedRecover).toBe(
    "Una recuperación desde una copia, iniciada el {started}, no terminó. Recuperar desde una copia la borra primero.",
  );
  for (const strings of [en, es])
    for (const key of [
      "heldNoInvoices",
      "heldNoInvoicesOne",
      "heldRows",
      "heldRowsOne",
      "heldKept",
      "heldKeptOne",
      "heldInvoices",
      "heldInvoiceOne",
      "heldFault",
      "startUnavailable",
      "startUnavailableOccupied",
      "damagedRecordPassword",
    ])
      expect(Object.hasOwn(strings, key)).toBe(false);
  expect(en.keptFault).toBe(
    "The setup database holds records that Waitron never deletes. An unfinished setup should hold none, so this is a fault in Waitron. Deleting this setup is not offered. Reconnect keeps everything as it is.",
  );
  expect(es.keptFault).toBe(
    "La base de datos de configuración guarda registros que Waitron nunca borra. Una configuración sin terminar no debería tener ninguno, así que es un fallo de Waitron. No se ofrece borrar esta configuración. Reconectar lo deja todo como está.",
  );
  expect(en.tradingSaved).toBe(
    "This setup already saved the settings the box sells with, so deleting it is not offered.",
  );
  expect(es.tradingSaved).toBe(
    "Esta configuración ya guardó los ajustes con los que vende el equipo, así que no se ofrece borrarla.",
  );
  expect(en.tradingSavedPassword).toBe("To finish it, continue with your setup password.");
  expect(es.tradingSavedPassword).toBe(
    "Para terminarla, continúa con tu contraseña de configuración.",
  );
  expect(en.setupFinished).toBe(
    "This setup already finished, so deleting it is not offered. Reconnect to check the saved result.",
  );
  expect(es.setupFinished).toBe(
    "Esta configuración ya terminó, así que no se ofrece borrarla. Reconecta para comprobar el resultado guardado.",
  );
  expect(en.wipeUnavailable).toBe(
    "This box cannot confirm that deleting this setup is safe, so it is not offered. Reconnect keeps everything as it is.",
  );
  expect(es.wipeUnavailable).toBe(
    "Este equipo no puede confirmar que borrar esta configuración sea seguro, así que no se ofrece. Reconectar lo deja todo como está.",
  );
  expect(en.heldChanged).toBe("The setup changed after this page read it. Try again.");
  expect(es.heldChanged).toBe(
    "La configuración cambió después de que esta página la leyera. Inténtalo otra vez.",
  );
  expect(en.setupDatabaseUnreadable).toBe("The previous setup process was unsuccessful.");
  expect(es.setupDatabaseUnreadable).toBe("El proceso de configuración anterior no tuvo éxito.");
  expect(en.uncheckable).toBe(
    "This box cannot check the original setup password, so Continue is not offered.",
  );
  expect(es.uncheckable).toBe(
    "Este equipo no puede comprobar la contraseña original de configuración, así que no se ofrece Continuar.",
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
    await openStartAgain(app);
    const section = q<HTMLElement>(app, "screen-first-owner");
    expect(q(app, "start-again-deletes").textContent!.trim()).toBe(
      `${t.heldLost} ${t.noInvoiceSent}`,
    );
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
    expect(requests.filter((r) => r.path.endsWith("/start-again"))).toHaveLength(1);
  },
);

it.each(["en-GB", "es-ES"])(
  "with an empty setup database, the confirmation says what Start again deletes and that no invoice was sent, above the tick box, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app } = await mount();
    setLocale(locale);
    await app.updateComplete;
    await openStartAgain(app);
    const deletes = q(app, "start-again-deletes");
    expect(deletes.textContent!.trim()).toBe(`${t.heldLost} ${t.noInvoiceSent}`);
    expect(
      deletes.compareDocumentPosition(q(app, "retire-confirmed")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
);

it.each(["occupied", "unknown", "corrupt"] as const)(
  "offers Start again beside a %s database, and asks the box what it deletes only on pressing",
  async (database) => {
    const { app, requests } = await mount({ inspection: { database, emptyDatabase: false } });
    expect(q<WtButton>(app, "start-again").disabled).toBe(false);
    expect(q<WtButton>(app, "resume").disabled).toBe(false);
    expect(requests.some((r) => r.path.endsWith("/start-again/summary"))).toBe(false);
    await openStartAgain(app);
    expect(requests.filter((r) => r.path.endsWith("/start-again/summary"))).toHaveLength(1);
    expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  },
);

it("offers Start again beside a missing database, and pressing it draws what the setup reached", async () => {
  const { app, requests } = await mount({
    inspection: { database: "missing", emptyDatabase: false },
    intercept(path) {
      if (path.endsWith("/backup/status"))
        return Response.json({ phase: "unstarted", proofRequired: true });
    },
  });
  expect(q<WtButton>(app, "start-again").disabled).toBe(false);
  expect(q(app, "resume")).toBeNull();
  expect(requests.some((r) => r.path.endsWith("/start-again/summary"))).toBe(false);
  await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
  await expect.poll(() => q(app, "missing-reached")).not.toBeNull();
  expect(requests.filter((r) => r.path.endsWith("/start-again/summary"))).toHaveLength(1);
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
});

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
  expect(app.shadowRoot!.textContent).toContain(initialOwnerStrings.en.wipeUnavailable);
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
  await openStartAgain(app);
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
  await openStartAgain(app);
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
        return Response.json({ error: { code: "server.internal", params: {} } }, { status: 500 });
    },
  });
  await openStartAgain(app);
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
  await openStartAgain(app);
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
    await openStartAgain(app);
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
const startAgainRequests = <R extends { path: string }>(requests: R[]) =>
  requests.filter((r) => r.path.endsWith("/resolution/start-again"));
const summaryRequests = <R extends { path: string }>(requests: R[]) =>
  requests.filter((r) => r.path.endsWith("/start-again/summary"));
const formErrors = (app: SetupApp) =>
  [...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions")].map(
    (f) => f.error,
  );
/** A damaged recovery-key record, as the box's summary says it, with Start again's confirmation open. */
async function damagedRecord(
  options: {
    locale?: string;
    /** Merged into every inspection read after the first send. */
    inspectionAfterSend?: Partial<FirstSetupInspection>;
    /** How many sends the box refuses `setup.attempt_conflict`. */
    refuseFlagged?: number;
  } = {},
) {
  let refusals = options.refuseFlagged ?? 0;
  let sent = false;
  const fixture = await mount({
    intercept(path) {
      if (path.endsWith("/backup/status"))
        return Response.json({ phase: "unstarted", proofRequired: true });
      if (path.endsWith("/start-again/summary"))
        return Response.json({ reached: "named", recoveryRecordDamaged: true });
      if (path.endsWith("/resolution/start-again")) {
        sent = true;
        if (refusals > 0) {
          refusals -= 1;
          return Response.json(
            { error: { code: "setup.attempt_conflict", params: {} } },
            { status: 409 },
          );
        }
      }
      if (path.endsWith("/resolution") && sent && options.inspectionAfterSend)
        return Response.json({ ...inspection, ...options.inspectionAfterSend });
    },
  });
  if (options.locale) {
    setLocale(options.locale);
    await fixture.app.updateComplete;
  }
  await openStartAgain(fixture.app);
  return fixture;
}
async function confirmDamagedRecord(app: SetupApp) {
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await userEvent.click(
    q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
  );
}
async function cancelAtWarning() {
  const fixture = await damagedRecord();
  await userEvent.click(
    q<WtButton>(fixture.app, "cancel-start-again").shadowRoot!.querySelector("button")!,
  );
  await fixture.app.updateComplete;
  return fixture;
}

it.each(["en-GB", "es-ES"])(
  "a damaged recovery-key record's warning is shown above what Start again deletes, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app, requests } = await damagedRecord({ locale });
    await app.updateComplete;
    const warning = q(app, "recovery-record-damaged");
    expect(warning.textContent).toBe(t.recoveryRecordDamaged);
    expect(
      warning.compareDocumentPosition(q(app, "start-again-deletes")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(q(app, "start-again-deletes").textContent!.trim()).toBe(
      `${t.heldLost} ${t.noInvoiceSent}`,
    );
    expect(q<HTMLInputElement>(app, "retire-confirmed").checked).toBe(false);
    expect(q<HTMLInputElement>(app, "retire-confirmed").closest("label")!.textContent).toBe(
      t.retireConfirmed,
    );
    expect(q(app, "cancel-start-again")).not.toBeNull();
    expect(q<WtButton>(app, "confirm-start-again").disabled).toBe(true);
    expect(startAgainRequests(requests)).toHaveLength(0);
  },
);

it("confirming sends the warning flag, with no owner header", async () => {
  const { app, requests } = await damagedRecord();
  await confirmDamagedRecord(app);
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
  const sent = startAgainRequests(requests)[0]!;
  expect(sent.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 1,
    ownerGeneration: 1,
    recoveryRecordDamagedShown: true,
  });
  expect(sent.headers.has(ownerHeader)).toBe(false);
  await expect.poll(() => app.shadowRoot!.textContent).toContain(initialOwnerStrings.en.restarting);
});

it("Cancel at the warning sends nothing", async () => {
  const { app, requests } = await damagedRecord();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await userEvent.click(
    q<WtButton>(app, "cancel-start-again").shadowRoot!.querySelector("button")!,
  );
  await app.updateComplete;
  expect(q(app, "recovery-record-damaged")).toBeNull();
  expect(q(app, "confirm-start-again")).toBeNull();
  expect(startAgainRequests(requests)).toHaveLength(0);
});

it("Cancel at the warning lands on the page as it was, and Start again from there reads the box again and goes straight to the warning", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await cancelAtWarning();
  expect(app.shadowRoot!.querySelector("h1")!.textContent).toBe(t.interrupted);
  expect(q<WtButton>(app, "start-again").disabled).toBe(false);
  expect(q(app, "recover-backup")).not.toBeNull();
  expect(q<WtButton>(app, "resume")).not.toBeNull();
  expect(q<WtInput>(app, "resume-password").value).toBe("");
  expect(q(app, "abandon-attempt")).toBeNull();
  expect(summaryRequests(requests)).toHaveLength(1);

  await openStartAgain(app);
  expect(summaryRequests(requests)).toHaveLength(2);
  expect(q(app, "recovery-record-damaged").textContent).toBe(t.recoveryRecordDamaged);
  expect(q<HTMLInputElement>(app, "retire-confirmed").checked).toBe(false);
  await confirmDamagedRecord(app);
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
  const sent = startAgainRequests(requests)[0]!;
  expect(sent.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 1,
    ownerGeneration: 1,
    recoveryRecordDamagedShown: true,
  });
  expect(sent.headers.has(ownerHeader)).toBe(false);
  expect(requests.some((r) => /\/(recover|resume)$/.test(r.path))).toBe(false);
  await expect.poll(() => app.shadowRoot!.textContent).toContain(t.restarting);
});

it("a Start again on a readable record asks for no password and sends no damaged flag", async () => {
  const { app, requests } = await mount();
  await openStartAgain(app);
  expect(q(app, "recovery-record-damaged")).toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await userEvent.click(
    q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => app.shadowRoot!.textContent).toContain(initialOwnerStrings.en.restarting);
  expect(startAgainRequests(requests)).toHaveLength(1);
  expect(startAgainRequests(requests)[0]!.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 1,
    ownerGeneration: 1,
  });
  expect(requests.some((r) => /\/(recover|resume)$/.test(r.path))).toBe(false);
});

it("the warning step draws neither Abandon nor Enter new setup details", async () => {
  const t = initialOwnerStrings.en;
  const { app } = await damagedRecord();
  expect(q(app, "abandon-attempt")).toBeNull();
  expect(q(app, "replace-attempt")).toBeNull();
  expect(app.shadowRoot!.textContent).not.toContain(t.abandon);
  expect(app.shadowRoot!.textContent).not.toContain(t.replace);
});

it.each([
  { name: "holding records", after: { database: "occupied", emptyDatabase: false } },
  { name: "missing", after: { database: "missing", emptyDatabase: false } },
] as const)(
  "a refused Start again at the warning closes it and says the setup changed; Start again then reads the page as it now is, with the database $name",
  async ({ name, after }) => {
    const { app, requests } = await damagedRecord({
      refuseFlagged: 1,
      inspectionAfterSend: after,
    });
    await confirmDamagedRecord(app);
    await expect.poll(() => formErrors(app)).toContain(initialOwnerStrings.en.heldChanged);
    for (const test of ["recovery-record-damaged", "confirm-start-again", "abandon-attempt"])
      expect(app.shadowRoot!.querySelector(`[data-test=${test}]`), test).toBeNull();
    expect(app.shadowRoot!.querySelector("h1")!.textContent).toBe(
      initialOwnerStrings.en.interrupted,
    );
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
    expect(startAgainRequests(requests)).toHaveLength(1);
    await userEvent.click(q<WtButton>(app, "start-again").shadowRoot!.querySelector("button")!);
    if (name === "missing") await expect.poll(() => q(app, "missing-reached")).not.toBeNull();
    else await expect.poll(() => q(app, "recovery-record-damaged")).not.toBeNull();
    expect(startAgainRequests(requests)).toHaveLength(1);
  },
);

const damagedSteps = {
  "the warning": () => damagedRecord(),
  "the page after Cancel at the warning": () => cancelAtWarning(),
};
it.each(Object.keys(damagedSteps) as (keyof typeof damagedSteps)[])(
  "Reconnect from %s lands on the page as it is, signed out, with Start again offered",
  async (step) => {
    const t = initialOwnerStrings.en;
    const { app } = await damagedSteps[step]();
    await click(app, "reconnect-first");
    await expect.poll(() => app.shadowRoot!.querySelector("[data-test=resume]")).not.toBeNull();
    await expect
      .poll(() => app.shadowRoot!.querySelector<WtButton>("[data-test=start-again]")?.disabled)
      .toBe(false);
    expect(app.shadowRoot!.querySelector("h1")!.textContent).toBe(t.interrupted);
    for (const name of ["confirm-start-again", "abandon-attempt", "replace-attempt"])
      expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
    expect(app.shadowRoot!.textContent).not.toContain(t.retired);
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  },
);

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
/** Read on pressing Start again, so it is later than the activity read when the page loaded. */
const summaryLastActiveAt = new Date(2026, 9, 25, 14, 47).toISOString();
const stoppedSummary = (damaged: boolean) => ({
  reached: "claimed",
  ...(damaged ? { recoveryRecordDamaged: true } : {}),
  recovery: {
    startedAt: stoppedAt.startedAt,
    lastActiveAt: summaryLastActiveAt,
    lastActiveSource: "memory",
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
    /** Merged into every inspection read. */
    inspection?: Partial<FirstSetupInspection>;
    /** The answer to each Start again, counted from 0; the default answer when undefined. */
    startAgain?: (send: number) => Response | undefined;
  } = {},
) {
  let startAgainSends = 0;
  let activityReads = 0;
  let summaryReads = 0;
  const fixture = await mount({
    intercept(path) {
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
      if (path.endsWith("/resolution"))
        return Response.json({ ...inspection, ...options.inspection });
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
/** Start again reads the inspection, the activity and the summary before it draws anything. */
const pressStartAgain = (app: SetupApp) => click(app, "start-again");

it("with the database present and a stopped recovery: the stopped line, then the confirmation; nothing is sent before the tick and Confirm", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await stoppedPresent();
  const sentNothing = () => expect(startAgainRequests(requests)).toEqual([]);
  expect(stoppedLines(app)).toEqual([
    t.recoveryStopped.replace("{started}", "25 Oct 2026, 14:35"),
    t.recoveryLastActive.replace("{at}", "25 Oct 2026, 14:41"),
  ]);
  await pressStartAgain(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(app.shadowRoot!.querySelector("[data-test=recovery-record-damaged]")).toBeNull();
  // The confirmation is drawn from the summary read on pressing, not the earlier activity.
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
    revision: 1,
    ownerGeneration: 1,
    confirmRecoveryDiscard: { shown: stoppedSummary(false) },
  });
  expect(sent.headers.has(ownerHeader)).toBe(false);
  await expect.poll(() => app.shadowRoot!.textContent).toContain(t.restarting);
});

it("with the database present, a damaged record and a stopped recovery: both lines are drawn before Confirm, and the request carries both keys", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await stoppedPresent({ damaged: true });
  await pressStartAgain(app);
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
    revision: 1,
    ownerGeneration: 1,
    confirmRecoveryDiscard: { shown: stoppedSummary(true) },
    recoveryRecordDamagedShown: true,
  });
});

it("with the database present, while a recovery runs, no Start again, password or confirmation is offered and nothing is sent", async () => {
  const { app, requests } = await stoppedPresent({ running: true });
  for (const name of ["start-again", "resume-password", "confirm-start-again", "recovery-stopped"])
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

it("with the database present, a recovery that stopped after the page loaded is drawn from the reads on pressing Start again: no damaged warning, and no damaged flag sent", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await stoppedPresent({
    activity: (read) => (read === 0 ? null : stoppedActivity()),
  });
  expect(app.shadowRoot!.querySelector("[data-test=recovery-stopped]")).toBeNull();
  await pressStartAgain(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(app.shadowRoot!.querySelector("[data-test=recovery-record-damaged]")).toBeNull();
  expect(stoppedLines(app)).toEqual([
    t.recoveryStopped.replace("{started}", "25 Oct 2026, 14:35"),
    t.recoveryLastActive.replace("{at}", "25 Oct 2026, 14:47"),
  ]);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
  expect(startAgainRequests(requests)[0]!.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 1,
    ownerGeneration: 1,
    confirmRecoveryDiscard: { shown: stoppedSummary(false) },
  });
});

it("with the database present, a stopped recovery that runs again by the time Start again is pressed is drawn as running, signed out, and nothing is sent", async () => {
  const { app, requests } = await stoppedPresent({
    activity: (read) => (read === 0 ? stoppedActivity() : { state: "running", ...stoppedAt }),
  });
  await pressStartAgain(app);
  await expect
    .poll(() => app.shadowRoot!.querySelector("[data-test=recovery-running]"))
    .not.toBeNull();
  for (const name of ["confirm-start-again", "start-again", "abandon-attempt"])
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
    answer: () => refusal("server.internal", 500),
    shown: () => initialOwnerStrings.en.recoveryDetailsUnread,
  },
  {
    name: "a refusal the page has no words for, in Spanish",
    locale: "es-ES",
    answer: () => refusal("server.internal", 500),
    shown: () => initialOwnerStrings.es.recoveryDetailsUnread,
  },
  {
    name: "a refusal the page has words for",
    locale: "en-GB",
    answer: () => refusal("setup.recovery_in_progress", 409),
    shown: () => shellEn["shell.first_setup.recovery_in_progress"],
  },
])(
  "with the database present, a summary read on pressing Start again that fails with $name says so, and Check again reads it again",
  async ({ locale, answer, shown }) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const shell = shellText(locale);
    const { app, requests } = await stoppedPresent({
      summary: (read) => (read === 0 ? answer() : undefined),
    });
    setLocale(locale);
    await app.updateComplete;
    await pressStartAgain(app);
    await expect.poll(() => formErrors(app).filter(Boolean)).toEqual([shown()]);
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
    expect(formErrors(app).filter(Boolean)).toEqual([]);
    expect(startAgainRequests(requests)).toEqual([]);
  },
);

it("with the database present, a summary read on pressing Start again that names no recovery is drawn as the box says it: no stopped line, and Confirm sends no recovery discard", async () => {
  const { app, requests } = await stoppedPresent({
    summary: () => Response.json({ reached: "claimed" }),
  });
  await pressStartAgain(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(app.shadowRoot!.querySelector("[data-test=recovery-stopped]")).toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
  expect(startAgainRequests(requests)[0]!.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 1,
    ownerGeneration: 1,
  });
});

it("with the database present, Cancel after a failed summary read returns to the stopped recovery, signed out", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await stoppedPresent({
    summary: (read) => (read === 0 ? refusal("server.internal", 500) : undefined),
  });
  await pressStartAgain(app);
  await expect.poll(() => q(app, "check-again")).not.toBeNull();
  await click(app, "cancel-start-again");
  await expect
    .poll(() => app.shadowRoot!.querySelector<WtButton>("[data-test=start-again]")?.disabled)
    .toBe(false);
  expect(stoppedLines(app)[0]).toBe(t.recoveryStopped.replace("{started}", "25 Oct 2026, 14:35"));
  expect(q(app, "resume")).not.toBeNull();
  for (const name of ["abandon-attempt", "check-again", "recover-backup", "confirm-start-again"])
    expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
  expect(formErrors(app)).toEqual([""]);
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();

  await pressStartAgain(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(requests.filter((r) => r.path.endsWith("/start-again/summary"))).toHaveLength(2);
  expect(requests.some((r) => r.path.endsWith("/resolution/recover"))).toBe(false);
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
  await pressStartAgain(app);
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
  expect(requests.some((r) => r.path.endsWith("/resolution/recover"))).toBe(false);
  expect(startAgainRequests(requests)).toEqual([]);
});

it("with the database present, a stopped recovery gone by the time Start again is pressed: the confirmation names no recovery and no damaged record, signed out, and nothing is sent", async () => {
  const { app, requests } = await stoppedPresent({
    activity: (read) => (read === 0 ? stoppedActivity() : null),
    summary: () => Response.json({ reached: "claimed" }),
  });
  await pressStartAgain(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  for (const name of ["recovery-stopped", "recovery-record-damaged", "abandon-attempt"])
    expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  expect(startAgainRequests(requests)).toEqual([]);
});

it("with the database present, a recovery that stops between the confirmation and Confirm sends nothing: the confirmation closes, says the setup changed, and Start again reads the box again", async () => {
  let stopped = false;
  const { app, requests } = await stoppedPresent({
    activity: () => (stopped ? stoppedActivity() : null),
    summary: () => (stopped ? undefined : Response.json({ reached: "claimed" })),
  });
  await pressStartAgain(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  stopped = true;
  await click(app, "confirm-start-again");
  await expect.poll(() => formErrors(app)).toContain(initialOwnerStrings.en.heldChanged);
  for (const name of ["recovery-record-damaged", "confirm-start-again"])
    expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
  expect(q<WtButton>(app, "start-again").disabled).toBe(false);
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  expect(startAgainRequests(requests)).toHaveLength(0);
  await pressStartAgain(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(q(app, "recovery-stopped")).not.toBeNull();
});

it("with the database present, while Check again reads after a failed summary, the stopped line and both buttons stay drawn, disabled", async () => {
  let answer: (response: Response) => void = () => undefined;
  const { app, requests } = await stoppedPresent({
    summary: (read) =>
      read === 0
        ? refusal("server.internal", 500)
        : read === 1
          ? new Promise<Response>((done) => (answer = done))
          : undefined,
  });
  await pressStartAgain(app);
  await expect.poll(() => q(app, "check-again")).not.toBeNull();
  await click(app, "check-again");
  await expect
    .poll(() => requests.filter((r) => r.path.endsWith("/start-again/summary")))
    .toHaveLength(2);
  await app.updateComplete;
  expect(q<WtButton>(app, "check-again").disabled).toBe(true);
  expect(q(app, "recovery-stopped")).not.toBeNull();
  expect(q<WtButton>(app, "cancel-start-again").disabled).toBe(true);
  answer(Response.json(stoppedSummary(false)));
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
});

it.each(["en-GB", "es-ES"])(
  "with the database present and holding records beside a stopped recovery, Start again is offered and, once pressed, says what Start again deletes and that no invoice was sent, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app, requests } = await stoppedPresent({
      inspection: { database: "occupied", emptyDatabase: false },
    });
    setLocale(locale);
    await expect.poll(() => q(app, "recovery-stopped")).not.toBeNull();
    await app.updateComplete;
    expect(q<WtButton>(app, "start-again").disabled).toBe(false);
    expect(app.shadowRoot!.querySelector("[data-test=start-again-refused]")).toBeNull();
    expect(app.shadowRoot!.textContent).not.toContain(t.wipeUnavailable);
    await pressStartAgain(app);
    await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
    expect(q(app, "start-again-deletes").textContent!.trim()).toBe(
      `${t.heldLost} ${t.noInvoiceSent}`,
    );
    expect(q(app, "recovery-stopped").textContent).toContain(
      t.recoveryStopped.split("{started}")[1]!,
    );
    const order = [
      q(app, "start-again-deletes"),
      q(app, "recovery-stopped"),
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
      revision: 1,
      ownerGeneration: 1,
      confirmRecoveryDiscard: { shown: stoppedSummary(false) },
    });
    expect(startAgainRequests(requests)[0]!.headers.has(ownerHeader)).toBe(false);
    await expect.poll(() => app.shadowRoot!.textContent).toContain(t.restarting);
  },
);

it.each(["en-GB", "es-ES"])(
  "a setup database holding rows in a table other than the venue's is offered Start again, with the same words, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app } = await stoppedPresent({
      inspection: { database: "no-venue-rows", emptyDatabase: false },
    });
    setLocale(locale);
    await app.updateComplete;
    expect(q<WtButton>(app, "start-again").disabled).toBe(false);
    await pressStartAgain(app);
    await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
    expect(q(app, "start-again-deletes").textContent!.trim()).toBe(
      `${t.heldLost} ${t.noInvoiceSent}`,
    );
  },
);

it("an empty setup database beside a stopped recovery says what Start again deletes and that no invoice was sent", async () => {
  const { app } = await stoppedPresent({ inspection: { emptyDatabase: true } });
  await pressStartAgain(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  const t = initialOwnerStrings.en;
  expect(q(app, "start-again-deletes").textContent!.trim()).toBe(
    `${t.heldLost} ${t.noInvoiceSent}`,
  );
});

it("a refused Start again from the held confirmation closes it and says the setup changed, with Start again offered again and nobody signed in", async () => {
  const { app, requests } = await stoppedPresent({
    inspection: { database: "occupied", emptyDatabase: false },
    startAgain: (send) => (send === 0 ? refusal("setup.attempt_conflict", 409) : undefined),
  });
  await pressStartAgain(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
  await expect
    .poll(() => formErrors(app).filter(Boolean))
    .toEqual([initialOwnerStrings.en.heldChanged]);
  expect(app.shadowRoot!.querySelector("[data-test=confirm-start-again]")).toBeNull();
  expect(q<WtButton>(app, "start-again").disabled).toBe(false);
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  expect(requests.some((r) => r.path.endsWith("/resolution/recover"))).toBe(false);
});

it.each(["en-GB", "es-ES"])(
  "a database holding records with no stopped recovery offers Start again, and pressing it draws the confirmation with nothing sent, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app, requests } = await stoppedPresent({
      inspection: { database: "occupied", emptyDatabase: false },
      activity: () => null,
      summary: () => Response.json({ reached: "claimed" }),
    });
    setLocale(locale);
    await app.updateComplete;
    expect(app.shadowRoot!.querySelector("[data-test=recovery-stopped]")).toBeNull();
    expect(q<WtButton>(app, "start-again").disabled).toBe(false);
    expect(app.shadowRoot!.querySelector("[data-test=start-again-refused]")).toBeNull();
    await pressStartAgain(app);
    await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
    expect(q(app, "start-again-deletes").textContent!.trim()).toBe(
      `${t.heldLost} ${t.noInvoiceSent}`,
    );
    expect(startAgainRequests(requests)).toEqual([]);
  },
);

it("saved trading settings beside a stopped recovery and a database holding records offer Start again, and pressing it draws the box's refusal with nothing sent", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await stoppedPresent({
    inspection: {
      database: "occupied",
      emptyDatabase: false,
      artifacts: [{ name: "trading.env", status: "present", digest: "c".repeat(64) }],
    },
    summary: () => refusedCause("trading-settings"),
  });
  await expect.poll(() => q(app, "recovery-stopped")).not.toBeNull();
  await app.updateComplete;
  expect(q<WtButton>(app, "start-again").disabled).toBe(false);
  expect(app.shadowRoot!.textContent).not.toContain(t.tradingSaved);
  await pressStartAgain(app);
  await expect
    .poll(() => q(app, "start-again-refused")?.textContent)
    .toBe(`${t.tradingSaved} ${t.tradingSavedPassword}`);
  expect(app.shadowRoot!.querySelector("[data-test=start-again]")).toBeNull();
  expect(app.shadowRoot!.querySelector("[data-test=confirm-start-again]")).toBeNull();
  expect(startAgainRequests(requests)).toEqual([]);
});

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
  "with the database present, an activity read on pressing Start again that fails with $name says so, reads no summary, and Check again reads both",
  async ({ locale, answer, shown }) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app, requests } = await stoppedPresent({
      activity: (read) => (read === 1 ? answer() : stoppedActivity()),
    });
    setLocale(locale);
    await app.updateComplete;
    await pressStartAgain(app);
    await expect.poll(() => formErrors(app).filter(Boolean)).toEqual([shown()]);
    expect(app.shadowRoot!.querySelector("[data-test=confirm-start-again]")).toBeNull();
    expect(q(app, "check-again").textContent).toContain(t.checkAgain);
    expect(q(app, "cancel-start-again").textContent).toContain(t.cancel);
    expect(summaryRequests(requests)).toEqual([]);
    await click(app, "check-again");
    await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
    expect(summaryRequests(requests)).toHaveLength(1);
    expect(formErrors(app).filter(Boolean)).toEqual([]);
    expect(startAgainRequests(requests)).toEqual([]);
  },
);

it("with the database present, a stopped recovery running again when Start again is pressed keeps the running view when the next activity read is refused, offering only Reconnect, signed out, with nothing sent", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { app, requests } = await stoppedPresent({
      activity: (read) =>
        read === 0
          ? stoppedActivity()
          : read === 1
            ? { state: "running", ...stoppedAt }
            : refusal("setup.recovery_in_progress", 409),
    });
    const activityReads = () => requests.filter((r) => r.path.endsWith("/backup/activity")).length;
    await pressStartAgain(app);
    await expect
      .poll(() => app.shadowRoot!.querySelector("[data-test=recovery-running]"))
      .not.toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect.poll(activityReads).toBe(3);
    await app.updateComplete;
    expect(q(app, "recovery-running")).not.toBeNull();
    expect(q(app, "reconnect-first")).not.toBeNull();
    for (const name of ["start-again", "resume-password", "confirm-start-again", "check-again"])
      expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
    expect(summaryRequests(requests)).toEqual([]);
    expect(startAgainRequests(requests)).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("with the database present and no recovery, an activity read on pressing Start again that fails says so and claims no damaged record or stopped recovery; Start again reads the box again", async () => {
  const { app, requests } = await stoppedPresent({
    activity: (read) => (read === 1 ? refusal("server.internal", 500) : null),
    summary: () => Response.json({ reached: "claimed" }),
  });
  await pressStartAgain(app);
  await expect.poll(() => formErrors(app).filter(Boolean)).toEqual([initialOwnerStrings.en.error]);
  for (const name of [
    "recovery-record-damaged",
    "confirm-start-again",
    "recovery-stopped",
    "check-again",
  ])
    expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
  expect(q<WtButton>(app, "start-again").disabled).toBe(false);
  expect(summaryRequests(requests)).toEqual([]);
  await pressStartAgain(app);
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  for (const name of ["recovery-record-damaged", "recovery-stopped"])
    expect(app.shadowRoot!.querySelector(`[data-test=${name}]`), name).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  expect(startAgainRequests(requests)).toEqual([]);
});

async function detailsUnread() {
  const fixture = await stoppedPresent({
    summary: (read) => (read === 0 ? refusal("server.internal", 500) : undefined),
  });
  await pressStartAgain(fixture.app);
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
  expect(formErrors(app).filter(Boolean)).toEqual([]);
});

it("with the database present, Cancel clicked while Check again is reading does nothing, and the confirmation is drawn when the read answers", async () => {
  let answer: (response: Response) => void = () => undefined;
  const { app, requests } = await stoppedPresent({
    summary: (read) =>
      read === 0
        ? refusal("server.internal", 500)
        : read === 1
          ? new Promise<Response>((done) => (answer = done))
          : undefined,
  });
  await pressStartAgain(app);
  await expect.poll(() => q(app, "check-again")).not.toBeNull();
  const inspections = () =>
    requests.filter((r) => r.path.endsWith("/first-setup/resolution")).length;
  await click(app, "check-again");
  await expect
    .poll(() => requests.filter((r) => r.path.endsWith("/start-again/summary")))
    .toHaveLength(2);
  const before = inspections();
  q(app, "cancel-start-again").dispatchEvent(new MouseEvent("click"));
  answer(Response.json(stoppedSummary(false)));
  await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
  expect(inspections()).toBe(before);
  expect(JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner).toBeUndefined();
  expect(startAgainRequests(requests)).toEqual([]);
});

const running = { state: "running", ...stoppedAt };
it("with the database present, a tab closed while Start again reads the activity starts no activity re-reads", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    let answer: (response: Response) => void = () => undefined;
    const { app, api, requests } = await stoppedPresent({
      activity: (read) =>
        read === 1 ? new Promise<Response>((done) => (answer = done)) : stoppedActivity(),
    });
    const activity = vi.spyOn(api, "firstSetupBackupActivity");
    const activityReads = () => requests.filter((r) => r.path.endsWith("/backup/activity")).length;
    await pressStartAgain(app);
    await expect.poll(activityReads).toBe(2);
    app.remove();
    answer(Response.json({ activity: running }));
    await activity.mock.results.at(-1)!.value;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(activityReads()).toBe(2);
    expect(summaryRequests(requests)).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("with the database present, a tab closed while Check again reads the activity starts no activity re-reads", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    let answer: (response: Response) => void = () => undefined;
    const { app, api, requests } = await stoppedPresent({
      activity: (read) =>
        read === 1
          ? { state: "stopped" }
          : read === 2
            ? new Promise<Response>((done) => (answer = done))
            : stoppedActivity(),
    });
    const activity = vi.spyOn(api, "firstSetupBackupActivity");
    const activityReads = () => requests.filter((r) => r.path.endsWith("/backup/activity")).length;
    await pressStartAgain(app);
    await expect.poll(() => q(app, "check-again")).not.toBeNull();
    await click(app, "check-again");
    await expect.poll(activityReads).toBe(3);
    app.remove();
    answer(Response.json({ activity: running }));
    await activity.mock.results.at(-1)!.value;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(activityReads()).toBe(3);
    expect(startAgainRequests(requests)).toEqual([]);
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
  await openStartAgain(app);
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
    await openStartAgain(app);
    await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
    await userEvent.click(
      q<WtButton>(app, "confirm-start-again").shadowRoot!.querySelector("button")!,
    );
    await expect.poll(() => formErrors(app)).toContain(DISK_FULL[locale]);
  },
);

it("with the database present, a stopped recovery's summary read refused storage.disk_full says the disk is full", async () => {
  const { app } = await stoppedPresent({
    summary: (read) => (read === 0 ? diskFull() : undefined),
  });
  await pressStartAgain(app);
  await expect.poll(() => formErrors(app)).toContain(DISK_FULL["en-GB"]);
  expect(app.shadowRoot!.querySelector("[data-test=confirm-start-again]")).toBeNull();
});

it("with the database present, a stopped recovery's summary read refused storage.disk_full keeps the server's word on restarting", async () => {
  const { app } = await stoppedPresent({
    summary: (read) => (read === 0 ? diskFull({ restartDeletesLogs: false }) : undefined),
  });
  await pressStartAgain(app);
  await expect.poll(() => formErrors(app)).toContain(DISK_FULL_RESTART_FREES_NOTHING["en-GB"]);
});

it("with the database present, a stopped recovery's summary read refused storage.disk_full without the field says nothing about restarting", async () => {
  const { app } = await stoppedPresent({
    summary: (read) => (read === 0 ? diskFull({}) : undefined),
  });
  await pressStartAgain(app);
  await expect.poll(() => formErrors(app)).toContain(DISK_FULL_RESTART_UNKNOWN["en-GB"]);
});

it("a damaged record's Start again refused storage.disk_full says the disk is full and keeps the confirmation open", async () => {
  const { app, requests } = await mount({
    intercept(path) {
      if (path.endsWith("/backup/status"))
        return Response.json({ phase: "unstarted", proofRequired: true });
      if (path.endsWith("/start-again/summary"))
        return Response.json({ reached: "named", recoveryRecordDamaged: true });
      if (path.endsWith("/resolution/start-again")) return diskFull();
    },
  });
  await openStartAgain(app);
  expect(q(app, "recovery-record-damaged")).not.toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => formErrors(app)).toContain(DISK_FULL["en-GB"]);
  expect(q(app, "confirm-start-again")).not.toBeNull();
  expect(q(app, "recovery-record-damaged")).not.toBeNull();
  expect(startAgainRequests(requests)).toHaveLength(1);
  expect(startAgainRequests(requests)[0]!.headers.has(ownerHeader)).toBe(false);
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
