import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { mountGuidePages } from "./guide-pages.js";
import { GUIDE_PAGES, guideRoot, readGuide } from "./guide-catalogue.js";
import { renderGuide } from "./guide-markdown.js";

it.each(["en", "es"])(
  "serves the backup-repair procedure and its matching section links in %s",
  async (language) => {
    const app = new Hono();
    mountGuidePages(app, {}, vi.fn());
    const response = await app.request(`/help/${language}/backup-recovery`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    for (const section of [
      "interrupted-setup",
      "source",
      "proof",
      "series",
      "resume",
      "invoice-conflict",
    ])
      expect(html).toContain(`id="${section}"`);
    const markdown = readGuide(guideRoot(), language, "backup-recovery")!;
    expect(renderGuide(markdown, GUIDE_PAGES).sections.map((section) => section.id)).toEqual([
      "interrupted-setup",
      "source",
      "proof",
      "series",
      "resume",
      "invoice-conflict",
    ]);
  },
);
