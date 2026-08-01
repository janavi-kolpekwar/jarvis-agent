import Anthropic from "@anthropic-ai/sdk";
import {
  googleConfigured,
  searchEmail,
  readEmail,
  draftEmail,
  sendEmail,
  listEvents,
  createEvent,
} from "./google";

export function buildTools(): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [
    {
      name: "save_memory",
      description:
        "Save a durable fact about the user for future conversations — preferences, people, projects, recurring context. Use when the user shares something worth remembering or explicitly asks you to remember.",
      input_schema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The fact to remember, phrased as a standalone sentence.",
          },
        },
        required: ["content"],
      },
    },
  ];

  if (googleConfigured()) {
    tools.push(
      {
        name: "search_email",
        description:
          "Search the user's Gmail inbox. Call this whenever the user asks about their email, recent messages, or anything a sender may have emailed them. Uses Gmail search syntax (from:, subject:, newer_than:2d, is:unread, etc.).",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Gmail search query" },
            max_results: { type: "integer", description: "Default 10, max 25" },
          },
          required: ["query"],
        },
      },
      {
        name: "read_email",
        description:
          "Read the full body of a specific email by its id (from search_email results).",
        input_schema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Gmail message id" },
          },
          required: ["id"],
        },
      },
      {
        name: "draft_email",
        description:
          "Create a draft email in the user's Gmail drafts folder. Prefer this over send_email — it lets the user review before sending.",
        input_schema: {
          type: "object",
          properties: {
            to: { type: "string" },
            subject: { type: "string" },
            body: { type: "string" },
          },
          required: ["to", "subject", "body"],
        },
      },
      {
        name: "send_email",
        description:
          "Send an email immediately from the user's Gmail. ONLY call this after the user has explicitly confirmed the exact recipient, subject, and body in this conversation. If they have not confirmed, show them the draft text and ask first.",
        input_schema: {
          type: "object",
          properties: {
            to: { type: "string" },
            subject: { type: "string" },
            body: { type: "string" },
          },
          required: ["to", "subject", "body"],
        },
      },
      {
        name: "list_calendar_events",
        description:
          "List the user's upcoming Google Calendar events. Call this when the user asks about their schedule, availability, or what's coming up.",
        input_schema: {
          type: "object",
          properties: {
            days_ahead: {
              type: "integer",
              description: "How many days ahead to look. Default 7.",
            },
          },
        },
      },
      {
        name: "create_calendar_event",
        description:
          "Create an event on the user's primary Google Calendar. Confirm date, time, and title with the user if ambiguous.",
        input_schema: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Event title" },
            start: {
              type: "string",
              description: "Start time as ISO 8601 with timezone offset",
            },
            end: {
              type: "string",
              description: "End time as ISO 8601 with timezone offset",
            },
            description: { type: "string" },
          },
          required: ["summary", "start", "end"],
        },
      }
    );
  }

  return tools;
}

export type ToolOutcome = {
  content: string;
  is_error?: boolean;
  memory?: string; // set when a memory was saved, so the stream can notify the client
};

export async function executeTool(
  name: string,
  input: any
): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "save_memory":
        return {
          content: "Memory saved.",
          memory: String(input.content ?? ""),
        };
      case "search_email":
        return {
          content: await searchEmail(
            input.query,
            Math.min(input.max_results ?? 10, 25)
          ),
        };
      case "read_email":
        return { content: await readEmail(input.id) };
      case "draft_email":
        return { content: await draftEmail(input.to, input.subject, input.body) };
      case "send_email":
        return { content: await sendEmail(input.to, input.subject, input.body) };
      case "list_calendar_events":
        return { content: await listEvents(input.days_ahead ?? 7) };
      case "create_calendar_event":
        return {
          content: await createEvent(
            input.summary,
            input.start,
            input.end,
            input.description
          ),
        };
      default:
        return { content: `Unknown tool: ${name}`, is_error: true };
    }
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : "Tool execution failed",
      is_error: true,
    };
  }
}
