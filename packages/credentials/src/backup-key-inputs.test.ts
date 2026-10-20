import { describe, expect, it } from "vitest";
import { resolveBackupKeyInputs } from "./backup-key-inputs.js";

const bytes = (value: string) => Buffer.from(value);

describe("captured backup key inputs", () => {
  it("uses later-file precedence including empty values and preserves base64 padding", () => {
    expect(
      resolveBackupKeyInputs({
        secretsEnv: bytes("WAITRON_CREDENTIALS_KEY=first==\nSHARED=one\n"),
        tradingEnv: bytes("SHARED=two\nWAITRON_ACCOUNT_KEY=account==\n"),
        backupEnv: bytes("SHARED=three\nWAITRON_CREDENTIALS_KEY=last==\nWAITRON_ACCOUNT_KEY=\n"),
      }),
    ).toEqual({ WAITRON_CREDENTIALS_KEY: "last==", SHARED: "three", WAITRON_ACCOUNT_KEY: "" });
  });

  it("matches first-equals parsing without shell, quote or inline-comment evaluation", () => {
    expect(
      resolveBackupKeyInputs({
        secretsEnv: bytes(
          "\r\n # comment\nignored\n REPEATED=old\r\nREPEATED=new==\n SPACED = value \nQUOTED='literal'\nINLINE=x # retained\n",
        ),
        tradingEnv: bytes(""),
        backupEnv: null,
      }),
    ).toEqual({
      REPEATED: "new==",
      "SPACED ": " value",
      QUOTED: "'literal'",
      INLINE: "x # retained",
    });
  });

  it("keeps the operational parser's reserved-property behavior", () => {
    const actual = resolveBackupKeyInputs({
      secretsEnv: bytes("__proto__=ignored\nconstructor=own-value\n"),
      tradingEnv: bytes(""),
      backupEnv: null,
    });
    expect(actual).toEqual({ constructor: "own-value" });
    expect(Object.getPrototypeOf(actual)).toBe(Object.prototype);
  });

  it("returns a frozen independent archive-only map", () => {
    const input = bytes("WAITRON_CREDENTIALS_KEY=archive==\n");
    const actual = resolveBackupKeyInputs({
      secretsEnv: input,
      tradingEnv: bytes(""),
      backupEnv: null,
    });
    input.fill(0);
    expect(actual).toEqual({ WAITRON_CREDENTIALS_KEY: "archive==" });
    expect(Object.isFrozen(actual)).toBe(true);
    expect(
      resolveBackupKeyInputs({ secretsEnv: bytes(""), tradingEnv: bytes(""), backupEnv: null }),
    ).toEqual({});
  });
});
