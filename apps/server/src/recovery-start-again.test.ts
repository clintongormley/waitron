import { describe, expect, it } from "vitest";
import type { StartAgainSurvey, StartAgainUnit } from "@waitron/provisioning";
import type { SupportedLocale } from "@waitron/shared";
import { escapeHtml } from "./recovery-surface.js";
import {
  START_AGAIN_PAGE_TEXT,
  renderStartAgainSection,
  type StartAgainMessage,
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
        [{ kind: "moved", folder: "state/<i>aside</i>" }, text.moved("state/<i>aside</i>")],
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
