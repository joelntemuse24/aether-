# Figma Make brief — Aether UI/UX polish

Paste everything under **Prompt for Figma Make** into Figma Make. Attach / open the **Relevant files** listed below (or screenshots of those screens in the live app) so Make matches the real product, not a generic chat template.

---

## Prompt for Figma Make

```
You are redesigning UI/UX polish for Aether — a BYOK + hosted AI chat app (Next.js). This is NOT a marketing landing page and NOT a dashboard. Preserve the existing product structure and visual language; raise craft, clarity, and calm.

### Product feel
- Quiet, literary, tool-aware chat — closer to a focused writing desk than ChatGPT chrome.
- Brand “Aether” should stay present but never shout over the conversation.
- Themes already exist: Dark, Light (warm parchment), White (near-white). Design tokens must work in all three; do not invent a purple/indigo AI cliché theme.

### Hard layout rules
- First viewport of empty chat = one composition (greeting + composer), not a control panel.
- No card-heavy hero. Cards only where the user is choosing/acting (attachments, Drive picker, settings rows).
- One job per section. Reduce pill clusters, stat strips, icon salads, floating badges on media.
- Mobile and desktop both matter; composer and sidebar must feel intentional under 640px.

### What to redesign (priority order)

1) **Chat thread + long-run clarity**
   - Assistant message actions: Continue vs Retry must be visually distinct when a turn was cut off by a time limit.
   - While tools/artifacts are building: expandable “construction” states (writing artifact, tool args streaming) — readable, not noisy.
   - Auto-continue segments: subtle inline status (“Continuing… 2/3”) near the composer or last message — not a toast pile.
   - Error / incomplete message treatment that invites Continue without looking like a hard failure.

2) **Composer**
   - Attach menu (Upload / Drive / GitHub), model picker, mic, Send/Stop.
   - Attachment chips: show when a file is model-readable vs name-only; avoid scary red unless blocked.
   - Drag-drop affordance without turning the composer into a dashed “dropzone card.”

3) **Sidebar**
   - Recent chats search empty state (“No matches”).
   - Projects + Vault: replace browser prompt/confirm energy with proper lightweight dialogs (create / rename / delete).
   - Theme cycle control should feel native, not a leftover icon.

4) **Settings / Connected accounts**
   - BYOK vs Aether Cloud, model advanced custom base URL, Drive/GitHub connect states.
   - Clear hierarchy; less “settings dump.”

5) **Drive browser modal**
   - Grid/list, filters (All / Recent / PDF / Images / Docs / Sheets / Slides), breadcrumbs, multi-select, Load more.
   - Feel like a file picker inside Aether, not Google Drive pasted in.

6) **Artifact panel**
   - Document / code / data / svg / image kinds.
   - Live “writing” state + Open affordance.
   - Export actions (copy / download / print-PDF) without looking like a separate app.

7) **Notices / sync banner**
   - Bottom notices + local→cloud sync prompt: one coherent system, auto-dismiss rules, no overlapping stacks.

### Deliverables in Figma
- Desktop + mobile frames for: Empty chat, Active streaming w/ tools+artifact, Timeout/Continue state, Composer with attachments, Sidebar (search empty + project dialog), Settings, Drive modal, Artifact panel open.
- A small component set: buttons, icon buttons, chips, tool shell, notice, dialog, sidebar row.
- Explicit light / white / dark examples for the chat shell + composer at minimum.

### Do NOT
- Redesign the product into a SaaS marketing site.
- Add purple glow, glassmorphism stacks, or dashboard KPI strips.
- Invent PPT/DOCX export UI as if Office files are generated natively (artifacts are markdown/code/pdf-print today).
- Hide the brand; don’t let a generic headline overpower “Aether.”
```

---

## Relevant files (attach or screenshot these)

### Shell / layout
- `src/components/layout/app-shell.tsx` — overall chrome, notices
- `src/components/layout/sidebar.tsx` — recent, search, projects
- `src/components/layout/vault-sidebar.tsx` — vault UI + confirm flows
- `src/components/layout/artifact-panel.tsx` — artifact side panel
- `src/components/sync-local-chats-banner.tsx` — sync prompt
- `src/app/globals.css` — theme tokens (dark / light / white)

### Chat surface
- `src/components/assistant-ui/thread.tsx` — greeting, composer, messages, Continue/Retry, attachments
- `src/components/assistant-ui/tool-ui.tsx` — tool shells + artifact construction streaming
- `src/components/assistant-ui/agent-status-strip.tsx` — thinking / status line
- `src/components/model-picker.tsx` — model selector

### Modals / settings
- `src/components/settings/settings-dialog.tsx` — settings / BYOK / cloud
- `src/components/drive/drive-browser-modal.tsx` — Drive picker (incl. Load more, filters)

### Theme
- `src/providers/theme-provider.tsx` — Dark / Light / White

### Optional product context (behavior, not visuals)
- `src/lib/chat-continue.ts` — auto-continue semantics (for Continue UX copy)
- `src/lib/tools.ts` — artifact kinds + tool labels
- `AGENTS.md` — product constraints (BYOK, no `/settings` route, Drive returns `/?connect=drive`)

### Live reference
- Production: `https://aether-seven-theta.vercel.app/`
- Capture: empty state, mid-tool turn, artifact open, settings, Drive modal, mobile composer.

---

## Notes for you (human)
- Functional backend work for attachments / Drive / Office text / continue is shipping separately in code; Make should **assume those behaviors exist** and design the UI around them.
- Prefer refining the existing Aether visual system over a full rebrand.
