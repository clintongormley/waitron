import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  surveyStartAgainLeftovers,
  type StartAgainSurvey,
  type StartAgainUnit,
} from "@waitron/provisioning";
import {
  START_AGAIN_ADMIN,
  START_AGAIN_ADMIN_PASSWORD,
  startAgainAttempt,
} from "@waitron/provisioning/testing/start-again-attempt";
import { AppError, type SupportedLocale } from "@waitron/shared";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import { OPERATOR_TEXT, escapeHtml, type RecoveryDeps } from "./recovery-surface.js";
import {
  START_AGAIN_PAGE_TEXT,
  mountStartAgainChoice,
  renderStartAgainSection,
  type StartAgainMessage,
  type StartAgainView,
} from "./recovery-start-again.js";

type Choice = Extract<StartAgainSurvey, { kind: "choice" }>;

const LANGS = ["en-GB", "es-ES"] as const satisfies readonly SupportedLocale[];
const NOW = new Date("2026-10-27T10:00:00.000Z");

function fileUnit(root: "venue" | "state", path: string, pieces = [path]): StartAgainUnit {
  return {
    root,
    path,
    why: "not-created",
    pieces,
    entries: pieces.map((piece) => ({
      path: piece,
      type: "file" as const,
      ino: "1",
      size: "10",
      mtimeNs: "1",
    })),
  };
}

function folderUnit(root: "venue" | "state", path: string): StartAgainUnit {
  return {
    root,
    path,
    why: "not-created",
    pieces: [path],
    entries: [
      { path, type: "folder", ino: "2", size: null, mtimeNs: null },
      { path: `${path}/inner.json`, type: "file", ino: "3", size: "4", mtimeNs: "1" },
    ],
  };
}

function survey(units: StartAgainUnit[], noteFloorMs: number | null = null): Choice {
  return {
    kind: "choice",
    attemptId: "attempt",
    frozenDigest: "frozen",
    markerSha256: "marker",
    units,
    digest: "d".repeat(64),
    noteFloorMs,
  };
}

const OWNER_EXAMPLE = survey([fileUnit("venue", "venue.db")]);

function render(input: Partial<Parameters<typeof renderStartAgainSection>[0]> = {}): string {
  return renderStartAgainSection({
    survey: OWNER_EXAMPLE,
    locale: "en-GB",
    secure: true,
    now: NOW,
    ...input,
  });
}

/** The text of each `<li>` in the found-files list, in order. */
function listed(html: string): string[] {
  return [...html.matchAll(/<li>([^<]*)<\/li>/g)].map((match) => match[1]!);
}

describe("renderStartAgainSection", () => {
  it("lists the owner's example as venue/venue.db", () => {
    const html = render();
    expect(html).toContain(escapeHtml("Files found:"));
    expect(listed(html)).toEqual(["venue/venue.db"]);
  });

  it("lists a folder with a trailing slash, and a database followed by its side files", () => {
    const html = render({
      survey: survey([
        fileUnit("venue", "venue.db", ["venue.db-wal", "venue.db-shm", "venue.db"]),
        folderUnit("state", "first-setup-resolutions/abc"),
      ]),
    });
    expect(listed(html)).toEqual([
      "venue/venue.db",
      "venue/venue.db-wal",
      "venue/venue.db-shm",
      "state/first-setup-resolutions/abc/",
    ]);
  });

  it("escapes a found path holding markup", () => {
    const html = render({ survey: survey([fileUnit("venue", "<b>x</b>")]) });
    expect(html).not.toContain("<b>x</b>");
    expect(listed(html)).toEqual([escapeHtml("venue/<b>x</b>")]);
  });

  it("draws no password box when the request is not secure, and says how to choose", () => {
    for (const locale of LANGS) {
      const html = render({ locale, secure: false });
      expect(html, locale).not.toMatch(/<input\b/);
      expect(html, locale).not.toMatch(/<form\b/);
      expect(html, locale).toContain(escapeHtml(START_AGAIN_PAGE_TEXT[locale].insecureForm));
      expect(listed(html), locale).toEqual(["venue/venue.db"]);
    }
    const secure = render();
    expect(secure).toContain('<input type="password"');
    expect(secure).not.toContain(escapeHtml(START_AGAIN_PAGE_TEXT["en-GB"].insecureForm));
  });

  it("with secure: false, draws the bottom message under the insecure-form text, and still no password box", () => {
    for (const locale of LANGS) {
      const text = START_AGAIN_PAGE_TEXT[locale];
      const html = render({ locale, secure: false, message: { kind: "insecure" } });
      const message = `<p id="start-again-message">${escapeHtml(text.insecure)}</p>`;
      expect(html, locale).toContain(message);
      expect(html.indexOf(message), locale).toBeGreaterThan(
        html.indexOf(escapeHtml(text.insecureForm)),
      );
      expect(html, locale).not.toMatch(/<input\b/);
      expect(html, locale).not.toMatch(/<form\b/);
    }
  });

  it("names the choice group with a legend marked required, in both languages", () => {
    expect(START_AGAIN_PAGE_TEXT["en-GB"].choiceLegend).toBe("What should the box do? *");
    expect(START_AGAIN_PAGE_TEXT["es-ES"].choiceLegend).toBe("¿Qué debe hacer el equipo? *");
    for (const locale of LANGS) {
      const html = render({ locale });
      const legend = `<fieldset>\n<legend>${escapeHtml(START_AGAIN_PAGE_TEXT[locale].choiceLegend)}</legend>`;
      expect(html, locale).toContain(legend);
      expect(html.indexOf(legend), locale).toBeLessThan(html.indexOf('type="radio"'));
      expect(html.indexOf(legend), locale).toBeGreaterThan(html.indexOf('type="password"'));
    }
  });

  it("a moved answer draws no form: no password, no radios, no Continue", () => {
    for (const locale of LANGS) {
      const text = START_AGAIN_PAGE_TEXT[locale];
      const html = render({ locale, message: { kind: "moved", folder: "state/<i>aside</i>" } });
      expect(html, locale).toContain(
        `<p id="start-again-message">${escapeHtml(text.moved("state/<i>aside</i>"))}</p>`,
      );
      expect(html, locale).not.toMatch(/<form\b|<input\b|<button\b|<fieldset\b/);
      expect(html, locale).not.toContain(escapeHtml(text.continue));
    }
  });

  it("shows 50 paths and 'and N more'", () => {
    const units = Array.from({ length: 53 }, (_, i) =>
      fileUnit("state", `found-${String(i).padStart(2, "0")}.json`),
    );
    for (const locale of LANGS) {
      const html = render({ locale, survey: survey(units) });
      const lines = listed(html);
      expect(lines, locale).toHaveLength(51);
      expect(lines[49], locale).toBe("state/found-49.json");
      expect(lines[50], locale).toBe(escapeHtml(START_AGAIN_PAGE_TEXT[locale].more(3)));
    }
    expect(START_AGAIN_PAGE_TEXT["en-GB"].more(3)).toBe("and 3 more");
    expect(START_AGAIN_PAGE_TEXT["es-ES"].more(3)).toBe("y 3 más");
    const exactly50 = listed(render({ survey: survey(units.slice(0, 50)) }));
    expect(exactly50).toHaveLength(50);
    expect(exactly50.at(-1)).toBe("state/found-49.json");
  });

  it("marks both fields required, and posts the password, the choice and the list", () => {
    const html = render();
    expect(html).toContain('<form method="post" action="/recovery-api/start-again">');
    const password = html.match(/<input type="password"[^>]*>/)![0];
    expect(password).toContain('name="password"');
    expect(password).toContain('autocomplete="current-password"');
    expect(password).toMatch(/\brequired\b/);
    expect(html).toMatch(/<label for="start-again-password">Administrator password \*<\/label>/);
    const radios = [...html.matchAll(/<input type="radio"[^>]*>/g)].map((match) => match[0]);
    expect(radios).toHaveLength(2);
    expect(radios[0]).toContain('value="keep"');
    expect(radios[1]).toContain('value="move"');
    for (const radio of radios) {
      expect(radio).toContain('name="choice"');
      expect(radio).toMatch(/\brequired\b/);
      expect(radio).not.toContain("checked");
    }
    expect(html).toContain(`<input type="hidden" name="listed" value="${"d".repeat(64)}">`);
    expect(html).toContain('<button type="submit">Continue</button>');
    expect(html).not.toMatch(/style=|color|font|size/i);
  });

  it("shows each choice's title in bold, its detail, and Move's unsent line", () => {
    for (const locale of LANGS) {
      const text = START_AGAIN_PAGE_TEXT[locale];
      const html = render({ locale });
      const keep = html.indexOf(`<strong>${escapeHtml(text.keepTitle)}</strong>`);
      const keepDetail = html.indexOf(escapeHtml(text.keepDetail));
      const move = html.indexOf(`<strong>${escapeHtml(text.moveTitle)}</strong>`);
      const moveDetail = html.indexOf(escapeHtml(text.moveDetail));
      const unsent = html.indexOf(escapeHtml(text.moveUnsent));
      expect(keep, locale).toBeGreaterThan(-1);
      expect([keep, keepDetail, move, moveDetail, unsent], locale).toEqual(
        [keep, keepDetail, move, moveDetail, unsent].sort((a, b) => a - b),
      );
      expect(keepDetail, locale).toBeGreaterThan(keep);
    }
  });

  it("re-checks the chosen radio after a refusal", () => {
    const html = render({ chosen: "move", message: { kind: "wrongPassword" } });
    const radios = [...html.matchAll(/<input type="radio"[^>]*>/g)].map((match) => match[0]);
    expect(radios[0]).not.toContain("checked");
    expect(radios[1]).toContain("checked");
  });

  it("shows each message in both languages in its place", () => {
    const fieldOf = (html: string, id: string) =>
      html.match(new RegExp(`<p id="${id}">([^<]*)</p>`))?.[1];
    const bottomOf = (html: string) => html.match(/<p id="start-again-message">([^<]*)<\/p>/)?.[1];
    const continueAt = (html: string) => html.indexOf('<button type="submit">');
    for (const locale of LANGS) {
      const text = START_AGAIN_PAGE_TEXT[locale];
      const bottomOnly: Array<[StartAgainMessage, string]> = [
        [{ kind: "filesChanged" }, text.filesChanged],
        [{ kind: "notOffered" }, text.notOffered],
        [{ kind: "insecure" }, text.insecure],
        [{ kind: "otherPage" }, text.otherPage],
        [{ kind: "busy" }, text.busy],
        [{ kind: "diskFull" }, text.diskFull],
        [{ kind: "moveUnavailable" }, text.moveUnavailable],
        [{ kind: "notSaved" }, text.notSaved],
        [{ kind: "notFinished" }, text.notFinished],
        [{ kind: "throttled", minutes: 1 }, `${text.throttled(1)} ${text.forgotten}`],
        [{ kind: "throttled", minutes: 4 }, `${text.throttled(4)} ${text.forgotten}`],
      ];
      for (const [message, expected] of bottomOnly) {
        const html = render({ locale, message });
        expect(bottomOf(html), `${locale} ${message.kind}`).toBe(escapeHtml(expected));
        expect(html.indexOf('id="start-again-message"'), message.kind).toBeLessThan(
          continueAt(html),
        );
        expect(html.indexOf('id="start-again-message"'), message.kind).toBeGreaterThan(
          html.indexOf('value="move"'),
        );
        expect(fieldOf(html, "start-again-password-error"), message.kind).toBeUndefined();
        expect(fieldOf(html, "start-again-choice-error"), message.kind).toBeUndefined();
      }

      const missing = render({ locale, message: { kind: "passwordMissing" } });
      expect(fieldOf(missing, "start-again-password-error")).toBe(escapeHtml(text.passwordMissing));
      expect(missing.indexOf('id="start-again-password-error"')).toBeGreaterThan(
        missing.indexOf('type="password"'),
      );
      expect(missing.indexOf('id="start-again-password-error"')).toBeLessThan(
        missing.indexOf('type="radio"'),
      );
      expect(missing).toMatch(/<input type="password"[^>]*aria-invalid="true"/);
      expect(bottomOf(missing)).toBe(escapeHtml(text.fixFields));

      const noChoice = render({ locale, message: { kind: "choiceMissing" } });
      expect(fieldOf(noChoice, "start-again-choice-error")).toBe(escapeHtml(text.choiceMissing));
      expect(noChoice.indexOf('id="start-again-choice-error"')).toBeGreaterThan(
        noChoice.indexOf('value="move"'),
      );
      expect(noChoice.indexOf('id="start-again-choice-error"')).toBeLessThan(
        noChoice.indexOf('id="start-again-message"'),
      );
      expect(fieldOf(noChoice, "start-again-password-error")).toBeUndefined();
      expect(bottomOf(noChoice)).toBe(escapeHtml(text.fixFields));

      const wrong = render({ locale, message: { kind: "wrongPassword" } });
      expect(fieldOf(wrong, "start-again-password-error")).toBe(escapeHtml(text.wrongPassword));
      expect(bottomOf(wrong)).toBe(escapeHtml(text.forgotten));

      const none = render({ locale });
      expect(bottomOf(none)).toBeUndefined();
      expect(none).not.toContain("aria-invalid");
    }
    expect(START_AGAIN_PAGE_TEXT["en-GB"].throttled(1)).toBe(
      "Too many wrong passwords. Try again in 1 minute. Nothing was changed.",
    );
    expect(START_AGAIN_PAGE_TEXT["en-GB"].throttled(4)).toBe(
      "Too many wrong passwords. Try again in 4 minutes. Nothing was changed.",
    );
    expect(START_AGAIN_PAGE_TEXT["es-ES"].throttled(1)).toBe(
      "Demasiadas contraseñas incorrectas. Vuelve a intentarlo dentro de 1 minuto. No se ha cambiado nada.",
    );
    expect(START_AGAIN_PAGE_TEXT["es-ES"].throttled(4)).toBe(
      "Demasiadas contraseñas incorrectas. Vuelve a intentarlo dentro de 4 minutos. No se ha cambiado nada.",
    );
  });

  it("shows moveFloor only when the floor is later than now, in UTC", () => {
    const later = Date.parse("2026-10-27T11:05:00.000Z");
    for (const locale of LANGS) {
      const text = START_AGAIN_PAGE_TEXT[locale];
      const floor = escapeHtml(text.moveFloor("2026-10-27 11:05 UTC"));
      const shown = render({ locale, survey: survey([fileUnit("venue", "venue.db")], later) });
      expect(shown, locale).toContain(floor);
      expect(shown.indexOf(floor), locale).toBeGreaterThan(
        shown.indexOf(escapeHtml(text.moveUnsent)),
      );
      const floorStart = escapeHtml(text.moveFloor("TIME").split("TIME")[0]!);
      expect(shown, locale).toContain(floorStart);
      const equal = render({
        locale,
        survey: survey([fileUnit("venue", "venue.db")], NOW.getTime()),
      });
      expect(equal, locale).not.toContain(floorStart);
      const none = render({ locale, survey: survey([fileUnit("venue", "venue.db")], null) });
      expect(none, locale).not.toContain(floorStart);
    }
  });

  it("a Spanish string differs from its English twin for every key", () => {
    const english = START_AGAIN_PAGE_TEXT["en-GB"];
    const spanish = START_AGAIN_PAGE_TEXT["es-ES"];
    expect(Object.keys(spanish).sort()).toEqual(Object.keys(english).sort());
    const sample = (text: typeof english) => ({
      ...text,
      more: text.more(3),
      moveFloor: text.moveFloor("2026-10-27 11:05 UTC"),
      throttled: text.throttled(4),
      moved: text.moved("state/aside"),
    });
    const en = sample(english);
    const es = sample(spanish);
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(es[key], key).not.toBe(en[key]);
    }
  });
});

const sockets: TLSSocket[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function tls(extra: Record<string, unknown> = {}) {
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  return { incoming: { socket }, ...extra };
}

type StartAgainDeps = NonNullable<RecoveryDeps["startAgain"]>;
const ROOTS = { stateDir: "/box/state", venueDir: "/box/venue" };
const ROUTE_SURVEY = survey([fileUnit("venue", "venue.db"), folderUnit("state", "extra")]);
const FORM = { password: "the-password", choice: "keep", listed: ROUTE_SURVEY.digest };

function mounted(overrides: Partial<StartAgainDeps> = {}) {
  const choose = vi.fn<NonNullable<StartAgainDeps["choose"]>>(() =>
    Promise.resolve({ choice: "keep" as const }),
  );
  const onFinished = vi.fn(() => Promise.resolve());
  const log = vi.fn();
  const render = vi.fn((view: StartAgainView) => `<main>${view.code}</main>`);
  const deps: StartAgainDeps = {
    roots: ROOTS,
    survey: ROUTE_SURVEY,
    onFinished,
    choose,
    now: () => NOW,
    ...overrides,
  };
  const app = new Hono();
  mountStartAgainChoice(app, deps, render, log);
  return { app, choose, onFinished, log, render };
}

function post(
  app: Hono,
  body: string | Record<string, string>,
  options: { headers?: Record<string, string>; env?: unknown } = {},
) {
  return app.request(
    "/recovery-api/start-again",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...options.headers },
      body: typeof body === "string" ? body : new URLSearchParams(body).toString(),
    },
    options.env ?? tls(),
  );
}

describe("mountStartAgainChoice", () => {
  it("a POST without TLS is refused 403 and choose is never called", async () => {
    const { app, choose, render } = mounted();
    for (const env of [{}, { incoming: { socket: new Socket() } }]) {
      const response = await post(app, FORM, { env });
      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(render).toHaveBeenLastCalledWith({
        code: "setup.start_again_files_found",
        locale: "en-GB",
        secure: false,
        message: { kind: "insecure" },
      });
    }
    expect(choose).not.toHaveBeenCalled();
  });

  it("a POST from another origin is refused 403", async () => {
    const { app, choose, render } = mounted();
    const refused: Array<Record<string, string>> = [
      { Origin: "https://elsewhere.example" },
      { "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" },
    ];
    for (const headers of refused) {
      const response = await post(app, FORM, { headers });
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(render).toHaveBeenLastCalledWith({
        code: "setup.start_again_files_found",
        locale: "en-GB",
        secure: true,
        message: { kind: "otherPage" },
      });
    }
    expect(choose).not.toHaveBeenCalled();
    const same = await post(app, FORM, {
      headers: { Origin: "http://localhost", "Sec-Fetch-Site": "same-origin" },
    });
    expect(same.status).toBe(200);
    expect(choose).toHaveBeenCalledOnce();
  });

  it("an over-long or wrongly typed body is refused 400", async () => {
    const { app, choose, render } = mounted();
    const cases: Array<[string, Parameters<typeof post>[1], Parameters<typeof post>[2]]> = [
      ["over-long", { ...FORM, password: "x".repeat(4097) }, {}],
      ["json", JSON.stringify(FORM), { headers: { "Content-Type": "application/json" } }],
      ["extra field", { ...FORM, other: "1" }, {}],
      ["repeated field", `${new URLSearchParams(FORM).toString()}&choice=move`, {}],
      ["no listed", { password: FORM.password, choice: FORM.choice }, {}],
    ];
    for (const [name, body, options] of cases) {
      const response = await post(app, body, options);
      expect(response.status, name).toBe(400);
      expect(render, name).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: { kind: "notSaved" }, secure: true }),
      );
    }
    const wrongChoice = await post(app, { ...FORM, choice: "delete" });
    expect(wrongChoice.status).toBe(400);
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: { kind: "choiceMissing" } }),
    );
    expect(choose).not.toHaveBeenCalled();
  });

  it("a missing password, or both fields missing, reports the password; a missing choice reports the choice", async () => {
    const { app, choose, render } = mounted();
    expect((await post(app, { ...FORM, password: "" })).status).toBe(400);
    expect(render).toHaveBeenLastCalledWith({
      code: "setup.start_again_files_found",
      locale: "en-GB",
      secure: true,
      message: { kind: "passwordMissing" },
      chosen: "keep",
    });
    expect((await post(app, { listed: FORM.listed })).status).toBe(400);
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: { kind: "passwordMissing" } }),
    );
    expect((await post(app, { password: "p", listed: FORM.listed })).status).toBe(400);
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: { kind: "choiceMissing" } }),
    );
    expect(choose).not.toHaveBeenCalled();
  });

  const low = () => Promise.resolve({ bavail: 1, frsize: FULL_DISK_BYTES - 1 });
  const roomy = () => Promise.resolve({ bavail: 1, frsize: FULL_DISK_BYTES * 4 });
  const ROWS: Array<{
    name: string;
    error: unknown;
    status: number;
    message: StartAgainMessage;
    statfs?: StartAgainDeps["statfs"];
  }> = [
    {
      name: "setup.request_invalid password",
      error: new AppError("setup.request_invalid", { field: "password" }),
      status: 400,
      message: { kind: "passwordMissing" },
    },
    {
      name: "setup.request_invalid choice",
      error: new AppError("setup.request_invalid", { field: "choice" }),
      status: 400,
      message: { kind: "choiceMissing" },
    },
    {
      name: "setup.owner_required",
      error: new AppError("setup.owner_required", {}),
      status: 403,
      message: { kind: "wrongPassword" },
    },
    {
      name: "password.throttled",
      error: new AppError("password.throttled", { retryAfterSeconds: 61 }),
      status: 429,
      message: { kind: "throttled", minutes: 2 },
    },
    {
      name: "setup.start_again_files_changed",
      error: new AppError("setup.start_again_files_changed", {}),
      status: 409,
      message: { kind: "filesChanged" },
    },
    {
      name: "setup.not_ready",
      error: new AppError("setup.not_ready", {}),
      status: 409,
      message: { kind: "notOffered" },
    },
    {
      name: "setup.start_again_kept",
      error: new AppError("setup.start_again_kept", {}),
      status: 409,
      message: { kind: "notOffered" },
    },
    {
      name: "provisioning.database_in_use",
      error: new AppError("provisioning.database_in_use", { database: "venue" }),
      status: 409,
      message: { kind: "busy" },
    },
    {
      name: "setup.start_again_set_aside_unavailable",
      error: new AppError("setup.start_again_set_aside_unavailable", {}),
      status: 409,
      message: { kind: "moveUnavailable" },
    },
    {
      name: "setup.attempt_invalid on a full disk",
      error: new AppError("setup.attempt_invalid", {}),
      status: 409,
      message: { kind: "diskFull" },
      statfs: low,
    },
    {
      name: "setup.attempt_invalid with room",
      error: new AppError("setup.attempt_invalid", {}),
      status: 409,
      message: { kind: "notSaved" },
      statfs: roomy,
    },
    {
      name: "setup.attempt_invalid with free space unknown",
      error: new AppError("setup.attempt_invalid", {}),
      status: 409,
      message: { kind: "notSaved" },
      statfs: () => Promise.reject(new Error("statfs refused")),
    },
    {
      name: "another code",
      error: new AppError("setup.start_again_incomplete", {}),
      status: 409,
      message: { kind: "notFinished" },
    },
    {
      name: "a plain error",
      error: new Error("boom"),
      status: 409,
      message: { kind: "notFinished" },
    },
  ];

  it.each(ROWS)("$name answers $status with $message.kind", async (row) => {
    const { app, render, log, onFinished } = mounted({
      choose: () => Promise.reject(row.error),
      ...(row.statfs === undefined ? {} : { statfs: row.statfs }),
    });
    const response = await post(app, { ...FORM, choice: "move" });
    expect(response.status).toBe(row.status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("<main>setup.start_again_files_found</main>");
    expect(render).toHaveBeenLastCalledWith({
      code: "setup.start_again_files_found",
      locale: "en-GB",
      secure: true,
      message: row.message,
      chosen: "move",
    });
    expect(response.headers.get("Retry-After")).toBe(
      row.message.kind === "throttled" ? "61" : null,
    );
    if (row.message.kind === "notFinished") {
      expect(log).toHaveBeenCalledWith("warn", "recovery.start_again_choice_failed", {
        errorCode: row.error instanceof AppError ? row.error.code : null,
      });
    } else {
      expect(log).not.toHaveBeenCalled();
    }
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("the full-disk reading is taken over both roots", async () => {
    const asked: string[] = [];
    const { app } = mounted({
      choose: () => Promise.reject(new AppError("setup.attempt_invalid", {})),
      statfs: (path) => {
        asked.push(path);
        return roomy();
      },
    });
    await post(app, FORM);
    expect(asked.sort()).toEqual([ROOTS.stateDir, ROOTS.venueDir].sort());
  });

  it("passes the roots, the form and the clock to choose, and answers in the request's language", async () => {
    const { app, choose, render } = mounted();
    const response = await post(app, FORM, { headers: { "Accept-Language": "es-ES,es;q=0.9" } });
    expect(response.status).toBe(200);
    expect(choose).toHaveBeenCalledWith({
      roots: ROOTS,
      password: FORM.password,
      choice: "keep",
      listed: FORM.listed,
      now: expect.any(Function),
    });
    const now = choose.mock.calls[0]![0].now;
    expect(now()).toBe(NOW);
    expect(render).toHaveBeenLastCalledWith({
      code: "setup.start_again_kept",
      locale: "es-ES",
      secure: true,
    });
    expect(response.headers.get("Vary")).toBe("Accept-Language");
  });

  it("Keep answers the kept page and does not restart", async () => {
    const { app, onFinished, render } = mounted();
    const response = await post(app, FORM, { env: tls({ outgoing: new EventEmitter() }) });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<main>setup.start_again_kept</main>");
    expect(render).toHaveBeenLastCalledWith({
      code: "setup.start_again_kept",
      locale: "en-GB",
      secure: true,
    });
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("Move answers moved, naming the set-aside folder", async () => {
    const { app, render } = mounted({
      choose: () =>
        Promise.resolve({
          choice: "move" as const,
          setAside: {
            state: "first-setup-set-aside/s1/state",
            venue: "first-setup-set-aside/s1/venue",
          },
        }),
    });
    expect((await post(app, { ...FORM, choice: "move" })).status).toBe(200);
    expect(render).toHaveBeenLastCalledWith({
      code: "setup.start_again_files_found",
      locale: "en-GB",
      secure: true,
      message: { kind: "moved", folder: "state/first-setup-set-aside/s1" },
    });
  });

  it("Move across two disks names both set-aside folders", async () => {
    const { app, render } = mounted({
      choose: () =>
        Promise.resolve({
          choice: "move" as const,
          setAside: { state: "first-setup-set-aside/s1/state", venue: "first-setup-set-aside/s1" },
        }),
    });
    await post(app, { ...FORM, choice: "move" });
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: {
          kind: "moved",
          folder: "state/first-setup-set-aside/s1/state, venue/first-setup-set-aside/s1",
        },
      }),
    );
  });

  it("Move restarts only after the answer is written", async () => {
    const outgoing = new EventEmitter();
    const { app, onFinished } = mounted({
      choose: () =>
        Promise.resolve({
          choice: "move" as const,
          setAside: {
            state: "first-setup-set-aside/s1/state",
            venue: "first-setup-set-aside/s1/venue",
          },
        }),
    });
    const response = await post(app, { ...FORM, choice: "move" }, { env: tls({ outgoing }) });
    expect(response.status).toBe(200);
    expect(onFinished).not.toHaveBeenCalled();
    outgoing.emit("finish");
    expect(onFinished).toHaveBeenCalledOnce();
    outgoing.emit("finish");
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("the log line names no person", async () => {
    const { app, log } = mounted({
      choose: () =>
        Promise.resolve({
          choice: "move" as const,
          setAside: {
            state: "first-setup-set-aside/s1/state",
            venue: "first-setup-set-aside/s1/venue",
          },
        }),
    });
    await post(app, { ...FORM, choice: "move" });
    expect(log).toHaveBeenCalledOnce();
    const [level, event, fields] = log.mock.calls[0]! as [string, string, Record<string, unknown>];
    expect([level, event]).toEqual(["info", "recovery.start_again_choice"]);
    expect(Object.keys(fields).sort()).toEqual(["attemptId", "choice", "units"]);
    expect(fields).toEqual({ choice: "move", attemptId: ROUTE_SURVEY.attemptId, units: 2 });
    expect(JSON.stringify(log.mock.calls)).not.toContain(FORM.password);
  });

  it("with the real choose and the shared fixture, Keep answers the kept title", async () => {
    const base = await mkdtemp(join(tmpdir(), "recovery-start-again-"));
    dirs.push(base);
    const attempt = await startAgainAttempt(base);
    await writeFile(join(attempt.roots.venueDir, "venue.db"), "found database");
    const found = await surveyStartAgainLeftovers(attempt.roots);
    if (found?.kind !== "choice") throw new Error(`expected choice, got ${JSON.stringify(found)}`);
    const app = new Hono();
    const log = vi.fn();
    mountStartAgainChoice(
      app,
      { roots: attempt.roots, survey: found, onFinished: () => Promise.resolve() },
      (view) => OPERATOR_TEXT[view.code]![view.locale].title,
      log,
    );
    const response = await post(app, {
      password: START_AGAIN_ADMIN_PASSWORD,
      choice: "keep",
      listed: found.digest,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(OPERATOR_TEXT["setup.start_again_kept"]!["en-GB"].title);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(START_AGAIN_ADMIN.displayName);
    expect(logged).not.toContain(START_AGAIN_ADMIN.email);
  });
});
