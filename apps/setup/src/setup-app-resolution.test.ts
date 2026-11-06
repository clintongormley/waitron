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
      "recoveryRunning",
      "recoveryLastActive",
      "recoveryLastSaved",
      "recoveryRunningNext",
      "recoveryStopped",
      "recoveryStoppedRefused",
      "recoveryStoppedRecover",
      "recoveryStoppedCloud",
      "recoveryUnreadable",
      "checkAgain",
      "recoveryDetailsUnread",
    ])
      expect(Object.hasOwn(strings, key)).toBe(false);
  for (const shell of [shellEn, shellEs])
    for (const key of [
      "shell.first_setup.recovery_in_progress",
      "shell.first_setup.recovery_discarded",
      "shell.first_setup.disk_full_restart_frees_nothing",
    ])
      expect(Object.hasOwn(shell, key)).toBe(false);
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

const shellText = (locale: string) => (locale.startsWith("es") ? shellEs : shellEn);

it("the unfinished-deletion message is the owner's words, in English and Spanish", () => {
  expect(shellEn["shell.first_setup.start_again_incomplete"]).toBe(
    "Deletion interrupted. Reload the page to continue.",
  );
  expect(shellEs["shell.first_setup.start_again_incomplete"]).toBe(
    "Borrado interrumpido. Recarga la página para continuar.",
  );
});

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

/** The summary the box answers on pressing Start again with the setup database present. */
const presentSummary = { reached: "claimed" };
async function presentDatabase(
  options: {
    /** The summary's answer for each read, counted from 0; the summary itself when undefined. */
    summary?: (read: number) => Response | Promise<Response> | undefined;
    /** Merged into every inspection read. */
    inspection?: Partial<FirstSetupInspection>;
    /** The answer to each Start again, counted from 0; the default answer when undefined. */
    startAgain?: (send: number) => Response | Promise<Response> | undefined;
  } = {},
) {
  let startAgainSends = 0;
  let summaryReads = 0;
  const fixture = await mount({
    inspection: options.inspection,
    intercept(path) {
      if (path.endsWith("/start-again/summary"))
        return options.summary?.(summaryReads++) ?? Response.json(presentSummary);
      if (path.endsWith("/resolution/start-again") && options.startAgain) {
        const answer = options.startAgain(startAgainSends++);
        if (answer) return answer;
      }
    },
  });
  await expect
    .poll(() => fixture.app.shadowRoot!.querySelector("[data-test=start-again]"))
    .not.toBeNull();
  return fixture;
}
const click = (app: SetupApp, name: string) =>
  userEvent.click(q<WtButton>(app, name).shadowRoot!.querySelector("button")!);
/** Start again reads the inspection and the summary before it draws anything. */
const pressStartAgain = (app: SetupApp) => click(app, "start-again");

const refusal = (code: string, status: number) =>
  Response.json({ error: { code, params: {} } }, { status });

it.each(["en-GB", "es-ES"])(
  "with the database present, a summary read on pressing Start again refused with a code the page has no words for draws the general error words, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app, requests } = await presentDatabase({
      summary: (read) => (read === 0 ? refusal("server.internal", 500) : undefined),
    });
    setLocale(locale);
    await app.updateComplete;
    await pressStartAgain(app);
    await expect.poll(() => formErrors(app).filter(Boolean)).toEqual([t.error]);
    expect(app.shadowRoot!.querySelector("[data-test=confirm-start-again]")).toBeNull();
    expect(startAgainRequests(requests)).toEqual([]);
  },
);

it("with the database present, a second click on Start again's outer element while the summary is being read reads the box and the summary once", async () => {
  const held: ((response: Response) => void)[] = [];
  const { app, requests } = await presentDatabase({
    summary: () => new Promise<Response>((done) => held.push(done)),
  });
  const reads = (suffix: string) => requests.filter((r) => r.path.endsWith(suffix)).length;
  const inspections = reads("/first-setup/resolution");
  q(app, "start-again").dispatchEvent(new MouseEvent("click"));
  await expect.poll(() => reads("/start-again/summary")).toBe(1);
  q(app, "start-again").dispatchEvent(new MouseEvent("click"));
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (const done of held) done(Response.json(presentSummary));
  await expect
    .poll(() => app.shadowRoot!.querySelector("[data-test=confirm-start-again]"))
    .not.toBeNull();
  expect(reads("/first-setup/resolution")).toBe(inspections + 1);
  expect(reads("/start-again/summary")).toBe(1);
});

it("with the database present, Cancel clicked on its outer element while Confirm's send is in flight keeps the confirmation open and draws the send's answer", async () => {
  let answer: (response: Response) => void = () => undefined;
  const { app, requests } = await presentDatabase({
    startAgain: () => new Promise<Response>((done) => (answer = done)),
  });
  await pressStartAgain(app);
  await expect
    .poll(() => app.shadowRoot!.querySelector("[data-test=confirm-start-again]"))
    .not.toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed"));
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
  q(app, "cancel-start-again").dispatchEvent(new MouseEvent("click"));
  answer(refusal("server.internal", 500));
  await expect.poll(() => formErrors(app).filter(Boolean)).toEqual([initialOwnerStrings.en.error]);
  expect(app.shadowRoot!.querySelector("[data-test=retire-confirmed]")).not.toBeNull();
  expect(app.shadowRoot!.querySelector("[data-test=confirm-start-again]")).not.toBeNull();
  expect(startAgainRequests(requests)).toHaveLength(1);
});

it.each(["en-GB", "es-ES"])(
  "with the database present and holding records, Start again is offered and, once pressed, says what Start again deletes and that no invoice was sent, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app, requests } = await presentDatabase({
      inspection: { database: "occupied", emptyDatabase: false },
    });
    setLocale(locale);
    await app.updateComplete;
    expect(q<WtButton>(app, "start-again").disabled).toBe(false);
    expect(app.shadowRoot!.querySelector("[data-test=start-again-refused]")).toBeNull();
    expect(app.shadowRoot!.textContent).not.toContain(t.wipeUnavailable);
    await pressStartAgain(app);
    await expect.poll(() => q(app, "confirm-start-again")).not.toBeNull();
    expect(q(app, "start-again-deletes").textContent!.trim()).toBe(
      `${t.heldLost} ${t.noInvoiceSent}`,
    );
    const order = [
      q(app, "start-again-deletes"),
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
    });
    expect(startAgainRequests(requests)[0]!.headers.has(ownerHeader)).toBe(false);
    await expect.poll(() => app.shadowRoot!.textContent).toContain(t.restarting);
  },
);

it.each(["en-GB", "es-ES"])(
  "a setup database holding rows in a table other than the venue's is offered Start again, with the same words, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app } = await presentDatabase({
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

it("a refused Start again from the held confirmation closes it and says the setup changed, with Start again offered again and nobody signed in", async () => {
  const { app, requests } = await presentDatabase({
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

it("saved trading settings beside a database holding records offer Start again, and pressing it draws the box's refusal with nothing sent", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await presentDatabase({
    inspection: {
      database: "occupied",
      emptyDatabase: false,
      artifacts: [{ name: "trading.env", status: "present", digest: "c".repeat(64) }],
    },
    summary: () => refusedCause("trading-settings"),
  });
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

const DISK_FULL = {
  "en-GB":
    "The box's disk is full, so Waitron cannot save anything. Restart the box: as it starts, it uses the space it keeps in reserve and removes old logs and crash reports to make room. Then try again. If the disk is still full, Waitron cannot free more space by itself. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards.",
  "es-ES":
    "El disco del equipo está lleno, así que Waitron no puede guardar nada. Reinicia el equipo: al arrancar, usa el espacio que guarda en reserva y quita registros y avisos de fallo antiguos para hacer sitio. Después, vuelve a intentarlo. Si el disco sigue lleno, Waitron no puede liberar más espacio por sí solo. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.",
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

it("with the database present, a summary read refused storage.disk_full says the disk is full", async () => {
  const { app } = await presentDatabase({
    summary: (read) => (read === 0 ? diskFull() : undefined),
  });
  await pressStartAgain(app);
  await expect.poll(() => formErrors(app)).toContain(DISK_FULL["en-GB"]);
  expect(app.shadowRoot!.querySelector("[data-test=confirm-start-again]")).toBeNull();
});

it("with the database present, a summary read refused storage.disk_full without the field says nothing about restarting", async () => {
  const { app } = await presentDatabase({
    summary: (read) => (read === 0 ? diskFull({}) : undefined),
  });
  await pressStartAgain(app);
  await expect.poll(() => formErrors(app)).toContain(DISK_FULL_RESTART_UNKNOWN["en-GB"]);
});

it("a damaged record's Start again refused storage.disk_full says the disk is full and keeps the confirmation open", async () => {
  const { app, requests } = await mount({
    intercept(path) {
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

it("a record whose claim mark needs repair offers Start again and Recover from backup", async () => {
  const { app, requests } = await presentDatabase({ inspection: { pair: "repairable" } });
  expect(q<WtButton>(app, "start-again").disabled).toBe(false);
  expect(q<WtButton>(app, "recover-backup").disabled).toBe(false);
  expect(app.shadowRoot!.querySelector("[data-test=start-again-refused]")).toBeNull();
  await openStartAgain(app);
  expect(summaryRequests(requests)).toHaveLength(1);
  await click(app, "cancel-start-again");
  await expect.poll(() => q<WtButton>(app, "recover-backup")?.disabled).toBe(false);
  await click(app, "recover-backup");
  await expect.poll(() => q(app, "confirm-recover")).not.toBeNull();
  expect(startAgainRequests(requests)).toEqual([]);
});

it("a record that cannot be read offers neither, and says why", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await mount({
    inspection: { pair: "invalid", revision: null, ownerGeneration: null },
  });
  for (const name of ["start-again", "recover-backup"])
    expect(q<WtButton>(app, name)?.disabled ?? true, name).toBe(true);
  expect(q(app, "start-again-refused").textContent).toBe(t.wipeUnavailable);
  q(app, "start-again")?.dispatchEvent(new MouseEvent("click"));
  q(app, "recover-backup")?.dispatchEvent(new MouseEvent("click"));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(summaryRequests(requests)).toEqual([]);
  expect(startAgainRequests(requests)).toEqual([]);
});

it.each(["en-GB", "es-ES"] as const)(
  "after Start again the heading is First setup, in %s",
  async (locale) => {
    const t = initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
    const { app, requests } = await mount();
    setLocale(locale);
    await app.updateComplete;
    await confirmStartAgain(app);
    await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
    await expect
      .poll(() => app.shadowRoot!.querySelector("[role=status]")?.textContent)
      .toBe(t.restarting);
    expect(app.shadowRoot!.querySelector("h1")!.textContent).toBe(t.heading);
  },
);

/** Every button on the page that reads Start again, whichever step drew it. */
const startAgainButtons = (app: SetupApp) =>
  [...app.shadowRoot!.querySelectorAll("wt-button")].filter(
    (button) => button.textContent!.trim() === initialOwnerStrings.en.startAgain,
  );
const startAgainStates: Record<string, () => Promise<SetupApp>> = {
  closed: async () => (await presentDatabase()).app,
  "confirmation open": async () => {
    const { app } = await presentDatabase();
    await openStartAgain(app);
    return app;
  },
  "with an error": async () => {
    const { app } = await presentDatabase({
      summary: (read) => (read === 0 ? refusal("server.internal", 500) : undefined),
    });
    await pressStartAgain(app);
    await expect.poll(() => formErrors(app).filter(Boolean)).toHaveLength(1);
    return app;
  },
  busy: async () => {
    const { app } = await presentDatabase({ startAgain: () => new Promise<Response>(() => {}) });
    await confirmStartAgain(app);
    await expect.poll(() => q<WtButton>(app, "cancel-start-again")?.disabled).toBe(true);
    return app;
  },
  refused: async () => {
    const { app } = await presentDatabase({ summary: () => refusedCause("trading-settings") });
    await pressStartAgain(app);
    await expect.poll(() => q(app, "start-again-refused")).not.toBeNull();
    return app;
  },
  "missing database": async () => {
    const { app } = await mount({ inspection: { database: "missing", emptyDatabase: false } });
    await pressStartAgain(app);
    await expect.poll(() => q(app, "missing-reached")).not.toBeNull();
    return app;
  },
  "Recover's confirmation open": async () => {
    const { app } = await presentDatabase();
    await click(app, "recover-backup");
    await expect.poll(() => q(app, "confirm-recover")).not.toBeNull();
    return app;
  },
};
it.each(Object.keys(startAgainStates))(
  "at most one Start again button is drawn in every state: %s",
  async (state) => {
    const app = await startAgainStates[state]!();
    await app.updateComplete;
    expect(startAgainButtons(app).length).toBeLessThanOrEqual(1);
  },
);
