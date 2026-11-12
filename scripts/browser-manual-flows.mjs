import { chromium } from "playwright";

const baseUrl = process.env.AGENT_WALLET_BASE_URL || "http://127.0.0.1:3000";
const email = process.env.AGENT_WALLET_SMOKE_EMAIL || "agent-wallet-route-smoke-1773892979235@example.com";
const password = process.env.AGENT_WALLET_SMOKE_PASSWORD || "AgentWalletTest123";
const flow = process.argv[2] || "all";

function log(...args) {
  console.log("[browser-manual-flows]", ...args);
}

async function waitForTextWithDebug(page, text, timeout) {
  try {
    await page.getByText(text).waitFor({ timeout });
  } catch (error) {
    const bodyText = (await page.locator("body").innerText()).slice(0, 2000);
    throw new Error(`Failed while waiting for "${text}" at ${page.url()}\n${bodyText}`, { cause: error });
  }
}

async function waitForButtonWithDebug(page, name, timeout) {
  try {
    await page.getByRole("button", { name }).waitFor({ timeout });
  } catch (error) {
    const bodyText = (await page.locator("body").innerText()).slice(0, 2000);
    throw new Error(`Failed while waiting for button ${String(name)} at ${page.url()}\n${bodyText}`, { cause: error });
  }
}

async function dismissTutorialIfVisible(page) {
  const skip = page.getByRole("button", { name: /skip tutorial/i });
  const button = skip.first();

  try {
    await button.waitFor({ state: "visible", timeout: 2500 });
  } catch {
    return;
  }

  await button.click();
  await page.waitForTimeout(400);
  log("tutorial dismissed");
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: /email/i }).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL("**/home", { timeout: 20000 });
  await dismissTutorialIfVisible(page);
  log("logged in", page.url());
}

async function runAccountsFlow(page) {
  const stamp = Date.now();
  const accountName = `QA Manual Account ${stamp}`;
  const start = Date.now();

  await page.goto(`${baseUrl}/accounts`, { waitUntil: "domcontentloaded" });
  await dismissTutorialIfVisible(page);
  await page.getByRole("heading", { name: "Accounts" }).waitFor({ timeout: 15000 });
  await waitForButtonWithDebug(page, /^Add account$/i, 15000);
  log("accounts shell visible in", `${Date.now() - start}ms`);

  await page.getByRole("button", { name: /^Add account$/i }).click();
  await page.getByRole("button", { name: /^Add account manually Create a manual account/i }).click();
  await page.getByText("Add manual account").waitFor({ timeout: 10000 });

  await page.getByRole("button", { name: /save account/i }).click();
  await page.getByText("Account name is required.").waitFor({ timeout: 5000 });

  await page.getByRole("textbox", { name: /account name/i }).fill(accountName);
  await page.getByRole("combobox", { name: /account type/i }).selectOption("checking");
  await page.getByRole("spinbutton", { name: /current balance/i }).fill("1234.56");
  const institutionInput = page.getByPlaceholder("Select or type institution");
  await institutionInput.fill("Local Credit Union");
  await institutionInput.press("Enter");
  await page.getByRole("textbox", { name: /notes/i }).fill("Browser regression account");
  await page.getByRole("button", { name: /save account/i }).click();

  await waitForTextWithDebug(page, accountName, 10000);
  log("account created", accountName);

  await page.reload({ waitUntil: "domcontentloaded" });
  await dismissTutorialIfVisible(page);
  await waitForButtonWithDebug(page, /^Add account$/i, 15000);
  await waitForTextWithDebug(page, accountName, 15000);
  log("account persisted after reload");
}

async function runTransactionsFlow(page) {
  const stamp = Date.now();
  const merchant = `QA Cafe ${stamp}`;
  const category = `QA Dining ${stamp}`;

  await page.goto(`${baseUrl}/transactions`, { waitUntil: "domcontentloaded" });
  await dismissTutorialIfVisible(page);
  await page.getByRole("heading", { name: "Transactions" }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /^Add$/ }).waitFor({ timeout: 15000 });

  await page.getByRole("button", { name: /^Add$/ }).click();
  await page.getByText("Add manual transaction").waitFor({ timeout: 10000 });

  await page.getByRole("button", { name: /save transaction/i }).click();
  await page.getByText("Amount must be greater than zero.").waitFor({ timeout: 5000 });

  await page.getByRole("spinbutton", { name: /amount/i }).fill("42.15");
  await page.getByRole("combobox", { name: /^Type$/i }).selectOption("expense");

  const categoryInput = page.getByPlaceholder("Select or type a category");
  await categoryInput.fill(category);
  await categoryInput.press("Enter");

  const merchantInput = page.getByPlaceholder("Select or type a name");
  await merchantInput.fill(merchant);
  await merchantInput.press("Enter");

  await page.getByRole("textbox", { name: /notes/i }).fill("Initial transaction note");
  await page.getByRole("button", { name: /save transaction/i }).click();

  const row = page.locator(".aw-card-table > div").filter({ hasText: merchant }).first();
  await row.waitFor({ timeout: 10000 });
  log("transaction created", merchant);

  await row.getByRole("button", { name: "Edit" }).click();
  await page.getByText("Edit manual transaction").waitFor({ timeout: 10000 });
  await page.getByRole("spinbutton", { name: /amount/i }).fill("49.99");
  await page.getByRole("textbox", { name: /notes/i }).fill("Updated transaction note");
  await page.getByRole("button", { name: /save changes/i }).click();

  await page.reload({ waitUntil: "domcontentloaded" });
  const reloadedRow = page.locator(".aw-card-table > div").filter({ hasText: merchant }).first();
  await reloadedRow.waitFor({ timeout: 10000 });
  await reloadedRow.getByText("-$49.99").waitFor({ timeout: 5000 });
  log("transaction updated and persisted");

  await reloadedRow.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: /delete/i }).click();
  await reloadedRow.waitFor({ state: "detached", timeout: 10000 });
  log("transaction deleted cleanly");
}

async function runBudgetsFlow(page) {
  const stamp = Date.now();
  const category = `QA Groceries ${stamp}`;
  const createBudgetButton = page.getByRole("button", { name: /^Create budget$/i }).first();

  await page.goto(`${baseUrl}/budgets`, { waitUntil: "domcontentloaded" });
  await dismissTutorialIfVisible(page);
  await createBudgetButton.waitFor({ timeout: 15000 });

  await createBudgetButton.click();
  await page.getByText("Add a budget category").waitFor({ timeout: 10000 });

  await page.getByRole("button", { name: /save budget/i }).click();
  await page.getByText("Category name is required.").waitFor({ timeout: 5000 });

  const categoryInput = page.getByPlaceholder("Select or type a category");
  await categoryInput.fill(category);
  await categoryInput.press("Enter");
  await page.getByRole("combobox", { name: /^Type$/i }).selectOption("variable");
  await page.getByRole("spinbutton", { name: /^Planned$/i }).fill("500");
  await page.getByRole("spinbutton", { name: /already spent/i }).fill("50");
  await page.getByRole("textbox", { name: /notes/i }).fill("Budget regression item");
  await page.getByRole("button", { name: /save budget/i }).click();

  const row = page.locator(".aw-card-interactive").filter({ hasText: category }).first();
  await row.waitFor({ timeout: 10000 });
  log("budget created", category);

  await row.getByRole("button", { name: "Edit" }).click();
  await page.getByText("Edit category").waitFor({ timeout: 10000 });
  await page.getByRole("spinbutton", { name: /^Planned$/i }).fill("650");
  await page.getByRole("button", { name: /save changes/i }).click();

  await page.reload({ waitUntil: "domcontentloaded" });
  const reloadedRow = page.locator(".aw-card-interactive").filter({ hasText: category }).first();
  await reloadedRow.waitFor({ timeout: 10000 });
  log("budget updated and persisted");

  await reloadedRow.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: /delete line/i }).click();
  await reloadedRow.waitFor({ state: "detached", timeout: 10000 });
  log("budget deleted cleanly");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("pageerror", (error) => {
    console.error("[browser-manual-flows][pageerror]", error.stack || error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      console.error(`[browser-manual-flows][console:${message.type()}]`, message.text());
    }
  });

  try {
    await login(page);

    if (flow === "all" || flow === "accounts") {
      await runAccountsFlow(page);
    }
    if (flow === "all" || flow === "transactions") {
      await runTransactionsFlow(page);
    }
    if (flow === "all" || flow === "budgets") {
      await runBudgetsFlow(page);
    }

    log("completed", flow);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[browser-manual-flows] failed", error);
  process.exitCode = 1;
});
