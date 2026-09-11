import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_ARTIFACT_VERSIONS,
  bumpArtifactVersions,
  versionAt,
} from "./versions";

describe("artifact versions", () => {
  it("seeds v1 on first persist", () => {
    const versions = bumpArtifactVersions([], "", "hello", "2026-09-11T00:00:00.000Z");
    assert.equal(versions.length, 1);
    assert.equal(versions[0]?.n, 1);
    assert.equal(versions[0]?.content, "hello");
  });

  it("appends a version when content changes", () => {
    const first = bumpArtifactVersions([], "", "alpha", "t1");
    const next = bumpArtifactVersions(first, "alpha", "beta", "t2");
    assert.equal(next.length, 2);
    assert.equal(next[1]?.n, 2);
    assert.equal(next[1]?.content, "beta");
    assert.equal(next[0]?.content, "alpha");
  });

  it("does not bump when content is unchanged", () => {
    const first = bumpArtifactVersions([], "", "same", "t1");
    const next = bumpArtifactVersions(first, "same", "same", "t2");
    assert.deepEqual(next, first);
  });

  it("keeps the previous body when versions were missing", () => {
    const next = bumpArtifactVersions([], "old", "new", "t2");
    assert.equal(next.length, 2);
    assert.equal(next[0]?.content, "old");
    assert.equal(next[1]?.content, "new");
    assert.equal(next[1]?.n, 2);
  });

  it("caps history at MAX_ARTIFACT_VERSIONS", () => {
    let versions = bumpArtifactVersions([], "", "v1", "t");
    let prev = "v1";
    for (let i = 2; i <= MAX_ARTIFACT_VERSIONS + 3; i++) {
      const content = `v${i}`;
      versions = bumpArtifactVersions(versions, prev, content, `t${i}`);
      prev = content;
    }
    assert.equal(versions.length, MAX_ARTIFACT_VERSIONS);
    assert.equal(versions[0]?.n, 4);
    assert.equal(versions.at(-1)?.content, `v${MAX_ARTIFACT_VERSIONS + 3}`);
  });

  it("picks a version by number", () => {
    const versions = bumpArtifactVersions(
      bumpArtifactVersions([], "", "a", "t1"),
      "a",
      "b",
      "t2",
    );
    assert.equal(versionAt(versions, 1)?.content, "a");
    assert.equal(versionAt(versions, 2)?.content, "b");
    assert.equal(versionAt(versions, 9), null);
  });
});
