import { chromium, type Browser, type Page } from "playwright";
import { extractCandidateCards } from "@/scrapers/candidateExtractor";
import {
  scoreCandidates,
  type CandidateProfile,
  type ScoredCandidate,
} from "@/scoring/candidateScorer";
import { GoogleSheetsExporter } from "@/exports/googleSheetsExporter";
import { buildTalentSourcingResponse } from "@/chat/agentResponse";
import { Ledger } from "@/ledger/ledger";
import { getIndeedCredentials } from "@/lib/server/indeedCredentials";

export interface IndeedCredentials {
  email: string;
  password: string;
}

export interface IndeedAgentConfig {
  baseUrl?: string;
  query?: string;
  maxResults?: number;
  headless?: boolean;
  timeoutMs?: number;
  credentials?: IndeedCredentials;
}

export interface ShortlistedCandidate {
  name: string;
  title: string;
  location: string;
  skills: string[];
  profile_link: string;
  score: number;
}

export interface IndeedSourcingAutomationResult {
  candidates: ShortlistedCandidate[];
  google_sheet_link: string;
  chat_response: string;
}

const DEFAULT_QUERY = "software developer remote";

export class IndeedAgent {
  private readonly baseUrl: string;
  private readonly query: string;
  private readonly maxResults: number;
  private readonly headless: boolean;
  private readonly timeoutMs: number;
  private readonly credentials: IndeedCredentials;

  constructor(config?: IndeedAgentConfig) {
    this.baseUrl = config?.baseUrl ?? "https://www.indeed.com";
    this.query = config?.query ?? DEFAULT_QUERY;
    this.maxResults = config?.maxResults ?? 3;
    this.headless = config?.headless ?? true;
    this.timeoutMs = config?.timeoutMs ?? 60_000;
    this.credentials = this.resolveCredentials(config?.credentials);
  }

  async run(): Promise<ShortlistedCandidate[]> {
    let browser: Browser | null = null;

    try {
      browser = await chromium.launch({ headless: this.headless });
      const context = await browser.newContext();
      context.setDefaultTimeout(this.timeoutMs);
      const page = await context.newPage();

      await this.navigateToIndeed(page);
      await this.login(page);
      await this.searchCandidates(page, this.query);
      const candidates = await this.scrapeCandidates(page);
      const shortlisted = this.shortlistCandidates(candidates, this.query);

      return shortlisted;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  private async navigateToIndeed(page: Page): Promise<void> {
    await page.goto(this.baseUrl, { waitUntil: "domcontentloaded" });
  }

  private async login(page: Page): Promise<void> {
    await this.clickFirst(page, [
      'a[data-gnav-element-name="SignIn"]',
      'a[href*="/account/login"]',
      "text=Sign in",
      "text=Sign In",
    ]);

    await this.fillFirst(page, ['input[type="email"]', 'input[name="__email"]'], this.credentials.email);
    await this.clickFirst(page, [
      'button[type="submit"]',
      "text=Continue",
      "text=Sign in",
      "text=Sign In",
    ]);

    await this.fillFirst(page, ['input[type="password"]', 'input[name="password"]'], this.credentials.password);
    await this.clickFirst(page, [
      'button[type="submit"]',
      "text=Sign in",
      "text=Sign In",
      "text=Log in",
    ]);

    await page.waitForLoadState("networkidle");
  }

  private async searchCandidates(page: Page, query: string): Promise<void> {
    await page.goto(`${this.baseUrl}/?from=gnav-homepage`, {
      waitUntil: "domcontentloaded",
    });

    await this.fillFirst(
      page,
      [
        'input[name="q"]',
        'input[id="text-input-what"]',
        '[data-testid="search-input"]',
      ],
      query,
    );

    await this.clickFirst(page, [
      'button[type="submit"]',
      'button[aria-label*="Search"]',
      "text=Find jobs",
      "text=Search",
    ]);

    await page.waitForLoadState("networkidle");
  }

  private async scrapeCandidates(page: Page): Promise<CandidateProfile[]> {
    const candidates = await extractCandidateCards(page);
    if (candidates.length === 0) {
      throw new Error("No candidate cards extracted from Indeed results page.");
    }
    return candidates;
  }

  private shortlistCandidates(
    candidates: CandidateProfile[],
    query: string,
  ): ShortlistedCandidate[] {
    const ranked = scoreCandidates(candidates, query).slice(0, this.maxResults);

    return ranked.map((candidate: ScoredCandidate) => ({
      name: candidate.name,
      title: candidate.title,
      location: candidate.location,
      skills: candidate.skills,
      profile_link: candidate.profile_link,
      score: candidate.score,
    }));
  }

  private resolveCredentials(
    credentialsOverride?: IndeedCredentials,
  ): IndeedCredentials {
    if (credentialsOverride) {
      return credentialsOverride;
    }

    const { email, password } = getIndeedCredentials();

    return {
      email,
      password,
    };
  }

  private async clickFirst(page: Page, selectors: string[]): Promise<void> {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) {
        continue;
      }

      try {
        await locator.click({ timeout: 5000 });
        return;
      } catch {
        continue;
      }
    }

    throw new Error(`Unable to click any selector: ${selectors.join(", ")}`);
  }

  private async fillFirst(
    page: Page,
    selectors: string[],
    value: string,
  ): Promise<void> {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) {
        continue;
      }

      try {
        await locator.fill(value, { timeout: 5000 });
        return;
      } catch {
        continue;
      }
    }

    throw new Error(`Unable to fill any selector: ${selectors.join(", ")}`);
  }
}

export async function runIndeedShortlist(
  config?: IndeedAgentConfig,
): Promise<ShortlistedCandidate[]> {
  const agent = new IndeedAgent(config);
  return agent.run();
}

export async function runIndeedSourcingAutomation(
  config?: IndeedAgentConfig,
): Promise<IndeedSourcingAutomationResult> {
  const shortlisted = await runIndeedShortlist({
    ...config,
    maxResults: 3,
  });

  const exporter = new GoogleSheetsExporter();
  const exportResult = await exporter.exportTopCandidates(shortlisted);

  const ledger = new Ledger();
  await ledger.logEvent({
    event_type: "talent_sourcing",
    result_count: Math.min(shortlisted.length, 3),
    timestamp: new Date().toISOString(),
  });

  const chatResponse = buildTalentSourcingResponse(exportResult.spreadsheetUrl);

  return {
    candidates: shortlisted.slice(0, 3),
    google_sheet_link: exportResult.spreadsheetUrl,
    chat_response: chatResponse,
  };
}
