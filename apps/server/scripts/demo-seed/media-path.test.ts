import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, it } from "vitest";
import * as media from "./seed-media.js";

it("resolves source assets and installed roots with the same dataset directory", () => {
  expect(media).toHaveProperty("demoMediaPath");
  expect(media.demoMediaPath("casa-delgado-es", "negroni.png", undefined)).toBe(
    fileURLToPath(
      new URL(
        "../../../../packages/country-es/demo-media/casa-delgado-es/negroni.png",
        import.meta.url,
      ),
    ),
  );
  expect(media.demoMediaPath("casa-delgado-es", "negroni.png", "/app/demo-media")).toBe(
    join("/app/demo-media", "casa-delgado-es", "negroni.png"),
  );
  expect(media.demoMediaPath("casa-delgado-es", "negroni.png", "")).toBe(
    media.demoMediaPath("casa-delgado-es", "negroni.png", undefined),
  );
});
it("refuses unregistered datasets and filenames that can leave their directory", () => {
  expect(media).toHaveProperty("demoMediaPath");
  for (const set of ["unknown", "../casa-delgado-es", "constructor", "__proto__"])
    expect(() => media.demoMediaPath(set, "negroni.png", "/app/demo-media")).toThrow(/dataset/);
  for (const name of [
    "../negroni.png",
    "nested/negroni.png",
    "\\negroni.png",
    "",
    ".",
    "..",
    "/negroni.png",
  ])
    expect(() => media.demoMediaPath("casa-delgado-es", name, "/app/demo-media")).toThrow(
      /basename/,
    );
});
