import type { Page } from "playwright";
import type { CandidateProfile } from "@/scoring/candidateScorer";

interface RawCandidate {
  name: string;
  title: string;
  location: string;
  skills: string[];
  yearsExperienceText: string;
  profileLink: string;
}

const CARD_SELECTORS = [
  '[data-testid="candidate-card"]',
  '[data-testid="searchResult"]',
  ".resultContent",
  ".slider_container .cardOutline",
  ".job_seen_beacon",
  ".result",
];

export async function extractCandidateCards(page: Page): Promise<CandidateProfile[]> {
  await page.waitForTimeout(1500);

  const rawCandidates = await page.evaluate(
    (selectors: string[]): RawCandidate[] => {
      const cards = collectCandidateNodes(selectors);

      return cards.map((card) => {
        const text = card.textContent ?? "";
        const name =
          pickText(card, [
            '[data-testid="candidate-name"]',
            ".candidateName",
            "h2",
            "h3",
          ]) ?? "";
        const title =
          pickText(card, [
            '[data-testid="candidate-title"]',
            ".candidateTitle",
            '[data-testid="jobTitle"]',
          ]) ?? "";
        const location =
          pickText(card, [
            '[data-testid="candidate-location"]',
            ".candidateLocation",
            '[data-testid="job-location"]',
            ".locationsContainer",
          ]) ?? "";
        const skills = pickSkills(card, text);
        const yearsExperienceText = extractYearsExperienceText(text);
        const profileLink = resolveProfileLink(card);

        return {
          name: sanitize(name),
          title: sanitize(title),
          location: sanitize(location),
          skills,
          yearsExperienceText,
          profileLink,
        };
      });

      function collectCandidateNodes(selectorsList: string[]): HTMLElement[] {
        const unique = new Map<HTMLElement, true>();

        selectorsList.forEach((selector) => {
          document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
            unique.set(element, true);
          });
        });

        return [...unique.keys()];
      }

      function pickText(root: HTMLElement, selectorsList: string[]): string | null {
        for (const selector of selectorsList) {
          const node = root.querySelector<HTMLElement>(selector);
          if (node?.textContent?.trim()) {
            return node.textContent.trim();
          }
        }
        return null;
      }

      function pickSkills(root: HTMLElement, text: string): string[] {
        const directSkills = [
          ...root.querySelectorAll<HTMLElement>(
            '[data-testid*="skill"], .skill, .skills li, .attribute_snippet',
          ),
        ]
          .map((node) => sanitize(node.textContent ?? ""))
          .filter((value) => value.length > 1);

        if (directSkills.length > 0) {
          return dedupe(directSkills);
        }

        const skillsLine = text
          .split("\n")
          .map((line) => line.trim())
          .find((line) => /^skills?\s*:/i.test(line));
        if (!skillsLine) {
          return [];
        }

        return dedupe(
          skillsLine
            .replace(/^skills?\s*:/i, "")
            .split(/[,\|]/)
            .map((part) => sanitize(part))
            .filter((part) => part.length > 1),
        );
      }

      function extractYearsExperienceText(text: string): string {
        const match = text.match(/(\d{1,2}\+?)\s*(years?|yrs?)\s*(of)?\s*experience/i);
        if (match) {
          return `${match[1]} years`;
        }

        const altMatch = text.match(/experience\s*:\s*(\d{1,2}\+?)\s*(years?|yrs?)/i);
        if (altMatch) {
          return `${altMatch[1]} years`;
        }

        return "";
      }

      function resolveProfileLink(root: HTMLElement): string {
        const link =
          root.querySelector<HTMLAnchorElement>('a[href*="/rc/"], a[href*="/profile"], a[href]');
        if (!link) {
          return "";
        }

        try {
          return new URL(link.getAttribute("href") ?? "", window.location.origin).toString();
        } catch {
          return "";
        }
      }

      function sanitize(value: string): string {
        return value.replace(/\s+/g, " ").trim();
      }

      function dedupe(items: string[]): string[] {
        return [...new Set(items.map((item) => item.toLowerCase()))];
      }
    },
    CARD_SELECTORS,
  );

  const normalized = rawCandidates
    .map(toCandidateProfile)
    .filter((candidate) => {
      return candidate.name.length > 0 || candidate.profile_link.length > 0;
    });

  return dedupeCandidates(normalized);
}

function toCandidateProfile(raw: RawCandidate): CandidateProfile {
  return {
    name: raw.name || "Unknown",
    title: raw.title || "Unknown",
    location: raw.location || "Unknown",
    skills: raw.skills,
    years_experience: toYearsExperience(raw.yearsExperienceText),
    profile_link: raw.profileLink,
  };
}

function toYearsExperience(value: string): number {
  const match = value.match(/(\d{1,2})/);
  if (!match) {
    return 0;
  }

  return Number.parseInt(match[1], 10);
}

function dedupeCandidates(candidates: CandidateProfile[]): CandidateProfile[] {
  const seen = new Set<string>();
  const deduped: CandidateProfile[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.profile_link}|${candidate.name}|${candidate.title}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}
