import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveTradingTls } from "./trading-tls.js";

const dirs: string[] = [];

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "waitron-trading-tls-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("resolveTradingTls", () => {
  it("uses operator TLS before a persisted box leaf", () => {
    const dir = stateDir();
    const operator = { certFile: "/operator/cert.pem", keyFile: "/operator/key.pem" };
    expect(resolveTradingTls({ stateDir: dir, tls: operator })).toBe(operator);
  });

  it("returns the persisted box leaf used by the HTTPS listener", () => {
    const dir = stateDir();
    mkdirSync(join(dir, "tls"));
    writeFileSync(join(dir, "tls", "server.crt"), "certificate");
    writeFileSync(join(dir, "tls", "server.key"), "key");
    expect(resolveTradingTls({ stateDir: dir })).toEqual({
      certFile: join(dir, "tls", "server.crt"),
      keyFile: join(dir, "tls", "server.key"),
    });
  });

  it("returns undefined for a leaf-less HTTP development server", () => {
    expect(resolveTradingTls({ stateDir: stateDir() })).toBeUndefined();
  });
});
