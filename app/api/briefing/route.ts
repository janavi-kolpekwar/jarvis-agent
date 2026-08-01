import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { buildTools, executeTool } from "@/lib/tools";
import { googleConfigured } from "@/lib/google";

export const runtime = "nodejs";
export const maxDuration = 300;

const CARD_SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          icon: { type: "string", description: "A single emoji" },
          title: { type: "string", description: "Short punchy headline, max 6 words" },
          body: {
            type: "string",
            description: "One or two sentences: the insight, tip, or recommendation",
          },
          action: {
            type: "string",
            description:
              "A prompt Jarvis should run if the user taps this card, phrased as the user speaking, e.g. 'Draft a reply to the wellness center booking the follow-up'",
          },
          tone: { type: "string", enum: ["tip", "alert", "info", "fun"] },
        },
        required: ["icon", "title", "body", "action", "tone"],
        additionalProperties: false,
      },
    },
  },
  required: ["cards"],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
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

  let profile = "";
  let memories: string[] = [];
  let timezone = "America/New_York";
  try {
    const body = await req.json();
    profile = typeof body.profile === "string" ? body.profile.slice(0, 4000) : "";
    memories = Array.isArray(body.memories) ? body.memories.slice(0, 100) : [];
    if (typeof body.timezone === "string") timezone = body.timezone;
  } catch {
    // defaults are fine
  }

  const google = googleConfigured();
  const client = new Anthropic();
  const tools = buildTools();

  const system = `You are Jarvis, the user's personal AI agent, generating their dashboard briefing.

${google ? "Gmail and Google Calendar are connected. FIRST gather context: check the next 3 days of calendar events and search recent email (e.g. newer_than:2d, and is:unread). THEN produce cards." : "Google is not connected, so produce cards based on the user's profile and memories, plus one card suggesting they connect Google."}

Produce 3 to 6 dashboard cards. Good cards are specific and actionable:
- A tip or prep suggestion for an upcoming calendar event
- An email that deserves a reply, with an offer to draft it
- A conflict, deadline, or gap you noticed
- Something personal drawn from their profile/memories (tone "fun")
Never invent events or emails. If calendar/inbox are quiet, say so in a light-hearted card.

User timezone: ${timezone}. Today is ${new Date().toLocaleString("en-US", { timeZone: timezone, dateStyle: "full" })}.
${profile ? `\n## About the user\n${profile}` : ""}
${memories.length ? `\n## Memories\n${memories.map((m) => `- ${m}`).join("\n")}` : ""}`;

  const convo: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        "Generate my dashboard briefing cards now. Gather what you need first.",
    },
  ];

  try {
    for (let turn = 0; turn < 8; turn++) {
      const response = await client.messages.create({
        model: "claude-opus-5",
        max_tokens: 8000,
        system,
        messages: convo,
        tools,
        output_config: {
          format: { type: "json_schema", schema: CARD_SCHEMA as any },
        },
      });

      if (response.stop_reason === "tool_use") {
        convo.push({ role: "assistant", content: response.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          const outcome = await executeTool(block.name, block.input);
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

      if (response.stop_reason === "pause_turn") {
        convo.push({ role: "assistant", content: response.content });
        continue;
      }

      const text = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === "text"
      )?.text;
      if (!text) break;
      const parsed = JSON.parse(text);
      return new Response(JSON.stringify(parsed), {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error("Briefing did not complete");
  } catch (error) {
    const message =
      error instanceof Anthropic.APIError
        ? `API error (${error.status})`
        : "Briefing failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
