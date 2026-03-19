/**
 * Safe JSON parser for fetch responses.
 *
 * Prevents "Unexpected end of JSON input" crashes when:
 * - API returns empty body (204, 502, etc.)
 * - API returns HTML error page instead of JSON
 * - Network failure produces a non-JSON response
 * - Server crashes mid-response
 */
export async function safeJson<T = unknown>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text || text.trim().length === 0) {
    throw new Error(
      `Empty response body from ${response.url || "unknown"} (status ${response.status})`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    // Truncate the body for logging (avoid dumping entire HTML pages)
    const preview = text.length > 200 ? `${text.slice(0, 200)}...` : text;
    throw new Error(
      `Invalid JSON from ${response.url || "unknown"} (status ${response.status}): ${preview}`,
    );
  }
}
