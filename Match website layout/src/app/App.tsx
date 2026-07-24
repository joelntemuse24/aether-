import { useState, useRef, useEffect } from "react";
import {
  Plus,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  Settings,
  MessageSquare,
  Trash2,
  ArrowUp,
  Square,
  ChevronDown,
  RefreshCw,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  ArrowDown,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

type Message = { id: string; role: "user" | "assistant"; content: string };
type Thread  = { id: string; title: string; messages: Message[] };

// ─── Sparkle (matches thread.tsx) ─────────────────────────────────────────

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2.5c.4 3.8 1.7 6.2 4.2 8.2-2.5 2-3.8 4.4-4.2 8.2-.4-3.8-1.7-6.2-4.2-8.2C10.3 8.7 11.6 6.3 12 2.5z" />
      <path d="M18.5 4c.2 1.6.8 2.6 1.9 3.5-1.1.9-1.7 1.9-1.9 3.5-.2-1.6-.8-2.6-1.9-3.5 1.1-.9 1.7-1.9 1.9-3.5z" opacity="0.85" />
      <path d="M6 14c.15 1.2.55 1.95 1.4 2.65-.85.7-1.25 1.45-1.4 2.65-.15-1.2-.55-1.95-1.4-2.65.85-.7 1.25-1.45 1.4-2.65z" opacity="0.7" />
    </svg>
  );
}

// ─── Label (small-caps editorial label, like Claremont) ───────────────────

function Label({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-sc)",
        fontSize: 10,
        letterSpacing: "0.14em",
        fontWeight: 500,
        textTransform: "uppercase",
        color: accent ? "var(--accent)" : "var(--muted-soft)",
      }}
    >
      {children}
    </span>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────

function Sidebar({
  collapsed, onToggle, threads, activeThreadId,
  onSelectThread, onNewThread, onDeleteThread, onOpenSettings,
}: {
  collapsed: boolean; onToggle: () => void; threads: Thread[];
  activeThreadId: string | null; onSelectThread: (id: string) => void;
  onNewThread: () => void; onDeleteThread: (id: string) => void;
  onOpenSettings: () => void;
}) {
  if (collapsed) {
    return (
      <aside
        className="flex h-full w-12 shrink-0 flex-col items-center py-3"
        style={{ background: "var(--elevated)", borderRight: "1px solid var(--border)" }}
      >
        <button onClick={onToggle} title="Expand sidebar"
          className="mb-3 flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-white/5"
          style={{ color: "var(--muted)" }}>
          <PanelLeftIcon className="size-4" />
        </button>
        <button onClick={onNewThread} title="New chat"
          className="mb-auto flex size-8 items-center justify-center rounded-lg transition-colors"
          style={{ color: "var(--accent)" }}>
          <Plus className="size-4" />
        </button>
        <button onClick={onOpenSettings} title="Settings"
          className="flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-white/5"
          style={{ color: "var(--muted)" }}>
          <Settings className="size-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="flex h-full w-[248px] shrink-0 flex-col"
      style={{ background: "var(--elevated)", borderRight: "1px solid var(--border)" }}
    >
      {/* Brand */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded"
            style={{ background: "var(--accent-muted)", color: "var(--accent)" }}>
            <SparkleIcon className="size-3.5" />
          </div>
          <span style={{
            fontFamily: "var(--font-sc)",
            fontSize: 13,
            letterSpacing: "0.08em",
            fontWeight: 500,
            color: "var(--text)",
          }}>
            Aether
          </span>
        </div>
        <button onClick={onToggle} title="Collapse sidebar"
          className="flex size-7 items-center justify-center rounded transition-colors hover:bg-white/5"
          style={{ color: "var(--muted)" }}>
          <PanelLeftCloseIcon className="size-3.5" />
        </button>
      </div>

      {/* New chat */}
      <div className="px-3 pb-3">
        <button onClick={onNewThread}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/5"
          style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
          <Plus className="size-3.5 shrink-0" style={{ color: "var(--accent)" }} />
          <Label>New conversation</Label>
        </button>
      </div>

      {/* Threads */}
      <div className="px-2 pb-1 pt-0.5">
        <Label>Recent</Label>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-8" style={{ color: "var(--muted-soft)" }}>
            <MessageSquare className="size-5 opacity-40" />
            <Label>No conversations yet</Label>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {threads.map((t) => (
              <div key={t.id} className="group relative flex items-center rounded-md"
                style={{ background: activeThreadId === t.id ? "var(--elevated-deep)" : "transparent" }}>
                <button onClick={() => onSelectThread(t.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
                  style={{ fontSize: 13, color: "var(--text)", fontFamily: "'Inter', sans-serif" }}>
                  <span className="truncate">{t.title}</span>
                </button>
                <button onClick={() => onDeleteThread(t.id)} title="Delete"
                  className="me-1 flex size-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/5"
                  style={{ color: "var(--muted)" }}>
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Settings footer */}
      <div className="p-3" style={{ borderTop: "1px solid var(--border)" }}>
        <button onClick={onOpenSettings}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-white/5"
          style={{ color: "var(--muted)" }}>
          <Settings className="size-3.5 shrink-0" />
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate" style={{ fontSize: 12, color: "var(--text)", fontFamily: "'Inter', sans-serif" }}>Settings</div>
            <Label>Model · API key</Label>
          </div>
        </button>
      </div>
    </aside>
  );
}

// ─── Model Picker ─────────────────────────────────────────────────────────

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", desc: "Balanced · fast" },
  { id: "claude-opus-4-8",   label: "Claude Opus 4.8",   desc: "Most capable" },
  { id: "claude-haiku-4-5",  label: "Claude Haiku 4.5",  desc: "Fastest · light" },
];

function ModelPicker({ model, onSelect }: { model: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = MODELS.find((m) => m.id === model) ?? MODELS[0];

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="flex h-6 items-center gap-1 rounded px-1.5 transition-colors hover:bg-white/5"
        style={{ color: "var(--muted)" }}>
        <Label>{active.label}</Label>
        <ChevronDown className="size-3 opacity-50 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-60 overflow-hidden rounded-lg py-1"
          style={{ border: "1px solid var(--border)", background: "var(--elevated-deep)" }}>
          <div className="px-3 pb-1.5 pt-2">
            <Label>Models</Label>
          </div>
          {MODELS.map((m) => {
            const sel = active.id === m.id;
            return (
              <button key={m.id} onClick={() => { onSelect(m.id); setOpen(false); }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
                style={{ background: sel ? "var(--accent-muted)" : undefined }}>
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: 13, color: "var(--text)", fontFamily: "'Inter', sans-serif" }}>{m.label}</div>
                  <Label>{m.desc}</Label>
                </div>
                {sel && <Check className="mt-0.5 size-3.5 shrink-0" style={{ color: "var(--accent)" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Composer ─────────────────────────────────────────────────────────────

function Composer({ onSend, isRunning, onStop, model, onModelChange }: {
  onSend: (t: string) => void; isRunning: boolean; onStop: () => void;
  model: string; onModelChange: (id: string) => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const send = () => {
    const t = value.trim();
    if (!t || isRunning) return;
    onSend(t);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  };

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl p-2 transition-[border-color] focus-within:border-[rgba(168,50,50,0.3)]"
      style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
      <textarea ref={ref} value={value} rows={1} autoFocus
        onChange={(e) => { setValue(e.target.value); resize(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        placeholder="How can I help you today?"
        className="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-2.5 py-2 leading-relaxed outline-none"
        style={{
          fontSize: 15,
          color: "var(--text)",
          fontFamily: "'Inter', sans-serif",
        }}
      />
      <div className="flex items-center justify-between gap-2 px-0.5">
        <ModelPicker model={model} onSelect={onModelChange} />
        <div className="flex items-center gap-1">
          {isRunning ? (
            <button onClick={onStop} aria-label="Stop"
              className="flex size-7 items-center justify-center rounded-full text-white transition-opacity hover:opacity-80"
              style={{ background: "var(--text)" }}>
              <Square className="size-2.5 fill-current" />
            </button>
          ) : (
            <button onClick={send} disabled={!value.trim()} aria-label="Send"
              className="flex size-7 items-center justify-center rounded-full text-white transition-colors disabled:opacity-30"
              style={{ background: "var(--accent)" }}>
              <ArrowUp className="size-3.5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Messages ─────────────────────────────────────────────────────────────

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex flex-col items-end">
      <div className="relative max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 sm:max-w-[80%]"
        style={{ background: "var(--elevated-deep)", color: "var(--text)", fontSize: 15, lineHeight: 1.6, fontFamily: "'Inter', sans-serif" }}>
        {content}
      </div>
    </div>
  );
}

function AssistantMessage({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group/message relative">
      <div className="px-1"
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 19,
          lineHeight: 1.72,
          letterSpacing: "-0.01em",
          color: "var(--text)",
        }}>
        {content}
        {isStreaming && (
          <span className="ml-1 inline-block size-2 animate-pulse rounded-full"
            style={{ background: "var(--accent)" }} aria-label="Generating" />
        )}
      </div>
      {!isStreaming && content && (
        <div className="mt-1.5 flex min-h-8 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100">
          {[
            { icon: copied ? Check : Copy, label: "Copy", action: copy, green: copied },
            { icon: RefreshCw, label: "Regenerate", action: () => {} },
            { icon: ThumbsUp, label: "Good response", action: () => {} },
            { icon: ThumbsDown, label: "Bad response", action: () => {} },
          ].map(({ icon: Icon, label, action, green }) => (
            <button key={label} title={label} onClick={action}
              className="flex size-7 items-center justify-center rounded transition-colors hover:bg-white/5"
              style={{ color: green ? "#059669" : "var(--muted)" }}>
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Thread Welcome ────────────────────────────────────────────────────────

function ThreadWelcome() {
  return (
    <div className="mb-10 flex flex-col items-center px-4 text-center">
      <div className="mb-6 flex size-11 items-center justify-center rounded-xl"
        style={{ background: "var(--accent-muted)", color: "var(--accent)" }}>
        <SparkleIcon className="size-6" />
      </div>
      {/* Italic Cormorant headline — editorial, warm */}
      <h1 style={{
        fontFamily: "var(--font-serif)",
        fontSize: "clamp(1.9rem, 4vw, 2.4rem)",
        fontWeight: 400,
        fontStyle: "italic",
        letterSpacing: "-0.015em",
        lineHeight: 1.2,
        color: "var(--text)",
        maxWidth: "26rem",
      }}>
        How can I help you today?
      </h1>
      <div className="mt-3">
        <Label>Ask anything · Shift+Enter for new line</Label>
      </div>
    </div>
  );
}

// ─── Settings Dialog ───────────────────────────────────────────────────────

function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: "rgba(10,9,6,0.6)" }}
        onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-md rounded-xl"
        style={{ border: "1px solid var(--border)", background: "var(--canvas)" }}>
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontFamily: "var(--font-sc)", fontSize: 14, letterSpacing: "0.06em", color: "var(--text)" }}>
            Settings
          </span>
          <button onClick={onClose} className="rounded p-1 transition-colors hover:bg-white/5"
            style={{ color: "var(--muted)", fontSize: 16 }}>✕</button>
        </div>
        <div className="space-y-5 px-5 py-5">
          <p className="text-sm leading-relaxed" style={{ color: "var(--muted)", fontFamily: "'Inter', sans-serif" }}>
            Bring your own key. Stored in this browser's localStorage and sent only to your chosen provider.
          </p>
          <div className="space-y-2">
            <Label>API Key</Label>
            <input type="password" placeholder="sk-..."
              className="mt-1.5 w-full rounded-lg px-3 py-2.5 text-sm outline-none"
              style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontFamily: "'Inter', sans-serif" }} />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4"
          style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm transition-colors hover:bg-white/5"
            style={{ color: "var(--muted)", fontFamily: "'Inter', sans-serif" }}>
            Cancel
          </button>
          <button onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ background: "var(--accent)", fontFamily: "'Inter', sans-serif" }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────

const DEMO = "That's a compelling question. I'm a demo interface — to receive real responses from Claude, add an API key in Settings. In the meantime, feel free to explore the layout, compose messages, and see how the conversation thread builds.";

let tc = 0;
const mkThread = (): Thread => ({ id: `t-${++tc}`, title: "New chat", messages: [] });

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [model, setModel] = useState(MODELS[0].id);
  const [showScroll, setShowScroll] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = threads.find((t) => t.id === activeId) ?? null;
  const messages = active?.messages ?? [];
  const isEmpty = messages.length === 0;

  useEffect(() => { if (!isRunning) bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, isRunning]);

  const handleSend = (text: string) => {
    let tid = activeId;
    if (!tid) {
      const t = mkThread();
      t.title = text.slice(0, 42) + (text.length > 42 ? "…" : "");
      setThreads((p) => [t, ...p]);
      setActiveId(t.id);
      tid = t.id;
    }
    const uid = `u-${Date.now()}`;
    const aid = `a-${Date.now()}`;
    setThreads((p) => p.map((t) => t.id === tid
      ? { ...t, messages: [...t.messages, { id: uid, role: "user", content: text }, { id: aid, role: "assistant", content: "" }] }
      : t));
    setIsRunning(true);
    let i = 0;
    const iv = setInterval(() => {
      i += Math.ceil(Math.random() * 5);
      const chunk = DEMO.slice(0, i);
      setThreads((p) => p.map((t) => t.id === tid
        ? { ...t, messages: t.messages.map((m) => m.id === aid ? { ...m, content: chunk } : m) }
        : t));
      if (i >= DEMO.length) { clearInterval(iv); setIsRunning(false); }
    }, 22);
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden"
      style={{ background: "var(--canvas)", color: "var(--text)", fontFamily: "'Inter', sans-serif" }}>

      {/* Desktop sidebar */}
      <div className="hidden h-full md:flex">
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)}
          threads={threads} activeThreadId={activeId} onSelectThread={setActiveId}
          onNewThread={() => setActiveId(null)}
          onDeleteThread={(id) => { setThreads((p) => p.filter((t) => t.id !== id)); if (activeId === id) setActiveId(null); }}
          onOpenSettings={() => setSettingsOpen(true)} />
      </div>

      {/* Mobile drawer */}
      {mobileSidebar && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0" style={{ background: "rgba(10,9,6,0.5)" }}
            onClick={() => setMobileSidebar(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 z-10 w-[248px]">
            <Sidebar collapsed={false} onToggle={() => setMobileSidebar(false)}
              threads={threads} activeThreadId={activeId}
              onSelectThread={(id) => { setActiveId(id); setMobileSidebar(false); }}
              onNewThread={() => { setActiveId(null); setMobileSidebar(false); }}
              onDeleteThread={(id) => { setThreads((p) => p.filter((t) => t.id !== id)); if (activeId === id) setActiveId(null); }}
              onOpenSettings={() => { setSettingsOpen(true); setMobileSidebar(false); }} />
          </div>
        </div>
      )}

      {/* Main */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Mobile bar */}
        <div className="flex items-center gap-2 px-3 py-2 md:hidden"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <button onClick={() => setMobileSidebar(true)}
            className="rounded px-2 py-1 transition-colors hover:bg-white/5"
            style={{ color: "var(--muted)" }}>
            <Label>Menu</Label>
          </button>
          <span style={{ fontFamily: "var(--font-sc)", fontSize: 13, letterSpacing: "0.08em", color: "var(--text)" }}>Aether</span>
        </div>

        {/* Viewport */}
        <div ref={viewportRef} onScroll={() => {
          const el = viewportRef.current;
          if (el) setShowScroll(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
        }}
          className="relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto scroll-smooth">
          <div className="mx-auto flex w-full flex-1 flex-col px-4 pt-8 sm:px-6"
            style={{ maxWidth: "48rem", justifyContent: isEmpty ? "center" : undefined }}>

            {isEmpty && <ThreadWelcome />}

            <div className="mb-16 flex flex-col gap-y-8 empty:hidden">
              {messages.map((msg, i) => {
                const streaming = isRunning && i === messages.length - 1 && msg.role === "assistant";
                return msg.role === "user"
                  ? <UserMessage key={msg.id} content={msg.content} />
                  : <AssistantMessage key={msg.id} content={msg.content} isStreaming={streaming} />;
              })}
            </div>

            {/* Sticky footer */}
            <div className="flex flex-col gap-3 overflow-visible pb-5 md:pb-7"
              style={{ position: isEmpty ? "static" : "sticky", bottom: 0, marginTop: isEmpty ? 0 : "auto" }}>
              {!isEmpty && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-14 h-14"
                  style={{ background: "linear-gradient(to bottom, transparent, var(--canvas))" }} />
              )}
              {/* Scroll button */}
              {showScroll && (
                <div className="relative flex justify-center">
                  <button onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
                    className="absolute -top-10 z-10 flex size-8 items-center justify-center rounded-full transition-colors"
                    style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)" }}
                    title="Scroll to bottom">
                    <ArrowDown className="size-3.5" />
                  </button>
                </div>
              )}
              <Composer onSend={handleSend} isRunning={isRunning} onStop={() => setIsRunning(false)}
                model={model} onModelChange={setModel} />
              {isEmpty && (
                <p className="text-center" style={{ fontSize: 11, color: "var(--muted-soft)", fontFamily: "var(--font-sc)", letterSpacing: "0.06em" }}>
                  Responses are generated by the selected model · Check important information
                </p>
              )}
            </div>
          </div>
          <div ref={bottomRef} />
        </div>
      </main>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
