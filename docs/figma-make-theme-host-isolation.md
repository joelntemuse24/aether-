# Figma Make — two themes + host isolation

Use inside  
`https://www.figma.com/make/ipxnTHtemrhVnpNwyaiFff/Redesign-Aether-Chat-App`

## Modes (only two)

| Mode | Canvas | Notes |
|------|--------|--------|
| **Light** (default) | `#faf7f1` warm parchment | Default even if the OS/browser is dark |
| **Dark** | `#17150f` warm brownish charcoal | Not cool gray `#1a1a1c` |

No White theme. Do **not** follow `prefers-color-scheme`.

## Host `.dark` isolation (still required in Make)

```
@custom-variant dark (&:where(.aether-dark, .aether-dark *));
```

Declare tokens on `:root` / `.aether-light` and `.aether-dark` (and `.aether-app-shell.*`).  
Class html, body, and the shell in `useLayoutEffect`. Strip host `class="dark"`.  
`html { color-scheme: only light; }` / `html.aether-dark { color-scheme: only dark; }`.

Toggle is Light ↔ Dark only.
