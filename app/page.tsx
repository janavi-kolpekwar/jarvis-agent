"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
};

const STORAGE_KEY = "jarvis-conversation";
const PROFILE_KEY = "jarvis-profile";
const MEMORY_KEY = "jarvis-memories";
const PASS_KEY = "jarvis-passcode";

const SUGGESTIONS = [
  "Summarize my unread emails",
  "What's on my calendar this week?",
  "Pull up my action items from Pocket",
  "Draft a follow-up email for me",
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

export default function Home() {
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

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

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
          body: JSON.stringify({
            messages: apiMessages,
            profile,
            memories,
          }),
        });

        if (res.status === 401) {
          setLocked(true);
          setMessages(messages); // roll back optimistic messages
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
    // probe with a throwaway request
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
  };

  const lastIdx = messages.length - 1;

  return (
    <>
      <div className="aurora" />
      <div className="grid-overlay" />

      {locked && (
        <div className="gate">
          <div className="gate-card">
            <div className="big-orb" style={{ width: 64, height: 64 }} />
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
            <div className={`orb ${streaming ? "thinking" : ""}`} />
            <div>
              <h1>JARVIS</h1>
              <div className="status">
                {streaming
                  ? activeTool
                    ? `${activeTool}…`
                    : "thinking…"
                  : "online · claude opus 5"}
              </div>
            </div>
          </div>
          <div className="topbar-actions">
            {messages.length > 0 && (
              <button className="clear-btn" onClick={clearChat}>
                new session
              </button>
            )}
            <button
              className="clear-btn"
              onClick={() => setShowSettings(true)}
              aria-label="Settings"
            >
              me ⚙
            </button>
          </div>
        </header>

        {messages.length === 0 ? (
          <div className="empty">
            <div className="big-orb" />
            <h2>
              Hey, I&apos;m <em>Jarvis</em>.
            </h2>
            <p>
              Your personal AI agent — connected to your email, calendar, and
              notes. Ask me to check, draft, plan, or remember.
            </p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
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
              placeholder="Ask me anything…"
              onChange={autoGrow}
              onKeyDown={handleKeyDown}
              autoFocus
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
              <button
                className="clear-btn"
                onClick={() => setShowSettings(false)}
              >
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
                "e.g. I'm Janavi, a student at Columbia. I'm building my portfolio site and a startup idea. Keep answers short. My work email is …"
              }
              onChange={(e) => setProfile(e.target.value)}
              rows={6}
            />
            <div className="drawer-head" style={{ marginTop: 24 }}>
              <h3>Memories ({memories.length})</h3>
            </div>
            <p className="drawer-hint">
              Things Jarvis has learned about you. Say &quot;remember that…&quot;
              in chat to add more.
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
