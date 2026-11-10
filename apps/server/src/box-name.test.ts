import { describe, expect, it } from "vitest";
import { boxHostnameFor, ownContactUrl, sameBoxName } from "./box-name.js";

const NODE = "7f3a9c00-0000-4000-8000-000000000001";

describe("a box's own name", () => {
  it("names a box by the first four characters of its node id under waitron.local", () => {
    expect(boxHostnameFor(NODE)).toBe("box-7f3a.waitron.local");
    expect(ownContactUrl("https://waitron.local", NODE)).toBe("https://box-7f3a.waitron.local");
  });

  it("keeps the advertised origin's scheme and port", () => {
    expect(ownContactUrl("https://waitron.local:8443", NODE)).toBe(
      "https://box-7f3a.waitron.local:8443",
    );
    expect(ownContactUrl("http://waitron.local:8080", NODE)).toBe(
      "http://box-7f3a.waitron.local:8080",
    );
  });

  it("leaves an origin at another host as configured", () => {
    expect(ownContactUrl("https://localhost:8443", NODE)).toBe("https://localhost:8443");
    expect(ownContactUrl("https://box.deli.test", NODE)).toBe("https://box.deli.test");
    expect(ownContactUrl("https://shop.waitron.local", NODE)).toBe("https://shop.waitron.local");
  });

  it("calls two node ids the same box name when their first four characters match", () => {
    expect(sameBoxName(NODE, "7f3affff-0000-4000-8000-000000000002")).toBe(true);
    expect(sameBoxName(NODE, "7f3bffff-0000-4000-8000-000000000002")).toBe(false);
  });

  it("an upper-case node id gives the same name", () => {
    expect(boxHostnameFor("7F3A9C00-0000-4000-8000-000000000001")).toBe("box-7f3a.waitron.local");
    expect(sameBoxName("7F3A9C00-0000-4000-8000-000000000001", NODE)).toBe(true);
  });
});
