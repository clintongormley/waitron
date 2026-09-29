import { describe, expect, it } from "vitest";
import { en, es } from "./strings.js";
import { finishEn } from "./strings/finish.js";
import { restoreEn } from "./strings/restore.js";
import { shellEn } from "./strings/shell.js";
import { startEn } from "./strings/start.js";
import { venueEn } from "./strings/venue.js";

const areas: Record<string, object> = {
  shell: shellEn,
  start: startEn,
  venue: venueEn,
  restore: restoreEn,
  finish: finishEn,
};

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{\w+\}/g)].map(([p]) => p).sort();

describe("the setup string catalogue", () => {
  it("gives no key to two area files, where the later spread would silently win", () => {
    const owners = new Map<string, string[]>();
    for (const [area, strings] of Object.entries(areas)) {
      for (const key of Object.keys(strings)) owners.set(key, [...(owners.get(key) ?? []), area]);
    }
    expect([...owners].filter(([, areasOwning]) => areasOwning.length > 1)).toEqual([]);
  });

  it("keeps the shell. keys in shell.ts and nowhere else", () => {
    const misplaced = Object.entries(areas).flatMap(([area, strings]) =>
      area === "shell"
        ? Object.keys(strings).filter((key) => !key.startsWith("shell."))
        : Object.keys(strings).filter((key) => key.startsWith("shell.")),
    );
    expect(misplaced).toEqual([]);
  });

  it("fills the same placeholders in Spanish as in English, and leaves no Spanish text empty", () => {
    const mismatched = (Object.keys(en) as (keyof typeof en)[]).filter(
      (key) =>
        es[key].trim() === "" || placeholders(es[key]).join() !== placeholders(en[key]).join(),
    );
    expect(mismatched).toEqual([]);
  });
});
