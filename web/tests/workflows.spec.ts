import { test, expect } from "@playwright/test";

test("station punch retries preserve the action, then reset private data", async ({
  page,
  context,
}) => {
  await page.goto("/kiosk");
  await page.getByRole("button", { name: "Activate preview station" }).click();
  await page.getByLabel("Employee ID", { exact: true }).fill("1001");
  await page.getByLabel("Private PIN", { exact: true }).fill("246810");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hi, Alex." })).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "tc-punch")?.httpOnly).toBe(true);
  expect(cookies.find((c) => c.name === "tc-terminal")?.httpOnly).toBe(true);
  const button = page.getByRole("button", { name: /^Clock (in|out)$/ });
  const action = await button.innerText();
  let requestId = "";
  let calls = 0;
  await page.route("**/api/kiosk/punch", async (route) => {
    const body = route.request().postDataJSON();
    if (calls++ === 0) {
      requestId = body.request_id;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Confirmation interrupted. Retry the same punch.",
        }),
      });
    } else {
      expect(body.request_id).toBe(requestId);
      await route.continue();
    }
  });
  await button.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Confirmation interrupted" }),
  ).toBeVisible();
  await button.click();
  await expect(
    page.getByRole("heading", {
      name: action.includes("out") ? "Clocked out." : "Clocked in.",
    }),
  ).toBeVisible();
  await page.unroute("**/api/kiosk/punch");
  await expect(page.getByLabel("Employee ID", { exact: true })).toBeVisible({
    timeout: 9000,
  });
  await expect(page.getByLabel("Employee ID", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Private PIN", { exact: true })).toHaveValue("");
  await expect(page.getByText("Alex Morgan,")).not.toBeVisible();
  // Finish in the clocked-out state to keep the preview tidy.
  if (!action.includes("out")) {
    await page.getByLabel("Employee ID", { exact: true }).fill("1001");
    await page.getByLabel("Private PIN", { exact: true }).fill("246810");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Clock out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Clocked out." }),
    ).toBeVisible();
  }
});

test("employee history and manager boundary; manager can provision and correct", async ({
  page,
}) => {
  await page.goto("/hours");
  await expect(
    page.getByRole("heading", { name: "My hours", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Shift history" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      async () => (await fetch("/api/admin/overview")).status,
    ),
  ).toBe(403);
  await page.getByLabel("Preview identity").selectOption("1002");
  await page.getByRole("link", { name: "Team overview" }).click();
  await expect(
    page.getByRole("heading", { name: "Team overview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  const id = String(Date.now()).slice(-9);
  await page.getByLabel("Full name").fill("Browser Test " + id);
  await page.getByLabel("Pathway email").fill(`test${id}@pathwaybook.com`);
  await page.getByLabel("Employee ID", { exact: true }).fill(id);
  await page.getByLabel("Private PIN", { exact: true }).fill("987654");
  await page.getByRole("button", { name: "Create employee" }).click();
  await expect(page.getByRole("status")).toContainText("Employee created");
  await page
    .getByRole("button", {
      name: `Browser Test ${id} test${id}@pathwaybook.com`,
    })
    .click();
  await page.getByRole("button", { name: "Add missed shift" }).click();
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await page.getByLabel("Clock-in", { exact: true }).fill(`${day}T08:00`);
  await page.getByLabel("Clock-out", { exact: true }).fill(`${day}T16:00`);
  await page
    .getByLabel("Manager’s reason")
    .fill("Browser test verified a missed shift.");
  await page.getByRole("button", { name: "Save audited correction" }).click();
  await expect(page.getByRole("status")).toContainText("Correction saved");
  await page.getByRole("button", { name: "Audit trail", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Browser test verified a missed shift.",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export hours" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/pathway-hours/);
});

test("phone layout, themes, CSRF protection and screenshot evidence", async ({
  page,
}) => {
  await page.goto("/hours");
  await expect(
    page.getByRole("heading", { name: "Shift history" }),
  ).toBeVisible();
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible();
  await page.screenshot({
    path: "../artifacts/my-hours-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({
    path: "../artifacts/my-hours-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../artifacts/my-hours-mobile.png",
    fullPage: true,
  });
  const denied = await page.request.post("/api/demo-user", {
    headers: { origin: "https://evil.test" },
    data: { code: "1002" },
  });
  expect(denied.status()).toBe(403);
  await page.goto("/kiosk");
  await page.getByRole("button", { name: "Activate preview station" }).click();
  await expect(page.getByLabel("Employee ID", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../artifacts/kiosk-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await page.screenshot({
    path: "../artifacts/kiosk-desktop.png",
    fullPage: true,
  });
});
