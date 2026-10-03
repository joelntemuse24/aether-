import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(css|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("motion tokens", () => {
  it("defines one ease and fast, base, and slow durations", () => {
    const css = read("src/app/globals.css");
    assert.match(css, /--motion-fast:\s*140ms/);
    assert.match(css, /--motion-base:\s*220ms/);
    assert.match(css, /--motion-slow:\s*380ms/);
    assert.match(
      css,
      /--motion-ease:\s*cubic-bezier\(0\.23,\s*1,\s*0\.32,\s*1\)/,
    );
    assert.match(css, /@keyframes aether-fade-up/);
    assert.match(css, /translateY\(8px\)/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
  });

  it("does not keep transition: all or durations past the slow token", () => {
    const files = walk(path.join(root, "src/components"));
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/transition:\s*all|transition-all|duration-500|duration-700|duration-1000/.test(text)) {
        hits.push(path.relative(root, file));
      }
    }
    assert.deepEqual(hits, []);
  });
});
