"use client";

import { useEffect } from "react";
import { useAui } from "@assistant-ui/react";
import { useSettings } from "@/providers/settings-provider";
import { beginNewChatSession } from "@/lib/local-thread-adapter";

/**
 * Global shortcuts for a ChatGPT/Claude-class chat surface.
 * - ⌘/Ctrl+N — new conversation
 * - ⌘/Ctrl+K — focus message input
 * - ⌘/Ctrl+, — settings
 * - Escape — blur composer (when not in a modal)
 */
export function KeyboardShortcuts() {
  const aui = useAui();
  const { setOpenSettings, openSettings } = useSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inField =
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable === true;

      const meta = e.metaKey || e.ctrlKey;

      if (meta && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        aui.threads().switchToNewThread();
        beginNewChatSession();
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLTextAreaElement>(
              'textarea[aria-label="Message input"]',
            )
            ?.focus();
        });
        return;
      }

      if (meta && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        document
          .querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="Message input"]',
          )
          ?.focus();
        return;
      }

      if (meta && e.key === ",") {
        e.preventDefault();
        setOpenSettings(true);
        return;
      }

      if (e.key === "Escape" && !openSettings && inField) {
        (target as HTMLElement)?.blur?.();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aui, setOpenSettings, openSettings]);

  return null;
}
