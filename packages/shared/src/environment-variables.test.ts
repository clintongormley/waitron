import { describe, expect, it } from "vitest";
import * as shared from "./index.js";

describe("the environment list", () => {
  it("reads a value verbatim, including an empty string", () => {
    expect(shared.readVariable).toEqual(expect.any(Function));
    expect(shared.readVariable({ WAITRON_HTTP_PORT: "" }, "WAITRON_HTTP_PORT")).toBe("");
    expect(shared.readVariable({}, "WAITRON_HTTP_PORT")).toBeUndefined();
  });

  it("reports unknown Waitron names in order and recognises separately supplied names", () => {
    const env = { WAITRON_ZZZ: "1", WAITRON_AAA: "", WAITRON_HTTP_PORT: "1", PATH: "/bin" };
    expect(shared.unknownVariables).toEqual(expect.any(Function));
    expect(shared.unknownVariables(env)).toEqual(["WAITRON_AAA", "WAITRON_ZZZ"]);
    expect(shared.unknownVariables(env, ["WAITRON_AAA"])).toEqual(["WAITRON_ZZZ"]);
    expect(shared.unknownVariables({})).toEqual([]);
  });

  it("gives each box file exactly the names that file writes", () => {
    expect(shared.BOX_FILE_VARIABLES).toEqual({
      "trading.env": ["WAITRON_ENV", "WAITRON_NODE_ID", "WAITRON_ONBOARDING_INTENT"],
      "secrets.env": [
        "WAITRON_CREDENTIALS_KEY",
        "WAITRON_CREDENTIALS_KEY_PREVIOUS",
        "WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION",
        "WAITRON_CREDENTIALS_KEY_VERSION",
      ],
      "backup.env": ["WAITRON_BACKUP_KEY_ROTATED_AT", "WAITRON_BACKUP_RECOVERY_KEY"],
    });
  });

  it("keeps key material and command secrets private and gives keys no default", () => {
    expect(shared.ENVIRONMENT_VARIABLES).toEqual(expect.any(Object));
    for (const [name, spec] of Object.entries(shared.ENVIRONMENT_VARIABLES)) {
      if (spec.kind === "key") {
        expect(spec.secret, name).toBe(true);
        expect(spec.default, name).toBeUndefined();
      }
    }
    for (const name of [
      "WAITRON_BREAKGLASS_PASSWORD",
      "WAITRON_BREAKGLASS_PIN",
      "WAITRON_ADMIN_PIN",
      "WAITRON_ADMIN_PASSWORD",
    ] as const) {
      expect(shared.ENVIRONMENT_VARIABLES[name].secret, name).toBe(true);
    }
  });

  it("declares only uppercase Waitron variable names", () => {
    expect(shared.ENVIRONMENT_VARIABLES).toEqual(expect.any(Object));
    for (const name of Object.keys(shared.ENVIRONMENT_VARIABLES)) {
      expect(name).toMatch(/^WAITRON_[A-Z0-9_]*[A-Z0-9]$/);
    }
  });
});
