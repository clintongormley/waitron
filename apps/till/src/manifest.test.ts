import { describe, expect, it } from "vitest";

import { buildManifest } from "./manifest.js";

describe("till web app manifest", () => {
  it("declares an installable standalone app with 192 and 512 icons", () => {
    const m = buildManifest();
    expect(m.name).toContain("Waitron");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    const sizes = (m.icons as Array<{ sizes: string; src: string }>).map((i) => i.sizes).sort();
    expect(sizes).toEqual(["192x192", "512x512"]);
    for (const i of m.icons as Array<{ src: string }>) expect(i.src).toMatch(/^\/icon-\d+\.png$/);
  });
});
