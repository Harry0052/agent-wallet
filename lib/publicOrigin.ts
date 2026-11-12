export function getPublicAppOrigin(): string {
  const explicit = [process.env.APP_BASE_URL, process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_APP_ORIGIN]
    .map((value) => value?.trim())
    .find((value) => Boolean(value && /^https?:\/\//i.test(value)));
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}`;
  }

  return "http://localhost:3000";
}
