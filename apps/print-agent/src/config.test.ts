import { describe, expect, it } from "vitest";
import { readEnv } from "./config.js";

describe("readEnv", () => {
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
