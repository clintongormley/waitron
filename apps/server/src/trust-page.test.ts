import { describe, expect, it } from "vitest";
import { CA_CONTENT_TYPE, CA_FILENAME, renderTrustPage } from "./trust-page.js";

describe("renderTrustPage", () => {
  it("renders the CA download link at the given path, reach URLs and the https link", () => {
    const html = renderTrustPage({
      reachUrls: ["https://waitron.local", "https://192.168.1.50"],
      caAvailable: true,
      caDownloadPath: "/setup-api/ca.crt",
      httpsUrl: "https://waitron.local",
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('href="/setup-api/ca.crt"'); // exact link, not a substring
    expect(html).toContain("https://waitron.local");
  });
  it("honours a different caDownloadPath (the landing origin uses /ca.crt)", () => {
    const html = renderTrustPage({
      reachUrls: [],
      caAvailable: true,
      caDownloadPath: "/ca.crt",
      httpsUrl: "https://waitron.local",
    });
    expect(html).toContain('href="/ca.crt"');
    expect(html).not.toContain("/setup-api/ca.crt");
  });
  it("omits the download link when no box CA is present", () => {
    const html = renderTrustPage({
      reachUrls: [],
      caAvailable: false,
      caDownloadPath: "/ca.crt",
      httpsUrl: "https://waitron.local",
    });
    expect(html).not.toContain('href="/ca.crt"');
  });
  it("exposes the CA content-type and filename", () => {
    expect(CA_CONTENT_TYPE).toBe("application/x-x509-ca-cert");
    expect(CA_FILENAME).toBe("waitron-ca.crt");
  });
});
