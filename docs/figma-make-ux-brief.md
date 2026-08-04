# Figma Make — next-pass prompt (Aether)

Use this **inside the existing Make file**  
`https://www.figma.com/make/ipxnTHtemrhVnpNwyaiFff/Redesign-Aether-Chat-App`

Do **not** start a new Make from scratch. This is a refinement of the prototype already in that thread.

---

## Prompt (paste into Figma Make)

```
CONTEXT — READ FIRST
You already redesigned Aether in this Make file. App.tsx is a working high-fidelity prototype of the consumer chat shell (sidebar, thread, composer w/ mic+stop, tool chips, artifact inspector, preferences, vault, dark/light). Keep that foundation.

This is a NEXT PASS, not a greenfield redesign.
- Preserve the information architecture and consumer tone you already established.
- Do NOT reintroduce developer jargon (BYOK, OpenRouter, harness, API key theater).
- Do NOT invent a marketing landing page or purple/glow AI template.
- Prefer editing App.tsx / existing components over creating a parallel app.

I am re-attaching the CURRENT production Aether UI source (and key libs) so you can reconcile the prototype with what’s shipping. Where Make and prod differ, choose the better consumer UX — but keep prod capabilities that Make simplified away if they’re still needed.

WHAT’S ALREADY GOOD IN THIS MAKE (keep / polish, don’t rebuild)
- Consumer empty chat + composer as one composition
- Mic states, Stop while generating, message edit/retry/restore energy
- Light tool chips instead of heavy engineering panels
- Artifact as soft inspector (not a hard split that eats the thread on mobile)
- Preferences (not a key vault); Advanced buried
- Sidebar: Recent, Projects, Artifacts, Vault, theme
- Dark + warm light parchment tokens

WHAT PRODUCTION HAS ADDED / WHAT THIS PASS MUST DESIGN (gaps)
Use the attached prod files as ground truth for behavior; design the UI clearly even if Make is mock-data only.

1) Continue vs Retry (critical)
Prod now auto-continues when a long reply hits the ~275s server limit, and Retry on a cut-off turn should CONTINUE (keep partial work), not regenerate from scratch.
Design:
- Distinct Continue action on incomplete / timed-out assistant turns
- Quiet inline status: “Continuing… 2/3” near composer or last message (not a toast pile)
- Incomplete/error treatment that invites Continue without looking like a hard crash
- Retry remains for completed turns (regenerate)

2) White theme (third appearance)
Prod has Dark / Light (parchment) / White (near-white). Make currently toggles only dark↔light.
Add White as a first-class appearance in Preferences + sidebar cycle. Tokens must stay calm — not flat gray SaaS, not cream+terracotta cliché.

3) Attachment honesty
Prod embeds PDFs/images within budgets; Office (docx/pptx/xlsx) extracts to text; over-budget files are name-only.
Design composer chips for:
- Readable (model can see content)
- Name-only / limited (soft warning, not scary red unless blocked)
Attach menu: Upload files · Google Drive · GitHub (connected vs connect). Don’t pitch Drive to everyone.

4) Drive picker polish
Prod: Load more pagination, Slides filter, Docs/Sheets/PDF/Images, breadcrumbs, multi-select.
Refine the Drive modal to match Aether shell language (not a pasted Google UI). Include Load more + Slides.

5) Tool / artifact construction while streaming
Prod streams create_artifact content and tool args; expandable “Writing…” construction.
Design live construction states: expandable tool row showing writing progress; artifact panel can open early and update while writing.

6) Notices / sync system
Prod: bottom notices + sync-local-chats banner can stack.
One coherent notice system: auto-dismiss rules, single stack, no overlapping cards with sync banner.

7) Projects / Vault dialogs
Replace browser prompt/confirm energy with lightweight in-app dialogs (create / rename / delete). Vault can stay powerful; make create/delete feel finished.

8) Sidebar search empty state
When Recent filter matches nothing: “No matches” — not a blank hole.

HARD RULES (same north star as the original brief)
- Consumer Claude/ChatGPT intuition. Labels shouldn’t need a paragraph.
- One composition per viewport; cards only when they ARE the interaction.
- One job per region: Sidebar=nav, Main=conversation, Composer=input, Inspector=artifact.
- Keep Aether fonts (serif display / UI sans / mono). Not Inter-only.
- Motion: 2–3 intentional (sidebar, inspector, listening pulse, message appear).
- Brand “Aether” present in the shell; no marketing page inside the app.

DELIVERABLES (update THIS Make, don’t fork a new product)
Desktop:
- Empty chat
- Active thread with tool construction + artifact open
- Timeout / Continue state (Continue visible; Continuing 2/3 status)
- Composer: attachments readable vs name-only; mic; stop
- Preferences with Dark / Light / White
- Drive modal with Load more + Slides
- Sidebar search empty + project create/rename dialog
Mobile:
- Shell drawer + composer + Continue state + artifact as drawer/inspector
Also: small component notes for Continue button, continue status line, attachment chip variants, notice toast.

SUCCESS
- Cut-off turns feel resumable, not failed.
- Three appearances feel intentional.
- Attachments/Drive communicate trust without developer copy.
- Prototype still feels like the same Aether Make — just sharper and aligned with shipping prod.
```

---

## Attach these files to the Make prompt

Re-attach from the Aether repo (zip or multi-file). Prefer **current `master` / latest PR**, not an old zip if you have one.

### Must attach (UI + behavior Make needs)
| File | Why |
|------|-----|
| `src/components/layout/app-shell.tsx` | Chrome, notices stack |
| `src/components/layout/sidebar.tsx` | Nav, search, projects, theme |
| `src/components/layout/vault-sidebar.tsx` | Vault + confirm flows to replace |
| `src/components/layout/artifact-panel.tsx` | Artifact inspector |
| `src/components/assistant-ui/thread.tsx` | Composer, Continue/Retry, attachments, mic/stop |
| `src/components/assistant-ui/tool-ui.tsx` | Tool shells + streaming artifact construction |
| `src/components/assistant-ui/agent-status-strip.tsx` | Status line (keep quiet) |
| `src/components/model-picker.tsx` | Featured models + search |
| `src/components/settings/settings-dialog.tsx` | Preferences / Advanced |
| `src/components/drive/drive-browser-modal.tsx` | Load more, Slides, filters |
| `src/components/sync-local-chats-banner.tsx` | Sync notice |
| `src/app/globals.css` | Dark / Light / White tokens |
| `src/app/layout.tsx` | Fonts |
| `src/providers/theme-provider.tsx` | Theme cycle |

### Strongly recommended (behavior Make should respect)
| File | Why |
|------|-----|
| `src/lib/chat-continue.ts` | Continue segment semantics + copy |
| `src/lib/attachments.ts` | Readable vs name-only budgets |
| `src/lib/office-text.ts` | Office → text (docx/pptx/xlsx) |
| `src/lib/tools.ts` | Artifact kinds + tool labels |
| `docs/figma-make-ux-brief.md` | Prior brief / constraints |
| `AGENTS.md` | Product constraints |

### Optional primitives
`src/components/ui/button.tsx`, `src/components/ui/label.tsx`, `src/components/assistant-ui/markdown-text.tsx`, `src/components/assistant-ui/thread-header.tsx`

### Live reference
https://aether-seven-theta.vercel.app/  
Capture: empty, streaming+tools, continue/timeout (if you can repro), Drive modal, settings appearances, mobile composer.

---

## Tip for Make
Say explicitly in the chat: *“Work in the existing App.tsx prototype; attach the listed prod files; this is a refinement pass focused on Continue, White theme, attachments, Drive Load more, and notices.”*
