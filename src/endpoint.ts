// Endpoint validation shared by assisted ingest and the Jev option. Pure: no Obsidian import.

/**
 * Why a URL can be refused as an ingest endpoint, or `null` if it is usable.
 *
 * Obsidian's `requestUrl` follows redirects and reports neither the final
 * URL nor a way to refuse them, so the "exactly one destination" promise
 * rests on the endpoint itself: it must be an absolute `http(s)` URL with no
 * embedded credentials, and the host must answer directly. A 3xx reply is
 * treated as unavailable (see `callModel`) rather than followed.
 */
export function endpointProblem(endpoint: string): string | null {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return "the endpoint is not an absolute URL";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "the endpoint must use http or https";
  if (u.username || u.password) return "the endpoint must not embed credentials";
  if (u.hash) return "the endpoint must not have a #fragment";
  return null;
}
