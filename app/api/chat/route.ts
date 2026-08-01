import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { buildTools, executeTool } from "@/lib/tools";
import { googleConfigured } from "@/lib/google";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_AGENT_TURNS = 10;

function basePrompt(): string {
  const google = googleConfigured();
  const pocket = Boolean(process.env.POCKET_MCP_URL);
  return `You are Jarvis, the user's personal AI agent — sharp, warm, and genuinely useful.

Personality:
- You are the user's trusted right hand: proactive, direct, and resourceful.
- Keep responses focused and concise. Lead with the answer; skip filler.
- Use markdown when it improves clarity, plain prose otherwise.

Connected capabilities:
- ${google ? "Gmail and Google Calendar are CONNECTED — use the email and calendar tools whenever the user's request involves their mail or schedule. Don't answer from memory when a tool can check reality." : "Gmail and Google Calendar are NOT yet connected. If the user asks about email or calendar, explain they need to run `npm run google:auth` (see the README) to connect Google."}
- ${pocket ? "The user's Pocket AI notes are CONNECTED via MCP — search them when the user references their notes, meetings, or action items." : "Pocket notes are not yet connected."}
- save_memory: persist important facts about the user.

Rules:
- Never send an email without the user explicitly confirming recipient, subject, and body in this conversation. Prefer draft_email.
- When you use tools, briefly say what you found — don't dump raw JSON at the user.
- Today's date is ${new Date().toDateString()}. Infer the user's timezone from context or ask.`;
}

type StreamEvent =
  | { t: "text"; d: string }
  | { t: "tool"; name: string }
  | { t: "mem"; d: string }
  | { t: "err"; d: string }
  | { t: "done" };

export async function POST(req: NextRequest) {
  // ---- passcode gate ----
  const passcode = process.env.JARVIS_PASSCODE;
  if (passcode && req.headers.get("x-jarvis-key") !== passcode) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Missing ANTHROPIC_API_KEY on the server." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let messages: Anthropic.MessageParam[];
  let profile = "";
  let memories: string[] = [];
  try {
    const body = await req.json();
    messages = body.messages;
    profile = typeof body.profile === "string" ? body.profile.slice(0, 4000) : "";
    memories = Array.isArray(body.memories) ? body.memories.slice(0, 100) : [];
    if (!Array.isArray(messages) || messages.length === 0) throw new Error();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new Anthropic();
  const tools = buildTools();

  // Pocket (or any) MCP server via the Claude API MCP connector
  const pocketUrl = process.env.POCKET_MCP_URL;
  const pocketToken = process.env.POCKET_MCP_TOKEN;
  const mcpServers = pocketUrl
    ? [
        {
          type: "url" as const,
          url: pocketUrl,
          name: "pocket",
          ...(pocketToken ? { authorization_token: pocketToken } : {}),
        },
      ]
    : undefined;

  const personalContext =
    (profile ? `## About the user\n${profile}\n\n` : "") +
    (memories.length
      ? `## Saved memories\n${memories.map((m) => `- ${m}`).join("\n")}`
      : "");

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: basePrompt(), cache_control: { type: "ephemeral" } },
  ];
  if (personalContext) {
    system.push({ type: "text", text: personalContext });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: StreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));

      const convo: Anthropic.MessageParam[] = [...messages];

      try {
        for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
          const requestParams: any = {
            model: "claude-opus-5",
            max_tokens: 16000,
            system,
            messages: convo,
            tools: [
              ...tools,
              ...(mcpServers
                ? [{ type: "mcp_toolset", mcp_server_name: "pocket" }]
                : []),
            ],
          };
          if (mcpServers) {
            requestParams.mcp_servers = mcpServers;
            requestParams.betas = ["mcp-client-2025-11-20"];
          }

          const stream: any = mcpServers
            ? client.beta.messages.stream(requestParams)
            : client.messages.stream(requestParams);

          stream.on("streamEvent", (event: any) => {
            if (
              event.type === "content_block_start" &&
              (event.content_block?.type === "tool_use" ||
                event.content_block?.type === "mcp_tool_use")
            ) {
              emit({ t: "tool", name: event.content_block.name });
            }
          });
          stream.on("text", (delta: string) => emit({ t: "text", d: delta }));

          const final: any = await stream.finalMessage();

          if (final.stop_reason === "tool_use") {
            convo.push({ role: "assistant", content: final.content });
            const results: Anthropic.ToolResultBlockParam[] = [];
            for (const block of final.content) {
              if (block.type !== "tool_use") continue;
              const outcome = await executeTool(block.name, block.input);
              if (outcome.memory) emit({ t: "mem", d: outcome.memory });
              results.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: outcome.content,
                ...(outcome.is_error ? { is_error: true } : {}),
              });
            }
            convo.push({ role: "user", content: results });
            continue;
          }

          if (final.stop_reason === "pause_turn") {
            convo.push({ role: "assistant", content: final.content });
            continue;
          }

          if (final.stop_reason === "refusal") {
            emit({ t: "text", d: "\n\n_I can't help with that request._" });
          }
          break;
        }
      } catch (error) {
        let message = "Something went wrong talking to Claude.";
        if (error instanceof Anthropic.AuthenticationError) {
          message = "Invalid Anthropic API key on the server.";
        } else if (error instanceof Anthropic.RateLimitError) {
          message = "Rate limited — give it a moment and try again.";
        } else if (error instanceof Anthropic.APIError) {
          message = `API error (${error.status}): ${error.message}`;
        }
        emit({ t: "err", d: message });
      }

      emit({ t: "done" });
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
