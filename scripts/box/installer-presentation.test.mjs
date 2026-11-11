import { expect, it } from "vitest";
import { formatInstallerNotice, INSTALLER_WORDS } from "./i18n/installer.mjs";

it.each(["Harbour Restaurant Ltd", "Café & Terrace", "🌊".repeat(256)])(
  "shows the checked name verbatim in both languages: %s",
  (name) => {
    const text = formatInstallerNotice({ tag: { name, live: false } });
    expect(text.split("\n")).toEqual([
      INSTALLER_WORDS.es.notice.replace("{name}", name),
      `This box already has Waitron (${name}).`,
    ]);
    expect(text).not.toContain("Live");
  },
);
it("warns only for a checked Live marking, in both languages", () => {
  const text = formatInstallerNotice({ tag: { name: "Harbour Restaurant Ltd", live: true } });
  expect(text.split("\n")).toEqual([
    INSTALLER_WORDS.es.notice.replace("{name}", "Harbour Restaurant Ltd"),
    INSTALLER_WORDS.es.live,
    INSTALLER_WORDS.es.warning,
    "This box already has Waitron (Harbour Restaurant Ltd).",
    "This disk is marked Live.",
    "A reinstall would erase this box’s data, backups and host history. Recovering venue data would require an external backup or spare box; this box would start a new fiscal chain.",
  ]);
});
it("does not infer Live status when no usable tag was read", () => {
  const text = formatInstallerNotice({ tag: null });
  expect(text.split("\n")).toEqual([
    INSTALLER_WORDS.es.notice.replace("{name}", INSTALLER_WORDS.es.unknownName),
    INSTALLER_WORDS.es.unknownStatus,
    "This box already has Waitron (Venue name unavailable).",
    "Live status unavailable.",
  ]);
  expect(text).not.toContain(INSTALLER_WORDS.es.warning);
  expect(text).not.toContain("A reinstall would");
});
