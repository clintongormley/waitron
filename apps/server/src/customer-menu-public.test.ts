import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkServerIdentity } from "node:tls";
import {
  CORE_CHANGE_SOURCES,
  CORE_MIGRATIONS,
  customerMenuStyles,
  installChangeFeed,
  withTransaction,
} from "@waitron/db";
import { seedPerson, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { MEDIA_CHANGE_SOURCES, uploadImage } from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import {
  addProductToMenu,
  addProducts,
  createMenu,
  createSectionIn,
  createProduct,
  readCustomerMenuStyles,
  writeCustomerMenuStyle,
  MENU_CHANGE_SOURCES,
  previewMenu,
  publishMenu,
  queueMenuPublication,
  readMenuStructure,
  saveCustomerMenuOnlineSettings,
  updateMenuDetails,
  writeContentLanguages,
} from "@waitron/menu";
import * as menuPackage from "@waitron/menu";
import { AppError } from "@waitron/shared";
import { expect, it, onTestFinished, vi } from "vitest";
import { createCustomerMenuApp, startCustomerMenuListener } from "./customer-menu-public.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { createPublicMenuView } from "./customer-menu-public-view.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const online = { enabled: true, address: "lunch", photos: "small", styleId: null } as const;

async function fixture(
  withPhoto = false,
  {
    inSection = false,
    photos = online.photos,
  }: { inSection?: boolean; photos?: "small" | "large" } = {},
) {
  await installChangeFeed(suite.db, [
    ...CORE_CHANGE_SOURCES,
    ...MENU_CHANGE_SOURCES,
    ...MEDIA_CHANGE_SOURCES,
  ]);
  await seedVenue(suite.db, { name: "Venue" });
  const prepared = withPhoto ? await samplePreparedImage({ width: 24 }) : undefined;
  const { menu, person, photo } = await withTransaction(suite.db, async (tx) => {
    const person = await seedPerson(tx);
    await tx.insert(customerMenuStyles).values({
      name: "Default",
      nameKey: "default",
      isDefault: true,
      appearance: {},
    });
    await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] });
    const menu = await createMenu(tx, { name: "Lunch", names: { en: "Lunch", es: "Menu" } });
    const photo = prepared
      ? (await uploadImage(tx, { image: prepared, names: { en: "Soup" } })).image
      : null;
    if (photo) {
      const product = await createProduct(tx, {
        name: "Soup",
        categoryId: null,
        unitId: null,
        unitPrice: "5.00",
        image: photo.filename,
      });
      if (inSection) {
        const { rootSectionId } = await readMenuStructure(tx, menu.id);
        const section = await createSectionIn(tx, rootSectionId, { internalName: "Starters" });
        await addProducts(tx, section.id, [product.id]);
      } else await addProductToMenu(tx, { menuId: menu.id, productId: product.id });
    }
    await publishMenu(tx, menu.id, (await previewMenu(tx, menu.id)).hash, person);
    await saveCustomerMenuOnlineSettings(tx, menu.id, { ...online, photos });
    return { menu, person, photo };
  });
  const view = createPublicMenuView(suite.db, "en");
  onTestFinished(() => view.close());
  return { menu, person, photo, view };
}

it("redraws the published text after a new edition and removes an address switched off", async () => {
  const { menu, person, view } = await fixture();
  const english = async () => (await view.read()).menus.get("lunch")?.get("en")?.menu.name;
  expect(await english()).toBe("Lunch");
  await withTransaction(suite.db, (tx) =>
    updateMenuDetails(tx, menu.id, { names: { en: "Dinner", es: "Menu" } }),
  );
  expect(await english()).toBe("Lunch");
  await withTransaction(suite.db, async (tx) =>
    publishMenu(tx, menu.id, (await previewMenu(tx, menu.id)).hash, person),
  );
  expect(await english()).toBe("Dinner");
  await withTransaction(suite.db, (tx) =>
    saveCustomerMenuOnlineSettings(tx, menu.id, { ...online, enabled: false }),
  );
  expect(await english()).toBeUndefined();
});

it("serves a scheduled edition at its due time before the activation job writes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const startsAt = Date.now();
  const { menu, person, view } = await fixture();
  const due = startsAt + 60_000;
  await withTransaction(suite.db, async (tx) => {
    await updateMenuDetails(tx, menu.id, { names: { en: "Dinner", es: "Menu" } });
    await queueMenuPublication(
      tx,
      menu.id,
      (await previewMenu(tx, menu.id)).hash,
      new Date(due),
      person,
    );
  });
  const english = async () => (await view.read()).menus.get("lunch")?.get("en")?.menu.name;
  vi.setSystemTime(due - 1);
  expect(await english()).toBe("Lunch");
  vi.setSystemTime(due);
  expect(await english()).toBe("Dinner");
});

it("refreshes enabled languages and the prepared style without republishing", async () => {
  const { menu, view } = await fixture();
  expect((await view.read()).menus.get("lunch")?.get("es")?.menu.name).toBe("Menu");
  await withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en"] });
    const [style] = await readCustomerMenuStyles(tx, menu.id);
    await writeCustomerMenuStyle(tx, menu.id, style!.id, { pageColor: "#101216" });
  });
  const snapshots = (await view.read()).menus.get("lunch");
  expect([...snapshots!.keys()]).toEqual(["en"]);
  expect(snapshots?.get("en")?.appearance).toMatchObject({
    scheme: "dark",
    tokens: { "--wt-color-bg": "#101216" },
  });
});

it("serves the saved named style without publishing another menu edition", async () => {
  const { menu, view } = await fixture();
  const appearance = async () => (await view.read()).menus.get("lunch")?.get("en")?.appearance;
  expect((await appearance())?.tokens["--wt-color-bg"]).not.toBe("#1f2928");
  await withTransaction(suite.db, async (tx) => {
    const [style] = await tx
      .insert(customerMenuStyles)
      .values({ name: "Terrace", nameKey: "terrace", appearance: { pageColor: "#1f2928" } })
      .returning();
    await saveCustomerMenuOnlineSettings(tx, menu.id, { ...online, styleId: style!.id });
  });
  expect(await appearance()).toMatchObject({
    scheme: "dark",
    tokens: { "--wt-color-bg": "#1f2928" },
  });
});

it("renders only the exact public photo recipe and withdraws it when photos are turned off", async () => {
  const { menu, photo, view } = await fixture(true);
  const path = `/_customer-menu/photos/v1/${photo!.filename}/square/5000-5000-100.webp`;
  expect((await view.read()).menus.get("lunch")?.get("en")?.photoUrls).toEqual({
    [photo!.filename]: path,
  });
  expect(await view.readPhoto(path.replace("/square/", "/display/"))).toBeNull();
  expect(
    Buffer.from((await view.readPhoto(path))!)
      .subarray(8, 12)
      .toString(),
  ).toBe("WEBP");
  await withTransaction(suite.db, (tx) =>
    saveCustomerMenuOnlineSettings(tx, menu.id, { ...online, photos: "none" }),
  );
  expect(await view.readPhoto(path)).toBeNull();
});

async function guestBuild(index = guestIndex) {
  const root = await mkdtemp(join(tmpdir(), "wt-customer-build-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "assets/fonts"), { recursive: true });
  await writeFile(join(root, "assets/menu-123.js"), "export {};");
  await writeFile(join(root, "favicon.svg"), "<svg></svg>");
  await writeFile(join(root, "notes.txt"), "Not an icon");
  await writeFile(join(root, "index.html"), index);
  return root;
}
const guestIndex =
  '<html lang="en"><title>Menu</title><script type="application/json" id="customer-menu-data"></script></html>';

async function httpsFixture() {
  const f = await fixture(true);
  const stateDir = await mkdtemp(join(tmpdir(), "wt-customer-"));
  onTestFinished(() => rm(stateDir, { recursive: true, force: true }));
  const hostname = "staff.waitron.local";
  const socketPath = join(stateDir, "customer-menu.sock");
  const root = await guestBuild();
  await mkdir(join(stateDir, "cloud"));
  await writeFile(join(root, "THIRD-PARTY-NOTICES.txt"), "Notices");
  let ca: string;
  async function install() {
    const cert = mintSelfSignedServerCert({
      now: new Date(),
      hostnames: [hostname],
      ipAddresses: [],
    });
    await writeFile(join(stateDir, "cloud/staff.key"), cert.serverKeyPem);
    await writeFile(join(stateDir, "cloud/staff.crt"), cert.serverCertPem);
    ca = cert.caCertPem;
  }
  await install();
  let remoteAccess = true;
  let serving = true;
  const listener = startCustomerMenuListener(
    { root, socketPath, stateDir },
    f.view,
    () => {},
    async () => remoteAccess,
    () => serving,
  );
  onTestFinished(() => listener?.close());
  expect(listener?.isListening()).toBe(true);
  return {
    ...f,
    setRemoteAccess(enabled: boolean) {
      remoteAccess = enabled;
    },
    stepDown: () => {
      serving = false;
    },
    async renew() {
      await install();
      listener!.checkNow();
    },
    ask(path: string, method = "GET", host = hostname, servername = hostname) {
      return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>(
        (resolve, reject) => {
          const req = request(
            {
              socketPath,
              path,
              method,
              servername,
              checkServerIdentity: (_name, certificate) =>
                checkServerIdentity(hostname, certificate),
              ca,
              agent: false,
              headers: { Host: host },
            },
            async (res) => {
              let body = "";
              for await (const chunk of res) body += chunk;
              resolve({ status: res.statusCode!, body, headers: res.headers });
            },
          );
          req
            .on("error", reject)
            .setTimeout(4000, () => req.destroy(new Error("Customer request timed out")));
          req.end();
        },
      );
    },
  };
}

it("serves the guest snapshot and exact HTTPS reads, with relative redirects and no staff routes", async () => {
  const { ask } = await httpsFixture();
  for (const path of ["/", "/lunch"])
    expect(await ask(path)).toMatchObject({ status: 302, headers: { location: "/lunch/en" } });
  expect(await ask("/lunch/es")).toMatchObject({
    status: 200,
    body: expect.stringContaining('"language":"es"'),
    headers: { "cache-control": "public, max-age=60" },
  });
  expect(await ask("/lunch/es", "HEAD")).toMatchObject({ status: 200, body: "" });
  expect(await ask("/_customer-menu/assets/menu-123.js")).toMatchObject({
    status: 200,
    body: "export {};",
    headers: { "cache-control": "public, max-age=31536000, immutable" },
  });
  for (const path of [
    "/management-api/session",
    "/management-api/session?source=social",
    "/lunch/fr",
    "/lunch/en/dish/1",
    "/_customer-menu/THIRD-PARTY-NOTICES.txt",
    "/_customer-menu/assets/menu-456.js",
  ])
    expect((await ask(path)).status, path).toBe(404);
  expect((await ask("/lunch/en", "POST")).status).toBe(404);
  expect((await ask("/lunch/en", "GET", "other.waitron.local")).status).toBe(404);
  expect((await ask("/lunch/en", "GET", "staff.waitron.local", "other.waitron.local")).status).toBe(
    404,
  );
});

it("strips queries only from page paths", async () => {
  const { ask, photo } = await httpsFixture();
  for (const path of ["/", "/lunch", "/lunch/en"])
    expect(await ask(path + "?source=social")).toMatchObject({
      status: 302,
      headers: { location: path },
    });
  for (const path of [
    "/_customer-menu/assets/menu-123.js",
    `/_customer-menu/photos/v1/${photo!.filename}/square/5000-5000-100.webp`,
  ]) {
    expect((await ask(path)).status).toBe(200);
    expect((await ask(path + "?source=social")).status).toBe(404);
  }
});

it("keeps the customer socket on the staff certificate renewal path", async () => {
  const { ask, renew } = await httpsFixture();
  expect((await ask("/lunch/en")).status).toBe(200);
  await renew();
  expect((await ask("/lunch/en")).status).toBe(200);
});

it("refuses even installed assets after the serving gate closes", async () => {
  const { ask, setRemoteAccess, stepDown } = await httpsFixture();
  expect((await ask("/_customer-menu/assets/menu-123.js")).status).toBe(200);
  setRemoteAccess(false);
  expect((await ask("/lunch/en")).status).toBe(404);
  stepDown();
  expect((await ask("/lunch/en")).status).toBe(404);
  setRemoteAccess(true);
  for (const path of ["/_customer-menu/assets/menu-123.js", "/lunch/en"])
    expect(await ask(path)).toMatchObject({
      status: 503,
      headers: { "cache-control": "no-store" },
    });
});

it("finds photos inside sections and serves large photos in the display shape", async () => {
  const { photo, view } = await fixture(true, { inSection: true, photos: "large" });
  const path = `/_customer-menu/photos/v1/${photo!.filename}/display/5000-5000-100.webp`;
  expect((await view.read()).menus.get("lunch")?.get("en")?.photoUrls).toEqual({
    [photo!.filename]: path,
  });
  expect(
    Buffer.from((await view.readPhoto(path))!)
      .subarray(8, 12)
      .toString(),
  ).toBe("WEBP");
});

it("builds one view for reads that arrive together", async () => {
  const { view } = await fixture();
  const builds = vi.spyOn(menuPackage, "readLiveDocuments");
  onTestFinished(() => builds.mockRestore());
  const [first, second] = await Promise.all([view.read(), view.read()]);
  expect(second).toBe(first);
  expect(builds).toHaveBeenCalledOnce();
});

const ask = (app: { request(path: string): Response | Promise<Response> }, path: string) =>
  app.request(`http://menu.example${path}`);

it("refuses to start from a guest build without the snapshot slot", async () => {
  const { view } = await fixture();
  const root = await guestBuild('<html lang="en"><title>Menu</title></html>');
  expect(() =>
    createCustomerMenuApp(
      root,
      view,
      async () => true,
      () => {},
    ),
  ).toThrow("Customer menu snapshot slot missing");
});

it("serves the guest build's icons with a short cache and nothing else beside them", async () => {
  const { view } = await fixture();
  const app = createCustomerMenuApp(
    await guestBuild(),
    view,
    async () => true,
    () => {},
  );
  const icon = await ask(app, "/_customer-menu/favicon.svg");
  expect(icon.status).toBe(200);
  expect(icon.headers.get("cache-control")).toBe("public, max-age=60");
  expect(icon.headers.get("content-type")).toContain("image/svg+xml");
  expect(await icon.text()).toBe("<svg></svg>");
  for (const path of ["/_customer-menu/notes.txt", "/_customer-menu/assets/fonts"])
    expect((await ask(app, path)).status, path).toBe(404);
});

it("lists every published menu on the front page, and finds nothing for an unknown one", async () => {
  const { person, view } = await fixture();
  await withTransaction(suite.db, async (tx) => {
    const dinner = await createMenu(tx, { name: "Dinner", names: { en: "Dinner & <late>" } });
    await publishMenu(tx, dinner.id, (await previewMenu(tx, dinner.id)).hash, person);
    await saveCustomerMenuOnlineSettings(tx, dinner.id, { ...online, address: "dinner" });
  });
  const app = createCustomerMenuApp(
    await guestBuild(),
    view,
    async () => true,
    () => {},
  );
  const front = await ask(app, "/");
  expect(front.status).toBe(200);
  expect(front.headers.get("cache-control")).toBe("public, max-age=60");
  const html = await front.text();
  expect(html).toContain('<html lang="en">');
  expect(html).toContain(
    '<ul><li><a href="/dinner/en">Dinner &amp; &lt;late&gt;</a></li><li><a href="/lunch/en">Lunch</a></li></ul>',
  );
  for (const path of ["/supper", "/supper/en", "/_customer-menu/photos/v1/missing.webp"])
    expect((await ask(app, path)).status, path).toBe(404);
});

it("finds no front page when no menu is online", async () => {
  const { menu, view } = await fixture();
  await withTransaction(suite.db, (tx) =>
    saveCustomerMenuOnlineSettings(tx, menu.id, { ...online, enabled: false }),
  );
  const app = createCustomerMenuApp(
    await guestBuild(),
    view,
    async () => true,
    () => {},
  );
  expect((await ask(app, "/")).status).toBe(404);
});

it("asks guests to retry once eight requests are already waiting", async () => {
  const { view } = await fixture();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let waiting = 0;
  const app = createCustomerMenuApp(
    await guestBuild(),
    view,
    async () => {
      waiting++;
      await held;
      return true;
    },
    () => {},
  );
  const first = Array.from({ length: 8 }, () => ask(app, "/lunch/en"));
  await vi.waitFor(() => expect(waiting).toBe(8));
  const refused = await ask(app, "/lunch/en");
  expect(refused.status).toBe(429);
  expect(refused.headers.get("retry-after")).toBe("1");
  release();
  expect((await Promise.all(first)).map(({ status }) => status)).toEqual(Array(8).fill(200));
});

it("refuses a reply larger than 2 MiB", async () => {
  const { view } = await fixture();
  const root = await guestBuild();
  await writeFile(join(root, "assets/huge.js"), Buffer.alloc(2 * 1024 * 1024 + 1));
  const app = createCustomerMenuApp(
    root,
    view,
    async () => true,
    () => {},
  );
  expect((await ask(app, "/_customer-menu/assets/huge.js")).status).toBe(503);
  expect((await ask(app, "/_customer-menu/assets/menu-123.js")).status).toBe(200);
});

it("answers 503 when the box steps down while a menu or photo is being read", async () => {
  const { photo, view } = await fixture(true);
  let serving = true;
  const app = createCustomerMenuApp(
    await guestBuild(),
    {
      read: async () => {
        const read = await view.read();
        serving = false;
        return read;
      },
      readPhoto: async (path) => {
        const bytes = await view.readPhoto(path);
        serving = false;
        return bytes;
      },
    },
    async () => true,
    () => {},
    () => serving,
  );
  expect((await ask(app, "/lunch/en")).status).toBe(503);
  serving = true;
  const photoPath = `/_customer-menu/photos/v1/${photo!.filename}/square/5000-5000-100.webp`;
  const refused = await ask(app, photoPath);
  expect(refused.status).toBe(503);
  expect(refused.headers.get("cache-control")).toBe("no-store");
});

it("asks guests to retry while the photo renderer is busy", async () => {
  const { photo, view } = await fixture(true);
  const log = vi.fn();
  const app = createCustomerMenuApp(
    await guestBuild(),
    {
      read: view.read,
      readPhoto: async () => {
        throw new AppError("image.busy", {});
      },
    },
    async () => true,
    log,
  );
  const busy = await ask(
    app,
    `/_customer-menu/photos/v1/${photo!.filename}/square/5000-5000-100.webp`,
  );
  expect(busy.status).toBe(429);
  expect(busy.headers.get("retry-after")).toBe("1");
  expect(log).not.toHaveBeenCalled();
});

it("logs a failed menu read and answers 503", async () => {
  const { view } = await fixture();
  const log = vi.fn();
  const app = createCustomerMenuApp(
    await guestBuild(),
    {
      read: async () => {
        throw new AppError("storage.disk_full", {});
      },
      readPhoto: view.readPhoto,
    },
    async () => true,
    log,
  );
  expect((await ask(app, "/lunch/en")).status).toBe(503);
  expect(log).toHaveBeenCalledWith("warn", "server.customer_menu_read_failed", {
    errorCode: "storage.disk_full",
  });
});

it("answers 503 when a menu read takes longer than four seconds", async () => {
  const { view } = await fixture();
  const app = createCustomerMenuApp(
    await guestBuild(),
    { read: () => new Promise(() => {}), readPhoto: view.readPhoto },
    async () => true,
    () => {},
  );
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const answer = ask(app, "/lunch/en");
  await vi.advanceTimersByTimeAsync(3999);
  let settled = false;
  void Promise.resolve(answer).then(() => (settled = true));
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await answer).status).toBe(503);
});
