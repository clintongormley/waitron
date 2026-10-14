import { describe, expect, it } from "vitest";
import { DRIVER_TEARDOWN_MS, parseDriverArgs } from "./aws-rehearsal-interrupt-driver.js";

const BASE = ["--endpoint", "http://127.0.0.1:9000", "--receipt-dir", "/tmp/receipts"];

describe("parseDriverArgs", () => {
  it("takes the teardown limit in whole milliseconds, defaulting it when absent", () => {
    expect(parseDriverArgs([...BASE, "--point", "mid-scenario"])?.teardownMs).toBe(
      DRIVER_TEARDOWN_MS,
    );
    expect(
      parseDriverArgs([...BASE, "--point", "mid-scenario", "--teardown-ms", "2000"])?.teardownMs,
    ).toBe(2000);
  });

  it.each(["0", "2.5", "-1", "1e3", "1234567", ""])("refuses a teardown limit of %j", (value) => {
    expect(
      parseDriverArgs([...BASE, "--point", "mid-scenario", "--teardown-ms", value]),
    ).toBeNull();
  });

  it("takes another bucket with the unplanned point, and needs it there", () => {
    expect(
      parseDriverArgs([...BASE, "--point", "unplanned", "--other-bucket", "other-bucket-1"])
        ?.otherBucket,
    ).toBe("other-bucket-1");
    expect(parseDriverArgs([...BASE, "--point", "unplanned"])).toBeNull();
  });

  it("refuses another bucket with any other point", () => {
    expect(
      parseDriverArgs([...BASE, "--point", "mid-scenario", "--other-bucket", "other-bucket-1"]),
    ).toBeNull();
  });

  it.each(["Other-Bucket", "ab", "-other", "other-", "other_bucket", "a".repeat(64)])(
    "refuses another bucket named %j",
    (name) => {
      expect(parseDriverArgs([...BASE, "--point", "unplanned", "--other-bucket", name])).toBeNull();
    },
  );
});
