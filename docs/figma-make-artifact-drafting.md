# Figma Make — artifact drafting + design language (Aether)

Use this **inside the existing Make file**  
`https://www.figma.com/make/ipxnTHtemrhVnpNwyaiFff/Redesign-Aether-Chat-App`

Do **not** start a new Make from scratch. Refine the prototype already in that thread.

---

## Prompt (paste into Figma Make)

```
CONTEXT — READ FIRST
You already redesigned Aether in this Make file. App.tsx is a working high-fidelity prototype of the consumer chat shell (sidebar, thread, composer, collapsed tool chips, artifact inspector, Preferences with Dark / Parchment / White, Continue bar). Keep that foundation.

This is a NEXT PASS focused on ARTIFACTS while drafting, and making artifact OUTPUT feel like Aether — not a bolted-on white Word/PDF viewer.

HARD RULES
- Consumer Claude/ChatGPT intuition. No BYOK / OpenRouter / harness jargon.
- One composition per region. Cards only when they ARE the interaction.
- Do NOT invent purple/glow AI chrome or a marketing landing page.
- Prefer editing App.tsx / existing components over a parallel app.
- Attach the current production sources listed below as ground truth.

────────────────────────────────────────
1) DRAFTING POPUP — “where the artifact is going”
────────────────────────────────────────
When the model is working for a while and drafting an artifact (create_artifact / Writing… / Building…), show a small, quiet pop-up that points to WHERE the artifact will appear — the right-side inspector rail (desktop) or the artifact drawer/sheet (mobile).

Design intent:
- Not a toast pile. Not a modal. A soft peek / locational hint.
- Appears after a short delay once drafting has started (so quick one-liners don’t flash UI).
- Anchored visually toward the artifact destination (right edge on desktop; bottom/sheet affordance on mobile).
- Content roughly: title if known (“Quarterly brief”), kind chip (document / code / data), and a short line like “Drafting in the inspector →” or “Opening here”.
- Optional tiny progress energy (subtle pulse / char count) — quiet, not a progress bar circus.
- Clicking the peek focuses/opens the artifact panel.
- Dismisses when the artifact panel is open and has content, or when drafting ends.
- If the panel is already open and live-updating, skip the peek (or shrink it to a non-blocking status in the panel header: “Writing…”).

States to mock:
- Desktop: drafting with panel CLOSED → peek at right rail
- Desktop: drafting with panel OPEN → live preview updating; no competing popup
- Mobile: drafting → peek that foreshadows the sheet/drawer
- Finished → peek gone; panel shows the artifact

────────────────────────────────────────
2) ARTIFACT OUTPUT MATCHES AETHER DESIGN LANGUAGE
────────────────────────────────────────
The artifact inspector chrome already uses Aether tokens. The OUTPUT inside the preview must also feel like Aether — especially for normal documents (markdown / PDF-like / Word-like reading views).

Match the app:
- Canvas / paper color from the active theme (Dark charcoal, Parchment warm, White near-white) — NOT a harsh pure-white page floating in a warm shell unless theme is White.
- Text: warm editorial serif for body (Cormorant Garamond energy), calm UI sans for headings/UI chrome (Inter energy).
- Accent: use the app’s Default clay/terracotta (or current accent) for links, blockquote rules, focus — not generic blue hyperlinks.
- Borders, code blocks, tables: soft borders from theme tokens; code blocks use theme code-bg, not stark gray SaaS cards.
- Spacing and type scale: generous reading measure (~46rem), serif body ~1.7 line-height — same reading rhythm as chat markdown.

Exceptions (may look different on purpose):
- Spreadsheet / data tables: tabular UI is fine; still tint headers/borders with theme tokens.
- Charts: use accent for bars/lines; axis labels use muted text.
- Slides / PowerPoint-like decks: slide canvas can be its own format, but chrome (title bar, tabs) stays Aether.
- Pure code artifacts: editor/code view can stay mono + theme code-bg; don’t force serif onto source code.
- Images / SVG: content is the media; frame/chrome stays Aether.

Deliver mock previews for at least:
A) Document (report / brief) in Parchment — body serif, warm paper, terracotta links
B) Same document in Dark — charcoal paper, light text, same typography system
C) Code artifact — mono, collapsed tool chip → Open inspector
D) Data table — themed headers, not Excel-default blue
E) (Optional) Slide/deck — exception treatment with Aether chrome

────────────────────────────────────────
3) LIGHT / PARCHMENT BRIGHTNESS (align with prod)
────────────────────────────────────────
Prod is nudging Parchment a tad brighter (canvas + default accent slightly lifted). Reflect that in Make tokens so the prototype doesn’t look muddier than shipping.

────────────────────────────────────────
ALREADY SHIPPED IN PROD (don’t redesign away)
────────────────────────────────────────
- Tool traces collapsed by default (click to expand)
- Response paused + Continue; Continuing… N/3
- Sidebar “No matches”
- Dark / Parchment / White appearance labels
- Artifact panel soft inspector with live sync while drafting

DELIVERABLES
Desktop:
- Drafting peek → opens inspector
- Document preview matching Parchment + Dark
- Data + code exceptions
Mobile:
- Drafting peek → artifact sheet
Also: short component notes for DraftingPeek, DocumentPreview tokens, kind exceptions.

SUCCESS
- Long artifact drafts feel located (“it’s building over there”), not mysterious.
- A normal PDF/Word-like doc preview could pass as part of Aether after removing the nav — same brand test as the shell.
- Spreadsheets/slides can differ; documents and reading views cannot look like a foreign white Word embed.
```

---

## Attach these files to the Make prompt

| File | Why |
|------|-----|
| `src/components/layout/artifact-panel.tsx` | Inspector chrome + document/code/data previews |
| `src/components/assistant-ui/tool-ui.tsx` | create_artifact chip + drafting sync |
| `src/providers/artifact-provider.tsx` | Open/close + persist |
| `src/app/globals.css` | Theme tokens (Dark / Parchment / White + accents) |
| `src/lib/tokens.ts` | Font stacks / color north star |
| `src/components/layout/app-shell.tsx` | Where panel mounts relative to thread |
| `src/components/assistant-ui/thread.tsx` | Chat reading rhythm to match documents |
| `docs/figma-make-ux-brief.md` | Prior Make pass (context only) |

Prod Make file: `https://www.figma.com/make/ipxnTHtemrhVnpNwyaiFff/Redesign-Aether-Chat-App`
