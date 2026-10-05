# Sidebar / first-send race (deferred)

Symptom (browser, first message of a new recursion chat, no tools): the URL
briefly returned to `/` while the model was thinking, the composer showed Send
mid-thinking, and an extra empty "New conversation" row appeared in the sidebar.

Status: **not fixed.** No browser was available in this pass, so the race was
not reproduced. The notes below come from reading the code, and each suspect is
a hypothesis.

## First-send flow

1. `runtime-provider.tsx` `prepareSendMessagesRequest` (~L227) binds the durable
   `useChat` id to the optimistic `__LOCALID_…` thread with `bindDurableChatId`.
2. assistant-ui calls `initialize()` in `local-thread-adapter.tsx` (~L552). It
   returns the bound id as `remoteId` immediately, writes an untitled row to
   localStorage, and calls `cloudCreateThread` in the background.
3. `thread-url-sync.tsx` Active→URL effect (~L104) sees the new `remoteId` and
   calls `router.replace("/c/<id>")`, recording `pendingPath`.

## Suspected race

`ThreadUrlSync` writes `/` whenever `canonicalId` is null or `itemIsNew` is true
(`planActiveThreadToUrl`, `thread-url.ts` ~L66). If assistant-ui swaps the active
list item to a fresh `status: "new"` item right after `initialize()` resolves,
`itemKey` changes, `stickyCanonicalId` recomputes to `null` (rawId is null for
`status === "new"`, `thread-url-sync.tsx` ~L55), and the effect replaces the URL
with `/`. The same swap would explain the other two symptoms:

- The extra empty row is the new placeholder item. The untitled thread that
  `initialize()` saved also renders as "New conversation" until `generateTitle`
  patches it (`local-thread-adapter.tsx` ~L666).
- The composer flips to Send because `useChatThreadRuntime` remounts for the new
  item key while the turn is still running (`isRunning` resets).

A second path to the same result: `planUrlToThread` returns `switch-new` when the
path is `/` and `pendingPath` was already cleared (`thread-url-sync.tsx` ~L133),
which calls `switchToNewThread()` and mounts another empty thread.

## Why deferred

- The cause depends on assistant-ui's remote-thread-list event ordering, which I
  could not observe without a live run.
- `thread-url.ts` carries several latches (`pendingNewChat`, `applyingUrlThread`,
  `pendingPath`) that fix earlier races. A change guessed from static reading
  risks reopening those.

## Suggested next step

Reproduce with a browser, log `itemKey`, `itemIsNew`, `rawId`, `pathname` and
`pendingPath` on every `ThreadUrlSync` render during first send, then confirm
whether `itemKey` changes after `initialize()`. If it does, hold the `/` write
in `planActiveThreadToUrl` while a first-send turn is running, and add a case to
`thread-url.test.ts`.
