import { describe, expect, it } from "vitest";
import { initialOwnerStrings } from "../screens/initial-owner-strings.js";
import { initialSetupStrings } from "../screens/initial-setup-strings.js";
import { en, es } from "./strings.js";

// Setup calls the Waitron machine "the box" in English and "servidor" in Spanish, never "equipo"
// (owner, 2026-11-22). "mail server" is the email service, and "the server" beside "sender email"
// names the email screen's Mail server field; capitalised "Servers" is the dashboard page, whose
// name the owner kept. Weaker than its name: only the string tables below are read, not English
// written inline in screens nor the guide pages.
const ALLOWED_EN = [/\bmail servers?\b/gi, /\bleave the server, sender email\b/g, /\bServers\b/g];

function table(prefix: string, words: Record<string, string>): [string, string][] {
  return Object.entries(words).map(([key, text]) => [`${prefix}.${key}`, text]);
}

function english(): [string, string][] {
  return [
    ...table("strings", en),
    ...table("initialOwner", initialOwnerStrings.en),
    ...table("initialSetup", initialSetupStrings.en),
  ];
}

function spanish(): [string, string][] {
  return [
    ...table("strings", es),
    ...table("initialOwner", initialOwnerStrings.es),
    ...table("initialSetup", initialSetupStrings.es),
  ];
}

describe("setup's word for the Waitron machine", () => {
  it("reads every table it claims to", () => {
    const paths = [...english(), ...spanish()].map(([path]) => path);
    expect(paths).toContain("strings.reset.heading");
    expect(paths).toContain("initialOwner.heading");
    expect(paths).toContain("initialSetup.heading");
  });

  it("calls it the box in English, never the server", () => {
    const offending = english().filter(([, text]) => {
      const rest = ALLOWED_EN.reduce((left, phrase) => left.replace(phrase, ""), text);
      return /\bservers?\b/i.test(rest);
    });
    expect(offending).toEqual([]);
  });

  it("calls it servidor in Spanish, never equipo", () => {
    const offending = spanish().filter(([, text]) => /\bequipos?\b/i.test(text));
    expect(offending).toEqual([]);
  });
});
