/**
 * Turn common LaTeX into readable characters before markdown runs.
 * Markdown treats \( and \[ as escapes, which left raw commands on screen.
 */

const COMMANDS: Record<string, string> = {
  times: "×",
  cdot: "·",
  div: "÷",
  pm: "±",
  mp: "∓",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  infty: "∞",
  ldots: "…",
  dots: "…",
  cdots: "⋯",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  alpha: "α",
  beta: "β",
  pi: "π",
  sigma: "σ",
};

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUB = "₀₁₂₃₄₅₆₇₈₉";

function toScript(value: string, digits: string, plus: string, minus: string): string | null {
  if (!/^[0-9+-]+$/.test(value)) return null;
  return value
    .replace(/[0-9]/g, (digit) => digits[Number(digit)] ?? digit)
    .replace(/\+/g, plus)
    .replace(/-/g, minus);
}

function renderMathInner(src: string): string {
  let text = src;
  text = text.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2");
  text = text.replace(/\\([a-zA-Z]+)/g, (full, name: string) => COMMANDS[name] ?? full);
  text = text.replace(/\\%/g, "%");
  text = text.replace(/\\\$/g, "$");
  text = text.replace(/\\,/g, "");
  text = text.replace(/\{,\}/g, ",");
  text = text.replace(/\^\{([^{}]+)\}/g, (full, inner: string) => toScript(inner, SUP, "⁺", "⁻") ?? full);
  text = text.replace(/\^([0-9])/g, (_, digit: string) => SUP[Number(digit)] ?? digit);
  text = text.replace(/_\{([^{}]+)\}/g, (full, inner: string) => toScript(inner, SUB, "₊", "₋") ?? full);
  text = text.replace(/_([0-9])/g, (_, digit: string) => SUB[Number(digit)] ?? digit);
  text = text.replace(/[{}]/g, "");
  return text.replace(/[ \t]{2,}/g, " ").trim();
}

function replaceDelimited(text: string): string {
  let next = text;
  next = next.replace(/\$\$([\s\S]+?)\$\$/g, (_, inner: string) => renderMathInner(inner));
  next = next.replace(/\\\[([\s\S]+?)\\\]/g, (_, inner: string) => renderMathInner(inner));
  next = next.replace(/\\\(([\s\S]+?)\\\)/g, (_, inner: string) => renderMathInner(inner));
  next = next.replace(/\$([^$\n]+?)\$/g, (full, inner: string) => {
    if (!/[\\^_{}]/.test(inner)) return full;
    return renderMathInner(inner);
  });
  return next;
}

function renderProseMath(text: string): string {
  let next = replaceDelimited(text);
  next = next.replace(/\\([a-zA-Z]+)/g, (full, name: string) => COMMANDS[name] ?? full);
  next = next.replace(/\{,\}/g, ",");
  return next;
}

/** Leave fenced and inline code alone. Render math in the surrounding prose. */
export function renderChatMath(text: string): string {
  if (!text || !/[$\\{]/.test(text)) return text;
  const pieces = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return pieces
    .map((piece, index) => (index % 2 === 1 ? piece : renderProseMath(piece)))
    .join("");
}
