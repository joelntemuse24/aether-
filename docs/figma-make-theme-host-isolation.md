# Figma Make — host theme isolation (`.dark` inheritance)

Use inside the existing Make file  
`https://www.figma.com/make/ipxnTHtemrhVnpNwyaiFff/Redesign-Aether-Chat-App`

Reference implementation in this repo:  
`Match website layout/src/styles/theme.css` + `Match website layout/src/app/App.tsx`

---

## Why light keeps losing

It’s not specificity. Custom properties resolve from the **nearest ancestor that declares them**. If Make (or any host) puts `class="dark"` on a wrapper between `<html>` and your shell, your old `.dark { --canvas: … }` fires on that wrapper and every child inherits dark tokens. `!important` on `html`/`body` cannot beat a declaration on a descendant. Media guards that key off `html:not(.dark)` also fail when the host owns `.dark`.

## Prompt (paste into Figma Make)

```
THEME HOST-ISOLATION PASS — do this exactly. Do not invent a new palette.

ROOT CAUSE
Custom properties inherit from the nearest declaring ancestor. A host-injected
`.dark` class (on html, #root, or a wrapper) was activating our unscoped
`.dark { --canvas: … }` block and every `dark:` Tailwind utility via
`@custom-variant dark (&:is(.dark *))`. !important on html/body cannot win
against a descendant token declaration. Delete the media/!important guards —
they’re dead weight.

1) theme.css
- Change to: @custom-variant dark (&:where(.aether-dark, .aether-dark *));
- Rename palette scopes to owned class names, declared on :root AND the shell:

  :root, .aether-light, .aether-app-shell.aether-light { …light tokens… }
  .aether-dark, .aether-app-shell.aether-dark { …existing dark colours, untouched… }
  .aether-white, .aether-app-shell.aether-white { …white tokens… }

  Light canvas = #f1ede6, text #1a1714
  Dark  canvas = #1a1a1c, text #ededef
  White canvas = #fffdfa, text #1a1714

- DELETE entirely:
  - @media (prefers-color-scheme: dark) { … }
  - html, body { background-color: … !important } and html.dark / html.white twins
  - .aether-app-shell { background-color: … !important } and html.dark variants
- KEEP only native widget hinting:
  html { color-scheme: only light; }
  html.aether-dark { color-scheme: only dark; }
- KEEP @layer base { html, body { background: var(--canvas); color: var(--text); } }
  Drop any html.dark duplicate — the token swap handles it.
- Do NOT leave a bare `.dark { … }` palette block. Host `.dark` must be inert.

2) App.tsx — class the shell, not just the root
- Add appShellRef on the outermost shell div.
- useLayoutEffect([theme]) that:
  - picks cls = aether-dark | aether-light | aether-white
  - adds that class to documentElement, body, AND appShellRef.current
  - removes the other aether-* classes from those three
  - document.documentElement.classList.remove("dark")
  - sets documentElement/body style.backgroundColor + body color to the
    canvas/text hex for the active theme (first-paint belt)
- Shell className (NO dark: Tailwind utility on the shell):
  "aether-app-shell flex h-dvh min-h-screen w-full min-w-full overflow-hidden"
- Keep inline style={{ backgroundColor, color }} on the shell itself.
- Default theme = "light". Cycle Dark → Light → White → Dark.

VERIFY IN DEVTOOLS
Inspect the shell div → Computed → --canvas. The winning selector must be
:root, .aether-light, or .aether-app-shell.aether-light (or dark/white twin).
If anything else supplies --canvas, that element’s tag/class is the host injector.
```

---

## Prod note

Production Aether (`src/app/globals.css`) already scopes via `data-theme` and does not use a bare `.dark` class or Tailwind `dark:` utilities on the shell. This pass is for the Make prototype host environment only.
