import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { mountGuidePages } from "./guide-pages.js";

it.each(["en", "es"])(
  "serves shared diagnosis anchors and the waiting-records help link in %s",
  async (language) => {
    const app = new Hono();
    mountGuidePages(app, {}, vi.fn());
    const response = await app.request(`/help/${language}/aeat-certificate`);
    expect(response.status).toBe(200);
    const html = await response.text();
    for (const id of [
      "diagnosis",
      "diagnosis-source",
      "diagnosis-authority",
      "diagnosis-results",
      "diagnosis-stop",
    ])
      expect(html).toContain(`<section id="${id}" aria-labelledby="${id}-heading">`);
    expect(html).toContain('href="box-status#retry-now"');
  },
);
