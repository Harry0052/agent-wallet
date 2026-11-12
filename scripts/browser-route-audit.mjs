import { chromium } from "playwright";

const baseUrl = process.env.CALICO_BASE_URL || "http://127.0.0.1:3000";
const email = process.env.CALICO_SMOKE_EMAIL || "calico-route-smoke-1773892979235@example.com";
const password = process.env.CALICO_SMOKE_PASSWORD || "CalicoTest123";
const mode = process.argv[2] || "starter";

const scenarios = {
  starter: [
    { path: "/home", expect: "Money Overview" },
    { path: "/accounts", expect: "Accounts" },
    { path: "/transactions", expect: "Transactions" },
    { path: "/budgets", expect: "Create budget" },
    { path: "/cashflow", expect: "Cash Flow" },
    { path: "/reports", expect: "Reports" },
    { path: "/settings", expect: "Settings" },
    { path: "/goals", expect: "Part of the Pro plan." },
    { path: "/insights", expect: "Part of the Pro plan." },
    { path: "/investments", expect: "Part of the Fully Autonomous plan." },
    { path: "/tasks", expect: "Part of the Fully Autonomous plan." },
    { path: "/automations", expect: "Part of the Fully Autonomous plan." },
  ],
  pro: [
    { path: "/home", expect: "Money Overview" },
    { path: "/goals", expect: "Money Goals", reject: "See Plans" },
    { path: "/insights", expect: "What Agent Wallet Noticed", reject: "See Plans" },
    { path: "/investments", expect: "Part of the Fully Autonomous plan." },
    { path: "/tasks", expect: "Part of the Fully Autonomous plan." },
    { path: "/automations", expect: "Part of the Fully Autonomous plan." },
  ],
  autonomous: [
    { path: "/home", expect: "Money Overview" },
    { path: "/investments", expect: "Investments", reject: "See Plans" },
    { path: "/tasks", expect: "To-Do", reject: "See Plans" },
    { path: "/automations", expect: "Automations", reject: "See Plans" },
  ],
};

if (!scenarios[mode]) {
  throw new Error(`Unsupported audit mode: ${mode}`);
}

function log(...args) {
  console.log("[browser-route-audit]", ...args);
}

async function dismissTutorialIfVisible(page) {
  const button = page.getByRole("button", { name: /skip tutorial/i }).first();
  try {
    await button.waitFor({ state: "visible", timeout: 2500 });
    await button.click();
    await page.waitForTimeout(400);
  } catch {
    // Tutorial not present.
  }
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: /email/i }).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL("**/home", { timeout: 20000 });
  await dismissTutorialIfVisible(page);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page);

    for (const scenario of scenarios[mode]) {
      await page.goto(`${baseUrl}${scenario.path}`, { waitUntil: "domcontentloaded" });
      await dismissTutorialIfVisible(page);
      await page.getByText(scenario.expect).first().waitFor({ timeout: 15000 });

      if (scenario.reject) {
        const bodyText = await page.locator("body").innerText();
        if (bodyText.includes(scenario.reject)) {
          throw new Error(`Route ${scenario.path} unexpectedly contained "${scenario.reject}" in ${mode} mode.`);
        }
      }

      log(mode, scenario.path, "ok");
    }

    log("completed", mode);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[browser-route-audit] failed", error);
  process.exitCode = 1;
});
