import { describe, expect, it } from "vitest";
import { readEnv } from "./config.js";

describe("readEnv", () => {
  it("reads a browser-facing setup URL independently of the server and listening port", () => {
    expect(
      readEnv(
        {
          WAITRON_SERVER_URL: "https://127.0.0.1",
          WAITRON_SETUP_PORT: "9210",
          WAITRON_SETUP_URL: "  http://192.168.10.40:9310/  ",
        },
        "docker-container-id",
      ),
    ).toMatchObject({ setupUrl: "http://192.168.10.40:9310", setupPort: 9210 });
  });

  it("treats an empty advertised setup URL as absent", () => {
    expect(
      readEnv({ WAITRON_SETUP_URL: "  ", WAITRON_BOX_ADDRESSES: "  " }, "container").setupUrl,
    ).toBeUndefined();
  });

  it("uses a configured box address and the actual setup listener port", () => {
    expect(
      readEnv(
        { WAITRON_BOX_ADDRESSES: "192.168.10.40, 10.0.0.40", WAITRON_SETUP_PORT: "9210" },
        "h",
      ).setupUrl,
    ).toBe("http://192.168.10.40:9210");
    expect(
      readEnv({ WAITRON_BOX_ADDRESSES: "192.168.10.40", WAITRON_SETUP_PORT: "80" }, "h").setupUrl,
    ).toBe("http://192.168.10.40");
  });

  it("prefers the explicit setup URL to the box address", () => {
    expect(
      readEnv(
        { WAITRON_BOX_ADDRESSES: "192.168.10.40", WAITRON_SETUP_URL: "https://agent.test" },
        "h",
      ).setupUrl,
    ).toBe("https://agent.test");
  });

  it.each(["not-ip", "192.168.10.40,", "127.0.0.2", "0.0.0.0", "::1"])(
    "refuses unusable configured box addresses: %s",
    (address) => {
      expect(() => readEnv({ WAITRON_BOX_ADDRESSES: address }, "h")).toThrow(
        /WAITRON_BOX_ADDRESSES/,
      );
    },
  );

  it.each([
    "not a URL",
    "javascript:alert(1)",
    "ftp://printer.test",
    "http://user:secret@printer.test",
    "http://:secret@printer.test",
    "http://printer.test/setup",
    "http://printer.test/?secret=value",
    "http://printer.test/#fragment",
    "http://127.0.0.1:9110",
    "http://127.2.3.4:9110",
    "http://localhost:9110",
    "http://[::1]:9110",
    "http://0.0.0.0:9110",
    "http://[::]:9110",
  ])("refuses an unusable advertised setup URL: %s", (setupUrl) => {
    expect(() => readEnv({ WAITRON_SETUP_URL: setupUrl }, "container")).toThrow(
      /WAITRON_SETUP_URL/,
    );
  });

  it("applies the defaults and the hostname as the name", () => {
    expect(readEnv({}, "kitchen-pi")).toEqual({
      serverUrl: undefined,
      name: "kitchen-pi",
      stateDir: "/var/lib/waitron-print-agent",
      setupPort: 9110,
    });
  });

  it("reads every value from env, normalising the url to its origin", () => {
    expect(
      readEnv(
        {
          WAITRON_SERVER_URL: "https://box.test/",
          WAITRON_AGENT_NAME: "n",
          WAITRON_STATE_DIR: "/tmp/x",
          WAITRON_SETUP_PORT: "9200",
        },
        "h",
      ),
    ).toEqual({ serverUrl: "https://box.test", name: "n", stateDir: "/tmp/x", setupPort: 9200 });
  });

  it("treats an empty string as unset (CLAUDE.md §3): a blank url and name fall back", () => {
    expect(readEnv({ WAITRON_SERVER_URL: "", WAITRON_AGENT_NAME: "" }, "kitchen-pi")).toEqual({
      serverUrl: undefined,
      name: "kitchen-pi",
      stateDir: "/var/lib/waitron-print-agent",
      setupPort: 9110,
    });
  });

  it("trims surrounding whitespace before deciding a value is set", () => {
    expect(readEnv({ WAITRON_AGENT_NAME: "  till-1  ", WAITRON_STATE_DIR: "  /d  " }, "h")).toEqual(
      {
        serverUrl: undefined,
        name: "till-1",
        stateDir: "/d",
        setupPort: 9110,
      },
    );
  });

  it("refuses a server url that is not an http(s) origin", () => {
    expect(() => readEnv({ WAITRON_SERVER_URL: "not a url" }, "h")).toThrow(/WAITRON_SERVER_URL/);
    expect(() => readEnv({ WAITRON_SERVER_URL: "ftp://box.test" }, "h")).toThrow(
      /WAITRON_SERVER_URL/,
    );
  });

  it("refuses a port that is not an integer in 1..65535", () => {
    expect(() => readEnv({ WAITRON_SETUP_PORT: "abc" }, "h")).toThrow(/WAITRON_SETUP_PORT/);
    expect(() => readEnv({ WAITRON_SETUP_PORT: "0" }, "h")).toThrow(/WAITRON_SETUP_PORT/);
    expect(() => readEnv({ WAITRON_SETUP_PORT: "70000" }, "h")).toThrow(/WAITRON_SETUP_PORT/);
    expect(() => readEnv({ WAITRON_SETUP_PORT: "80.5" }, "h")).toThrow(/WAITRON_SETUP_PORT/);
  });
});
