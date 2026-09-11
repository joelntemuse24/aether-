"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = { failed: boolean };

/**
 * A failed tool / markdown part must not whitescreen the thread.
 * Keep the composer and the rest of the turn on screen.
 */
export class ChatRenderErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[chat-render]", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <p className="max-w-sm text-[16px] leading-relaxed text-[var(--text)]">
            Couldn’t load this chat. Your history is still here — try again.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ failed: false })}
            className="mt-4 rounded-full bg-[var(--accent)] px-4 py-2 text-[13px] text-white"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
