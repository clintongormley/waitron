import "./errors.js";
import { open, type FileHandle } from "node:fs/promises";
import { AppError } from "@waitron/shared";
import { parseInitialVenueInput, type InitialVenueInput } from "./initial-venue-input.js";

export async function readInitialVenueFile(path: string): Promise<InitialVenueInput> {
  let file: FileHandle | undefined;
  try {
    file = await open(path, "r");
    const buffer = Buffer.alloc(131073);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, null);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count > 131072) throw new AppError("provisioning.initial_input_invalid", {});
    const parsed = parseInitialVenueInput(JSON.parse(buffer.subarray(0, count).toString("utf8")));
    if (parsed === null) throw new AppError("provisioning.initial_input_invalid", {});
    return parsed;
  } catch {
    throw new AppError("provisioning.initial_input_invalid", {});
  } finally {
    await file?.close();
  }
}
