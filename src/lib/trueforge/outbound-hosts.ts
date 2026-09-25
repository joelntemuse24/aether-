/** Hosts the sidecar may call. Loopback is required so a local sidecar can reach Next. */
export function withLocalMcpHosts(existing: string | undefined): string {
  const hosts: string[] = [];
  if (existing?.trim()) {
    try {
      const parsed = JSON.parse(existing) as unknown;
      if (Array.isArray(parsed)) {
        for (const host of parsed) {
          if (typeof host === "string" && host && !hosts.includes(host)) hosts.push(host);
        }
      }
    } catch {
      // Ignore a malformed list and keep the local hosts.
    }
  }
  for (const host of ["127.0.0.1", "localhost"]) {
    if (!hosts.includes(host)) hosts.push(host);
  }
  return JSON.stringify(hosts);
}
