import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { prose } from "./tokens";

const root = path.resolve(import.meta.dirname, "../..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function extractBlock(css: string, marker: string): string {
  const start = css.indexOf(marker);
  assert.ok(start >= 0, `missing ${marker}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unclosed ${marker}`);
}

function decl(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+)`));
  assert.ok(match, `${name} missing`);
  return match[1]!.trim();
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const r = Number.parseInt(n.slice(0, 2), 16);
  const g = Number.parseInt(n.slice(2, 4), 16);
  const b = Number.parseInt(n.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

describe("assistant prose tokens", () => {
  const css = read("src/app/globals.css");
  const light = extractBlock(css, ":root {");
  const dark = extractBlock(css, ':root[data-theme="dark"]');

  it("matches the light and dark CSS custom properties", () => {
    assert.equal(decl(light, "--color-text-primary"), prose.light.textPrimary);
    assert.equal(decl(light, "--color-prose-code-bg"), prose.light.codeBg);
    assert.equal(
      decl(light, "--color-prose-code-block-bg"),
      prose.light.codeBlockBg,
    );
    assert.equal(decl(light, "--canvas"), prose.light.canvas);

    assert.equal(decl(dark, "--color-text-primary"), prose.dark.textPrimary);
    assert.equal(decl(dark, "--color-prose-code-bg"), prose.dark.codeBg);
    assert.equal(
      decl(dark, "--color-prose-code-block-bg"),
      prose.dark.codeBlockBg,
    );
    assert.equal(decl(dark, "--canvas"), prose.dark.canvas);
  });

  it("keeps body and code ink at AAA contrast on the real surfaces", () => {
    for (const theme of [prose.light, prose.dark]) {
      assert.ok(contrast(theme.textPrimary, theme.canvas) >= 7);
      assert.ok(contrast(theme.textPrimary, theme.codeBg) >= 7);
      assert.ok(contrast(theme.textPrimary, theme.codeBlockBg) >= 7);
    }
  });

  it("keeps dark mode a warm charcoal palette, not an inversion", () => {
    assert.ok(luminance(prose.dark.canvas) < 0.05);
    assert.ok(luminance(prose.dark.codeBg) < 0.08);
    assert.ok(luminance(prose.dark.codeBlockBg) < 0.08);
    assert.ok(luminance(prose.dark.textPrimary) > 0.8);
    assert.ok(luminance(prose.light.codeBg) > 0.7);
    assert.notEqual(prose.dark.textPrimary, "#ffffff");
    assert.notEqual(prose.dark.codeBg, prose.light.canvas);
    assert.ok(luminance(prose.dark.codeBg) < luminance(prose.dark.canvas) + 0.05);
    assert.ok(luminance(prose.dark.codeBg) > luminance(prose.dark.canvas));
  });

  it("sets the answer measure, size, and weight", () => {
    const proseRule = css.match(/\.prose-aether \{([\s\S]*?)\n\}/);
    assert.ok(proseRule);
    const body = proseRule[1]!;
    assert.match(body, /font-family:\s*var\(--font-prose\)/);
    assert.match(body, /font-size:\s*17px/);
    assert.match(body, /line-height:\s*1\.58/);
    assert.match(body, /letter-spacing:\s*normal/);
    assert.match(body, /font-kerning:\s*normal/);
    assert.match(body, /font-optical-sizing:\s*none/);
    assert.match(
      body,
      new RegExp(`font-variation-settings:\\s*"opsz"\\s*${prose.opsz}`),
    );
    assert.doesNotMatch(body, /font-variation-settings:[^;]*wght/);
    assert.match(body, /color:\s*var\(--color-text-primary\)/);
    assert.match(body, /max-width:\s*(6[0-9]|7[0-5])ch/);
    assert.match(body, new RegExp(`max-width:\\s*${prose.measure}`));
    assert.match(
      css,
      /@media \(min-width:\s*768px\) \{\s*\.prose-aether \{\s*font-size:\s*18px;/,
    );
    assert.equal(prose.mobileSize, "17px");
    assert.equal(prose.desktopSize, "18px");
    assert.equal(prose.lineHeight, "1.58");
    assert.ok(prose.strongWeight >= 600 && prose.strongWeight <= 700);
    assert.match(
      css,
      new RegExp(
        `\\.prose-aether strong \\{[\\s\\S]*font-weight:\\s*${prose.strongWeight}`,
      ),
    );
    assert.match(
      css,
      /\.prose-aether strong \{[^}]*letter-spacing:\s*normal/,
    );
    assert.match(
      css,
      /\.prose-aether h1,[\s\S]*?\.prose-aether h4 \{[^}]*letter-spacing:\s*normal/,
    );
    assert.match(css, /\.prose-aether h1 \{[^}]*font-variation-settings:\s*"opsz" 24/);
    assert.match(css, /\.prose-aether h2 \{[^}]*font-variation-settings:\s*"opsz" 22/);
    assert.equal(prose.opsz, 22);
    assert.match(
      css,
      /\.prose-aether li::marker \{[^}]*color:\s*var\(--color-text-primary\)/,
    );
    assert.match(
      css,
      /\.prose-aether :not\(pre\) > code \{[^}]*background:\s*var\(--color-prose-code-bg\)/,
    );
    assert.match(
      css,
      /\.prose-aether h2 \{[^}]*font-size:\s*1\.22em/,
    );
  });

  it("loads Source Serif 4 for prose and keeps Cormorant for display", () => {
    const layout = read("src/app/layout.tsx");
    assert.match(layout, /Source_Serif_4\(/);
    assert.match(layout, /variable:\s*"--font-prose"/);
    assert.match(layout, /weight:\s*"variable"/);
    assert.match(layout, /axes:\s*\["opsz"\]/);
    assert.match(layout, /Cormorant_Garamond\(/);
    assert.match(layout, /variable:\s*"--font-serif"/);
    assert.match(layout, /subsets:\s*\["latin"\]/);
  });

  it("does not restyle user bubbles or the composer", () => {
    const thread = read("src/components/assistant-ui/thread.tsx");
    const assistant = thread.slice(thread.indexOf("aether-assistant-copy"));
    assert.match(assistant.slice(0, 220), /font-\[family-name:var\(--font-ui\)\]/);
    assert.doesNotMatch(assistant.slice(0, 400), /font-serif/);
    assert.match(
      thread,
      /aether-user-bubble[\s\S]{0,240}font-\[family-name:var\(--font-ui\)\] text-\[15px\]/,
    );
    assert.match(
      thread,
      /placeholder:text-\[var\(--muted-soft\)\]/,
    );
    assert.match(thread, /text-\[15px\] leading-relaxed text-\[var\(--text\)\]/);
    assert.match(
      thread,
      /font-\[family-name:var\(--font-serif\)\] text-\[var\(--text\)\]/,
    );
  });

  it("keeps the empty-state greeting small and italic in Cormorant", () => {
    const thread = read("src/components/assistant-ui/thread.tsx");
    const welcome = thread.slice(thread.indexOf("const ThreadWelcome"));
    const h1 = welcome.slice(welcome.indexOf("<h1"), welcome.indexOf("</h1>"));
    assert.match(h1, /font-\[family-name:var\(--font-serif\)\]/);
    assert.match(h1, /fontSize:\s*"clamp\(1\.35rem, 2\.6vw, 1\.75rem\)"/);
    assert.match(h1, /fontStyle:\s*"italic"/);
  });

  it("points inline code and fenced blocks at the prose tokens", () => {
    const markdown = read("src/components/assistant-ui/markdown-text.tsx");
    assert.match(markdown, /bg-\[var\(--color-prose-code-bg\)\]/);
    assert.match(markdown, /bg-\[var\(--color-prose-code-block-bg\)\]/);
    assert.match(markdown, /text-\[var\(--color-text-primary\)\]/);
    assert.doesNotMatch(markdown, /marker:text-\[var\(--muted\)\]/);
    assert.doesNotMatch(markdown, /bg-\[var\(--elevated\)\] px-1\.5/);
  });
});
