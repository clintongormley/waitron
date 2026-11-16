import { afterEach, expect, it, vi } from "vitest";
import { mediaAddress, subscribeMediaServer, setMediaServer } from "./media-server.js";

afterEach(() => setMediaServer(""));

it("leaves media paths on the page's own server until a server is set", () => {
  expect(mediaAddress("/media/a.webp")).toBe("/media/a.webp");
  setMediaServer("https://spare.deli.test");
  expect(mediaAddress("/media/a.webp")).toBe("https://spare.deli.test/media/a.webp");
});

it("leaves an address that is not a media path as it is", () => {
  setMediaServer("https://spare.deli.test");
  expect(mediaAddress("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  expect(mediaAddress("")).toBe("");
});

it("tells listeners about a real change only, until they stop listening", () => {
  const listener = vi.fn();
  const stop = subscribeMediaServer(listener);
  setMediaServer("https://spare.deli.test");
  setMediaServer("https://spare.deli.test");
  expect(listener).toHaveBeenCalledTimes(1);
  stop();
  setMediaServer("https://main.deli.test");
  expect(listener).toHaveBeenCalledTimes(1);
});
