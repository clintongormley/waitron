import { afterEach, expect, test, vi } from "vitest";
import { render } from "lit";
import { followVenueTheme } from "@waitron/ui";
import { SERVERS_STORAGE_KEY } from "./api/server-router.js";

const gate = vi.hoisted(() => ({ start: undefined as (() => void) | undefined }));
vi.mock("@waitron/ui", async (original) => ({
  ...(await original<typeof import("@waitron/ui")>()),
  startWithPopover: (start: () => void) => {
    gate.start = start;
  },
}));
vi.mock("./trust-check.js", () => ({ isTrustBroken: async () => false }));

const SPARE = "https://spare.deli.test";
let root: HTMLElement;
afterEach(() => {
  root.querySelector<import("./till-app.js").TillApp>("till-app")?.router?.stop();
  render(null, root);
  root.remove();
  localStorage.removeItem(SERVERS_STORAGE_KEY);
  vi.unstubAllGlobals();
});

test("after the till moves to another server, the next theme hash fetches that server's theme", async () => {
  localStorage.setItem(
    SERVERS_STORAGE_KEY,
    JSON.stringify({ servers: [{ url: location.origin }, { url: SPARE }] }),
  );
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    if (url === `${SPARE}/api/node`) {
      return Response.json({
        acceptingSales: true,
        term: 2,
        nodeId: "spare",
        standing: null,
        environment: "preproduction",
      });
    }
    if (url.endsWith("/api/node")) throw new TypeError("Failed to fetch");
    return new Response(null, { status: 503 });
  });
  root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  await import("./main.js");
  gate.start!();
  await vi.waitFor(() =>
    expect(root.querySelector<import("./till-app.js").TillApp>("till-app")?.router?.current).toBe(
      SPARE,
    ),
  );
  requested.length = 0;
  followVenueTheme("a-hash-the-till-has-not-applied");
  await vi.waitFor(() => expect(requested).toContain(`${SPARE}/api/theme`));
  expect(requested).not.toContain("/api/theme");
});
