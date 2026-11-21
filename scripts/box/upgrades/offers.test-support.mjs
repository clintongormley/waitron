import { generateKeyPairSync } from "node:crypto";
import { copyFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { URL } from "node:url";
import { signUpgradeOffer } from "../release-list.mjs";

export async function offerTrustFixture(root, boxId) {
  const trust = join(root, "trust generation #1");
  const link = join(root, "release-trust");
  await mkdir(join(trust, "upgrades"), { recursive: true });
  await copyFile(new URL("../release-list.mjs", import.meta.url), join(trust, "release-list.mjs"));
  await copyFile(
    new URL("./contracts.mjs", import.meta.url),
    join(trust, "upgrades/contracts.mjs"),
  );
  await symlink(trust, link);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const current = generateKeyPairSync("ed25519").publicKey;
  await writeFile(join(trust, "current.pem"), current.export({ type: "spki", format: "pem" }));
  await writeFile(join(trust, "spare.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const offer = (serial, target) =>
    signUpgradeOffer(
      {
        format: 1,
        kind: "offer",
        serial,
        default: "none",
        entries: [{ condition: { installations: [boxId] }, target }],
      },
      privateKey.export({ type: "pkcs8", format: "pem" }),
    );
  return { link, offer, trust };
}
