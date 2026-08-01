"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
};

type Card = {
  icon: string;
  title: string;
  body: string;
  action: string;
  tone: "tip" | "alert" | "info" | "fun";
};

const STORAGE_KEY = "jarvis-conversation";
const PROFILE_KEY = "jarvis-profile";
const MEMORY_KEY = "jarvis-memories";
const PASS_KEY = "jarvis-passcode";
const BRIEFING_KEY = "jarvis-briefing";
const BRIEFING_TTL = 30 * 60 * 1000; // 30 min

const QUICK_ACTIONS: { icon: string; label: string; prompt: string }[] = [
  {
    icon: "📬",
    label: "Inbox digest",
    prompt: "Give me a digest of my recent emails — what needs my attention?",
  },
  {
    icon: "📅",
    label: "My week",
    prompt: "What's on my calendar this week? Flag anything I should prep for.",
  },
  {
    icon: "✍️",
    label: "Draft email",
    prompt: "Help me draft an email. Ask me who it's to and what it's about.",
  },
  {
    icon: "💭",
    label: "Brain dump",
    prompt:
      "I want to brain-dump. Listen, organize what I say into action items, and remember the important bits.",
  },
];

const TOOL_LABELS: Record<string, string> = {
  search_email: "searching gmail",
  read_email: "reading email",
  draft_email: "drafting email",
  send_email: "sending email",
  list_calendar_events: "checking calendar",
  create_calendar_event: "creating event",
  save_memory: "saving memory",
};

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  const [view, setView] = useState<"home" | "chat">("home");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [locked, setLocked] = useState(false);
  const [passInput, setPassInput] = useState("");
  const [passError, setPassError] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [profile, setProfile] = useState("");
  const [memories, setMemories] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages(loadJSON(STORAGE_KEY, [] as ChatMessage[]));
    setProfile(localStorage.getItem(PROFILE_KEY) ?? "");
    setMemories(loadJSON(MEMORY_KEY, [] as string[]));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(PROFILE_KEY, profile);
  }, [profile, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memories));
  }, [memories, hydrated]);

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, activeTool]);

  // ---- briefing ----
  const fetchBriefing = useCallback(
    async (force = false) => {
      if (!hydrated) return;
      const cached = loadJSON<{ cards: Card[]; ts: number } | null>(
        BRIEFING_KEY,
        null
      );
      if (!force && cached && Date.now() - cached.ts < BRIEFING_TTL) {
        setCards(cached.cards);
        return;
      }
      setBriefingLoading(true);
      setBriefingError(false);
      try {
        const res = await fetch("/api/briefing", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-jarvis-key": localStorage.getItem(PASS_KEY) ?? "",
          },
          body: JSON.stringify({
            profile,
            memories,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        if (res.status === 401) {
          setLocked(true);
          return;
        }
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!Array.isArray(data.cards)) throw new Error();
        setCards(data.cards);
        localStorage.setItem(
          BRIEFING_KEY,
          JSON.stringify({ cards: data.cards, ts: Date.now() })
        );
      } catch {
        setBriefingError(true);
        if (cached) setCards(cached.cards);
      } finally {
        setBriefingLoading(false);
      }
    },
    [hydrated, profile, memories]
  );

  useEffect(() => {
    if (hydrated) fetchBriefing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // ---- chat ----
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      setView("chat");

      const history: ChatMessage[] = [
        ...messages,
        { role: "user", content: trimmed },
      ];
      setMessages([...history, { role: "assistant", content: "" }]);
      setInput("");
      setStreaming(true);
      setActiveTool(null);

      const apiMessages = history.map(({ role, content }) => ({
        role,
        content,
      }));

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-jarvis-key": localStorage.getItem(PASS_KEY) ?? "",
          },
          body: JSON.stringify({ messages: apiMessages, profile, memories }),
        });

        if (res.status === 401) {
          setLocked(true);
          setMessages(messages);
          setInput(trimmed);
          return;
        }
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? `Request failed (${res.status})`);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let acc = "";
        const usedTools: string[] = [];

        const flushMessage = () => {
          setMessages([
            ...history,
            { role: "assistant", content: acc, tools: [...usedTools] },
          ]);
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let event: any;
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }
            if (event.t === "text") {
              acc += event.d;
              setActiveTool(null);
              flushMessage();
            } else if (event.t === "tool") {
              const label = TOOL_LABELS[event.name] ?? event.name;
              if (!usedTools.includes(label)) usedTools.push(label);
              setActiveTool(label);
              flushMessage();
            } else if (event.t === "mem") {
              setMemories((prev) =>
                prev.includes(event.d) ? prev : [...prev, event.d]
              );
            } else if (event.t === "err") {
              acc += `\n\n⚠️ ${event.d}`;
              flushMessage();
            }
          }
        }
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Something went wrong.";
        setMessages([
          ...history,
          { role: "assistant", content: `⚠️ ${msg}` },
        ]);
      } finally {
        setStreaming(false);
        setActiveTool(null);
        textareaRef.current?.focus();
      }
    },
    [messages, streaming, profile, memories]
  );

  const unlock = async () => {
    localStorage.setItem(PASS_KEY, passInput);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-jarvis-key": passInput,
      },
      body: JSON.stringify({ messages: [] }),
    });
    if (res.status === 401) {
      setPassError(true);
      return;
    }
    setLocked(false);
    setPassError(false);
    setPassInput("");
    fetchBriefing();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
  };

  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
    setView("home");
  };

  const firstName = profile.match(/I'?m (\w+)/i)?.[1] ?? "";
  const lastIdx = messages.length - 1;

  return (
    <>
      <div className="blobs" aria-hidden>
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
      </div>

      {locked && (
        <div className="gate">
          <div className="gate-card">
            <div className="logo-dot big" />
            <h2>Jarvis is locked</h2>
            <p>Enter your passcode to continue.</p>
            <input
              type="password"
              value={passInput}
              autoFocus
              placeholder="Passcode"
              onChange={(e) => setPassInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && unlock()}
            />
            {passError && <span className="gate-error">Wrong passcode</span>}
            <button onClick={unlock}>Unlock</button>
          </div>
        </div>
      )}

      <main className="shell">
        <header className="topbar">
          <div className="brand">
            {view === "chat" ? (
              <button
                className="back-btn"
                onClick={() => setView("home")}
                aria-label="Home"
              >
                ←
              </button>
            ) : (
              <div className={`logo-dot ${streaming ? "thinking" : ""}`} />
            )}
            <div>
              <h1>JARVIS</h1>
              <div className="status">
                {streaming
                  ? activeTool
                    ? `${activeTool}…`
                    : "thinking…"
                  : "your personal agent"}
              </div>
            </div>
          </div>
          <div className="topbar-actions">
            {view === "chat" && messages.length > 0 && (
              <button className="pill-btn" onClick={clearChat}>
                clear
              </button>
            )}
            <button className="pill-btn" onClick={() => setShowSettings(true)}>
              me
            </button>
          </div>
        </header>

        {view === "home" ? (
          <div className="home">
            <div className="hello">
              <h2>
                {greeting()}
                {firstName ? `, ${firstName}` : ""}! 👋
              </h2>
              <p>What are we getting done today?</p>
            </div>

            <div className="tiles">
              {QUICK_ACTIONS.map((a, i) => (
                <button
                  key={a.label}
                  className={`tile t${i}`}
                  onClick={() => send(a.prompt)}
                >
                  <span className="tile-icon">{a.icon}</span>
                  <span className="tile-label">{a.label}</span>
                </button>
              ))}
            </div>

            <div className="feed-head">
              <h3>✨ Jarvis suggests</h3>
              <button
                className="pill-btn"
                onClick={() => fetchBriefing(true)}
                disabled={briefingLoading}
              >
                {briefingLoading ? "thinking…" : "refresh"}
              </button>
            </div>

            <div className="feed">
              {briefingLoading && !cards && (
                <>
                  <div className="card skeleton" />
                  <div className="card skeleton" />
                  <div className="card skeleton" />
                </>
              )}
              {briefingError && !cards && (
                <div className="card tone-alert">
                  <span className="card-icon">😵</span>
                  <div>
                    <strong>Couldn&apos;t load suggestions</strong>
                    <p>Tap refresh to try again.</p>
                  </div>
                </div>
              )}
              {cards?.map((c, i) => (
                <button
                  key={i}
                  className={`card tone-${c.tone}`}
                  onClick={() => send(c.action)}
                >
                  <span className="card-icon">{c.icon}</span>
                  <div>
                    <strong>{c.title}</strong>
                    <p>{c.body}</p>
                  </div>
                  <span className="card-go">→</span>
                </button>
              ))}
              {cards && cards.length === 0 && (
                <div className="card tone-info">
                  <span className="card-icon">🌴</span>
                  <div>
                    <strong>All clear</strong>
                    <p>Nothing needs your attention right now.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="thread" ref={threadRef}>
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <span className="who">
                  {m.role === "user" ? "you" : "jarvis"}
                </span>
                {m.tools && m.tools.length > 0 && (
                  <div className="tool-trail">
                    {m.tools.map((t) => (
                      <span key={t} className="tool-chip">
                        ⚙ {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="bubble">
                  {m.role === "assistant" ? (
                    <>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {m.content}
                      </ReactMarkdown>
                      {streaming && i === lastIdx && (
                        <span className="cursor" />
                      )}
                    </>
                  ) : (
                    m.content
                  )}
                </div>
              </div>
            ))}
            {streaming && activeTool && (
              <div className="working">⚙ {activeTool}…</div>
            )}
          </div>
        )}

        <div className="composer">
          <div className="field">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              placeholder={
                view === "home" ? "Or just ask me anything…" : "Ask me anything…"
              }
              onChange={autoGrow}
              onKeyDown={handleKeyDown}
            />
          </div>
          <button
            className="send-btn"
            onClick={() => send(input)}
            disabled={streaming || !input.trim()}
            aria-label="Send"
          >
            ↑
          </button>
        </div>
      </main>

      {showSettings && (
        <div className="drawer-backdrop" onClick={() => setShowSettings(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h3>About you</h3>
              <button className="pill-btn" onClick={() => setShowSettings(false)}>
                close
              </button>
            </div>
            <p className="drawer-hint">
              Jarvis reads this before every conversation. Name, role, city,
              priorities, how you like things done.
            </p>
            <textarea
              className="profile-input"
              value={profile}
              placeholder={
                "e.g. I'm Janavi, a student at Columbia. I'm building my portfolio site and a startup idea. Keep answers short."
              }
              onChange={(e) => setProfile(e.target.value)}
              rows={6}
            />
            <div className="drawer-head" style={{ marginTop: 24 }}>
              <h3>Memories ({memories.length})</h3>
            </div>
            <p className="drawer-hint">
              Things Jarvis has learned. Say &quot;remember that…&quot; in chat
              to add more.
            </p>
            <ul className="memory-list">
              {memories.length === 0 && (
                <li className="memory-empty">No memories yet.</li>
              )}
              {memories.map((m, i) => (
                <li key={i}>
                  <span>{m}</span>
                  <button
                    onClick={() =>
                      setMemories(memories.filter((_, j) => j !== i))
                    }
                    aria-label="Forget"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
