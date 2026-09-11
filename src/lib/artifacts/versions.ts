export type ArtifactVersion = {
  n: number;
  content: string;
  createdAt: string;
};

export const MAX_ARTIFACT_VERSIONS = 20;

export function bumpArtifactVersions(
  existing: ArtifactVersion[] | undefined,
  previousContent: string,
  nextContent: string,
  now = new Date().toISOString(),
): ArtifactVersion[] {
  const prev = Array.isArray(existing) ? existing.filter(isVersion) : [];
  if (prev.length === 0) {
    if (!previousContent) {
      return [{ n: 1, content: nextContent, createdAt: now }];
    }
    if (previousContent === nextContent) {
      return [{ n: 1, content: nextContent, createdAt: now }];
    }
    return capVersions([
      { n: 1, content: previousContent, createdAt: now },
      { n: 2, content: nextContent, createdAt: now },
    ]);
  }
  const latest = prev[prev.length - 1]!;
  if (latest.content === nextContent) return prev;
  const next: ArtifactVersion = {
    n: latest.n + 1,
    content: nextContent,
    createdAt: now,
  };
  return capVersions([...prev, next]);
}

function isVersion(value: unknown): value is ArtifactVersion {
  if (!value || typeof value !== "object") return false;
  const rec = value as ArtifactVersion;
  return (
    typeof rec.n === "number" &&
    typeof rec.content === "string" &&
    typeof rec.createdAt === "string"
  );
}

function capVersions(versions: ArtifactVersion[]): ArtifactVersion[] {
  if (versions.length <= MAX_ARTIFACT_VERSIONS) return versions;
  return versions.slice(versions.length - MAX_ARTIFACT_VERSIONS);
}

export function versionAt(
  versions: ArtifactVersion[] | undefined,
  n: number,
): ArtifactVersion | null {
  return versions?.find((v) => v.n === n) ?? null;
}
