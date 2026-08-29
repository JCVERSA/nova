import dns from "dns/promises";

/**
 * SSRF guard for user-supplied URLs.
 * Blocks non-http(s) schemes, private/loopback/link-local/reserved IPs,
 * and hostnames that resolve only to such addresses.
 */

const IPV4_PRIVATE_PATTERNS: RegExp[] = [
  /^0\./, // "this" network
  /^10\./, // RFC1918
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
  /^127\./, // loopback
  /^169\.254\./, // link-local
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^192\.0\.0\./, // IETF protocol assignments
  /^192\.168\./, // RFC1918
  /^198\.18\./, // benchmarking
  /^224\./, // multicast
  /^240\./, // reserved
];

function isPrivateIpv4(ip: string): boolean {
  return IPV4_PRIVATE_PATTERNS.some((pattern) => pattern.test(ip));
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true; // link-local
  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 address
    return isPrivateIpv4(normalized.split("::ffff:")[1]);
  }
  return false;
}

export function isPrivateIpAddress(ip: string): boolean {
  const cleaned = ip.replace(/^\[|\]$/g, "");
  if (cleaned.includes(":")) return isPrivateIpv6(cleaned);
  return isPrivateIpv4(cleaned);
}

/**
 * Returns true when the URL is safe for the server to fetch:
 * http/https scheme and a host that resolves to no private addresses.
 */
export async function isSafeDownloadUrl(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return false;
  }

  // Literal IP hosts can be checked without DNS.
  const isLiteralIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":");
  if (isLiteralIp) {
    return !isPrivateIpAddress(hostname);
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (addresses.length === 0) return false;
    return addresses.every((addr) => !isPrivateIpAddress(addr.address));
  } catch {
    return false;
  }
}

/**
 * fetch() that refuses to follow redirects to unsafe destinations.
 * Each hop is validated before the request is issued.
 */
export async function safeFetch(input: string, init?: RequestInit, maxRedirects = 5): Promise<Response> {
  let url = input;
  for (let i = 0; i <= maxRedirects; i++) {
    if (!(await isSafeDownloadUrl(url))) {
      throw new Error("Blocked unsafe URL (private or non-http(s) destination).");
    }
    const res = await fetch(url, { ...init, redirect: "manual" });
    if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
      const location = res.headers.get("location");
      if (!location) return res;
      url = new URL(location, url).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects while fetching URL.");
}
