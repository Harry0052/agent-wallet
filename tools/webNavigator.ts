import {
  AllowedCategory,
  PurchaseCandidate,
  SpendingPolicy,
} from "@/guardrails/spendingPolicy";

interface SearchResult {
  title: string;
  url: string;
}

const DEFAULT_QUERIES = [
  "site:gumroad.com digital product $4",
  "small saas monthly plan $5",
  "api credits starter pack $5",
  "buy digital template $5",
];

export class WebNavigator {
  async findAffordableCandidates(
    policy: SpendingPolicy,
    maxCandidates = 12,
  ): Promise<PurchaseCandidate[]> {
    const results = await this.searchAcrossQueries(DEFAULT_QUERIES, 30);
    const enriched: PurchaseCandidate[] = [];

    for (const result of results) {
      if (enriched.length >= maxCandidates) {
        break;
      }

      const candidate = await this.extractCandidate(result, policy);
      if (!candidate) {
        continue;
      }

      enriched.push(candidate);
    }

    return enriched.sort((a, b) => a.amount - b.amount);
  }

  private async searchAcrossQueries(
    queries: string[],
    maxResults: number,
  ): Promise<SearchResult[]> {
    const deduped = new Map<string, SearchResult>();

    for (const query of queries) {
      const rows = await this.searchWeb(query);
      for (const row of rows) {
        if (!deduped.has(row.url)) {
          deduped.set(row.url, row);
        }

        if (deduped.size >= maxResults) {
          return [...deduped.values()];
        }
      }
    }

    return [...deduped.values()];
  }

  private async searchWeb(query: string): Promise<SearchResult[]> {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const results: SearchResult[] = [];
    const regex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;
    let match = regex.exec(html);

    while (match) {
      const rawHref = match[1];
      const title = this.decodeHtml(match[2]).replace(/<[^>]*>/g, "").trim();
      const resolved = this.resolveSearchHref(rawHref);

      if (resolved) {
        results.push({
          title,
          url: resolved,
        });
      }

      match = regex.exec(html);
    }

    return results;
  }

  private resolveSearchHref(rawHref: string): string | null {
    if (!rawHref) {
      return null;
    }

    try {
      const parsed = new URL(rawHref, "https://duckduckgo.com");
      const redirected = parsed.searchParams.get("uddg");
      if (redirected) {
        return decodeURIComponent(redirected);
      }

      if (parsed.protocol.startsWith("http")) {
        return parsed.toString();
      }
    } catch {
      return null;
    }

    return null;
  }

  private async extractCandidate(
    result: SearchResult,
    policy: SpendingPolicy,
  ): Promise<PurchaseCandidate | null> {
    let html: string;
    try {
      const response = await fetch(result.url, { method: "GET" });
      if (!response.ok) {
        return null;
      }

      html = await response.text();
    } catch {
      return null;
    }

    const price = this.extractLowestUsdPrice(html);
    if (price === null) {
      return null;
    }

    const category = this.detectCategory(
      `${result.title}\n${result.url}\n${html.slice(0, 5000)}`,
    );
    if (!policy.getAllowedCategories().includes(category)) {
      return null;
    }

    if (price > policy.getMaxTransaction()) {
      return null;
    }

    const checkoutUrl = this.extractCheckoutUrl(html, result.url) ?? result.url;
    const hostname = this.safeHostname(result.url);
    const merchant = hostname.replace(/^www\./, "");

    return {
      serviceName: result.title || hostname,
      merchant,
      category,
      amount: Number(price.toFixed(2)),
      currency: "USD",
      checkoutUrl,
      sourceUrl: result.url,
    };
  }

  private extractLowestUsdPrice(html: string): number | null {
    const candidates: number[] = [];
    const pricePatterns = [
      /\$\s?(\d{1,2}(?:\.\d{1,2})?)/g,
      /USD\s?(\d{1,2}(?:\.\d{1,2})?)/gi,
    ];

    for (const pattern of pricePatterns) {
      let match = pattern.exec(html);
      while (match) {
        const parsed = Number.parseFloat(match[1]);
        if (Number.isFinite(parsed) && parsed > 0) {
          candidates.push(parsed);
        }
        match = pattern.exec(html);
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    return Math.min(...candidates);
  }

  private detectCategory(content: string): AllowedCategory {
    const source = content.toLowerCase();
    if (
      /api key|api credit|token pack|request credits|usage credits/.test(source)
    ) {
      return "API credits";
    }

    if (
      /subscription|monthly|per month|free trial|saas|workspace/.test(source)
    ) {
      return "SaaS";
    }

    return "digital_products";
  }

  private extractCheckoutUrl(html: string, baseUrl: string): string | null {
    const anchorRegex = /<a[^>]+href="([^"]+)"[^>]*>/gi;
    let match = anchorRegex.exec(html);

    while (match) {
      const href = match[1];
      if (!/(checkout|buy|purchase|subscribe|gumroad|stripe)/i.test(href)) {
        match = anchorRegex.exec(html);
        continue;
      }

      try {
        return new URL(href, baseUrl).toString();
      } catch {
        match = anchorRegex.exec(html);
      }
    }

    return null;
  }

  private safeHostname(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return "unknown-merchant";
    }
  }

  private decodeHtml(value: string): string {
    return value
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
}
