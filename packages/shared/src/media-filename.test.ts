import { describe, expect, it } from "vitest";
import { MEDIA_FILENAME } from "./media-filename.js";

const HASH = "0123456789abcdef".repeat(4);

describe("MEDIA_FILENAME", () => {
  it.each(["jpg", "png", "webp"])("accepts a 64-character lowercase hex hash with .%s", (ext) => {
    expect(MEDIA_FILENAME.test(`${HASH}.${ext}`)).toBe(true);
  });

  it.each([
    ["an uppercase hash", `${HASH.toUpperCase()}.png`],
    ["a hash one character short", `${HASH.slice(1)}.png`],
    ["a hash one character long", `${HASH}0.png`],
    ["a letter past f", `${HASH.slice(1)}g.png`],
    ["another extension", `${HASH}.gif`],
    ["a dot that is any other character", `${HASH}xpng`],
    ["no extension", HASH],
    ["text before the hash", `/${HASH}.png`],
    ["text after the extension", `${HASH}.png.txt`],
    ["a path", `../${HASH}.webp`],
  ])("refuses %s", (_, filename) => {
    expect(MEDIA_FILENAME.test(filename)).toBe(false);
  });
});
