import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are Jarvis, a personal AI agent — sharp, warm, and genuinely useful.

Personality:
- You are the user's trusted right hand: proactive, direct, and resourceful.
- Keep responses focused and concise. Skip filler and disclaimers; lead with the answer.
- Use markdown when it improves clarity (lists, code blocks, tables), plain prose otherwise.
- When a request is ambiguous, make the reasonable call and note your assumption in one line.

Capabilities:
- Help plan, write, code, analyze, brainstorm, and organize.
- Break big goals into concrete next steps.
- When asked to remember something, acknowledge it — the app persists the conversation locally.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          "Missing ANTHROPIC_API_KEY. Copy .env.example to .env.local and add your key.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let messages: Anthropic.MessageParam[];
  try {
    const body = await req.json();
    messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages must be a non-empty array");
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new Anthropic({ apiKey });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: "claude-opus-5",
          max_tokens: 16000,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages,
        });

        stream.on("text", (delta) => {
          controller.enqueue(encoder.encode(delta));
        });

        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(
            encoder.encode(
              "\n\n_I can't help with that request._"
            )
          );
        }
        controller.close();
      } catch (error) {
        let message = "Something went wrong talking to Claude.";
        if (error instanceof Anthropic.AuthenticationError) {
          message = "Invalid API key — check your .env.local file.";
        } else if (error instanceof Anthropic.RateLimitError) {
          message = "Rate limited — give it a moment and try again.";
        } else if (error instanceof Anthropic.APIError) {
          message = `API error (${error.status}): ${error.message}`;
        }
        controller.enqueue(encoder.encode(`\n\n⚠️ ${message}`));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
