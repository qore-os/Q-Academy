import { expect, test } from "@playwright/test";

test("pages and APIs expose the global browser security policy", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Header contract runs once");

  for (const path of [
    "/",
    "/login",
    "/password/forgot",
    "/robots.txt",
    "/sitemap.xml",
    "/api/v1/health/live",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBeLessThan(400);
    expect(response.headers()["x-powered-by"], path).toBeUndefined();
  }

  for (const path of ["/login", "/api/v1/health/live"]) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    const headers = response.headers();

    if (path === "/login") {
      const policy = headers["content-security-policy"];
      const nonce = policy.match(/'nonce-([A-Za-z0-9_-]{32,128})'/)?.[1];
      expect(nonce).toBeTruthy();
      expect(policy).toContain("default-src 'self'");
      expect(policy).toContain("script-src-attr 'none'");
      expect(policy).toContain("frame-ancestors 'self'");
      expect(policy).not.toMatch(/script-src [^;]*'unsafe-inline'/);
      expect(await response.text()).toContain(`nonce="${nonce}"`);
    } else {
      expect(headers["content-security-policy"]).toContain("default-src 'none'");
      expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    }
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["permissions-policy"]).toContain("camera=(self)");
    expect(headers["permissions-policy"]).toContain("microphone=(self)");
    expect(headers["permissions-policy"]).toContain("display-capture=(self)");
    expect(headers["permissions-policy"]).toContain("geolocation=()");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
    expect(headers["origin-agent-cluster"]).toBe("?1");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-dns-prefetch-control"]).toBe("off");
    expect(headers["x-download-options"]).toBe("noopen");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["x-permitted-cross-domain-policies"]).toBe("none");
    expect(headers["x-xss-protection"]).toBe("0");
  }
});

test("nonce policy permits Next.js hydration without CSP violations", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Browser CSP smoke test runs once");
  const policyViolations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|refused to/i.test(message.text())) {
      policyViolations.push(message.text());
    }
  });

  const response = await page.goto("/login");
  expect(response?.ok()).toBe(true);
  const policy = response?.headers()["content-security-policy"] ?? "";
  const nonce = policy.match(/'nonce-([A-Za-z0-9_-]{32,128})'/)?.[1];
  expect(nonce).toBeTruthy();

  const password = page.getByLabel("Passwort", { exact: true });
  await password.fill("nonce-hydration-check");
  await page.getByRole("button", { name: "Passwort anzeigen" }).click();
  await expect(password).toHaveAttribute("type", "text");
  const scripts = await page.locator("script").evaluateAll((elements) =>
    elements.map((element) => {
      const script = element as HTMLScriptElement;
      return { nonce: script.nonce, src: script.src, text: script.textContent ?? "" };
    }),
  );
  const inlineScripts = scripts.filter(
    (script) => !script.src && script.text.trim().length > 0,
  );
  expect(inlineScripts.length).toBeGreaterThan(0);
  expect(inlineScripts.every((script) => script.nonce === nonce)).toBe(true);
  expect(
    scripts
      .filter((script) => script.nonce)
      .every((script) => script.nonce === nonce),
  ).toBe(true);
  expect(policyViolations).toEqual([]);
});
