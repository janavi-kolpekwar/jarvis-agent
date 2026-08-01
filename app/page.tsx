"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const STORAGE_KEY = "jarvis-conversation";

const SUGGESTIONS = [
  "Plan my week around three big goals",
  "Explain a concept like I'm smart but busy",
  "Help me debug some code",
  "Brainstorm names for a side project",
];

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Restore conversation from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      // corrupted storage — start fresh
    }
    setHydrated(true);
  }, []);

  // Persist conversation
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // storage full — non-fatal
    }
  }, [messages, hydrated]);

  // Auto-scroll on new content
  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

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

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? `Request failed (${res.status})`);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let acc = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          const snapshot = acc;
          setMessages([
            ...history,
            { role: "assistant", content: snapshot },
          ]);
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
        textareaRef.current?.focus();
      }
    },
    [messages, streaming]
  );

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
      <main className="shell">
        <header className="topbar">
          <div className="brand">
            <div className={`orb ${streaming ? "thinking" : ""}`} />
            <div>
              <h1>JARVIS</h1>
              <div className="status">
                {streaming ? "thinking…" : "online · claude opus 5"}
              </div>
            </div>
          </div>
          {messages.length > 0 && (
            <button className="clear-btn" onClick={clearChat}>
              new session
            </button>
          )}
        </header>

        {messages.length === 0 ? (
          <div className="empty">
            <div className="big-orb" />
            <h2>
              Hey, I&apos;m <em>Jarvis</em>.
            </h2>
            <p>
              Your personal AI agent — here to plan, write, code, and think
              alongside you. Everything stays in your browser.
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
    </>
  );
}
