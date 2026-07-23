# Aether

A high-fidelity AI chat workspace inspired by modern cream-canvas assistants. Built with **Next.js 15**, **assistant-ui**, and the **Vercel AI SDK**. Bring your own key — nothing is stored on a server.

## Features

- Warm cream canvas (`#faf9f5`), Newsreader serif for reading, clean sans for chrome
- Collapsible conversation sidebar with **localStorage** history
- Sticky composer with model picker, streaming, and stop/cancel
- BYOK providers: **OpenRouter** (default), OpenAI, Anthropic, or any OpenAI-compatible base URL
- Markdown + GFM, code blocks, and a right-side **artifact panel** for longer code
- Hover-only message actions (copy, regenerate, feedback)
- Ready for one-click deploy on **Vercel**

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. Open **Settings** (opens automatically on first visit).
2. Paste an [OpenRouter](https://openrouter.ai/keys) API key (`sk-or-…`).
3. Pick a model in the composer and start chatting.

Keys and conversations live in **browser localStorage** only.

## Providers

| Provider | Notes |
| --- | --- |
| **OpenRouter** (recommended) | One key for Claude, GPT, Gemini, DeepSeek, Kimi, Qwen, GLM, Llama, etc. |
| OpenAI | Direct OpenAI API |
| Anthropic | Direct Anthropic API |
| Custom | Any OpenAI-compatible base URL |

Optional custom model ids (e.g. `moonshotai/kimi-k2`) can be set in Settings.

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS v4
- `@assistant-ui/react` + `@assistant-ui/react-ai-sdk` + `@assistant-ui/react-markdown`
- Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`)
- `next/font` — Newsreader (opsz + italic), Geist Sans/Mono

## Design tokens

Colors and type live in:

- `src/app/globals.css` — CSS variables
- `src/lib/tokens.ts` — documented token map

Assistant messages use Newsreader with `leading-[1.65]` and slight negative tracking. UI chrome uses Geist / system sans. Do **not** use Tailwind’s generic `font-serif`.

## Deploy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone)

Or from the CLI:

```bash
npx vercel
```

No required environment variables for v1 — users bring their own keys in the UI.

## Project layout

```
src/
  app/
    api/chat/route.ts   # Streaming proxy (BYOK via headers)
    globals.css         # Cream tokens + Newsreader hooks
    layout.tsx
    page.tsx
  components/
    assistant-ui/       # Thread, markdown, tooltips
    layout/             # Shell, sidebar, artifact panel
    settings/           # BYOK settings dialog
    model-picker.tsx
  lib/                  # tokens, settings, models, utils
  providers/            # settings, runtime, artifacts
```

## Scripts

```bash
npm run dev      # local dev (Turbopack)
npm run build    # production build
npm run start    # serve production build
npm run lint     # eslint
```

## Privacy

API keys never leave the browser except as request headers to this app’s `/api/chat` route, which forwards them to the provider you chose. Conversation history is stored only in `localStorage` under the `aether:` prefix.

## License

MIT
