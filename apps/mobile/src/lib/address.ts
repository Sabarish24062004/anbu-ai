/** Port the Anbu API listens on by default. */
export const API_PORT = 4000;

/**
 * Turns what a person types into a server URL: "10.0.0.5" → "http://10.0.0.5:4000",
 * "https://api.example.com/" → "https://api.example.com". Returns null if it is not a URL.
 */
export function normalizeServerAddress(input: string): string | null {
  const raw = input.trim();
  // Optional scheme, a host name or IP, optional port, optional path; nothing else.
  if (!/^(https?:\/\/)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*(:\d{1,5})?(\/\S*)?$/i.test(raw)) {
    return null;
  }
  const hasScheme = /^https?:\/\//i.test(raw);
  const candidate = (hasScheme ? raw : `http://${raw}`).replace(/\/+$/, '');
  try {
    const url = new URL(candidate);
    if (!url.hostname) return null;
    // A bare host means "the Anbu API on its usual port"; an explicit URL is taken as typed.
    if (!hasScheme && !url.port) url.port = String(API_PORT);
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}
