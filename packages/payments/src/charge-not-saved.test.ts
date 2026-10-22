import { describe, expect, it } from "vitest";
import { AppError, diskFullIn } from "@waitron/shared";
import { ChargeNotSavedError, saveCharge } from "./charge-not-saved.js";

describe("saveCharge", () => {
  it("answers what the save answers", async () => {
    await expect(saveCharge(() => Promise.resolve("saved"))).resolves.toBe("saved");
  });

  it("turns a full disk into a charge not saved, still read as a full disk", async () => {
    const full = new AppError("storage.disk_full", {});

    const error = await saveCharge(() => Promise.reject(full)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ChargeNotSavedError);
    expect((error as ChargeNotSavedError).cause).toBe(full);
    expect(diskFullIn(error)).toBe(true);
  });

  it("passes any other failure through unchanged", async () => {
    const other = new Error("the save failed");

    await expect(saveCharge(() => Promise.reject(other))).rejects.toBe(other);
  });
});
