import { afterEach, expect, test, vi } from "vitest";
import { render } from "lit";
import { watchMediaImage } from "@waitron/ui/src/live-media-image.js";
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
const PICTURE = `${"a".repeat(64)}.webp`;
let root: HTMLElement;
afterEach(() => {
  root.querySelector<import("./till-app.js").TillApp>("till-app")?.router?.stop();
  render(null, root);
  root.remove();
  localStorage.removeItem(SERVERS_STORAGE_KEY);
  vi.unstubAllGlobals();
});

test("after the till moves to another server, menu pictures are looked up on and loaded from it", async () => {
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
    if (url.startsWith(`${SPARE}/media/presentations?`)) {
      const path = (shape: string) => `/media/renditions/photo-${shape}.webp`;
      return Response.json({
        images: {
          [PICTURE]: {
            id: "photo",
            revision: 1,
            source: path("source"),
            square: path("square"),
            till: path("till"),
            display: path("display"),
          },
        },
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
  const heard: (string | undefined)[] = [];
  const stop = watchMediaImage(PICTURE, "till", (address) => heard.push(address));
  try {
    await vi.waitFor(() => expect(heard).toEqual([`${SPARE}/media/renditions/photo-till.webp`]));
    expect(requested).not.toContain(`/media/presentations?references=${PICTURE}`);
  } finally {
    stop();
  }
});
