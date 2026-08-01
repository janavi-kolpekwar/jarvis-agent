// Minimal Google API client using the REST endpoints directly.
// Auth model: single-user app with a long-lived refresh token in env vars.
// Run `npm run google:auth` once to obtain GOOGLE_REFRESH_TOKEN.

let cachedToken: { token: string; expiresAt: number } | null = null;

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN
  );
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${await res.text()}`);
  }
  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

async function gfetch(url: string, init?: RequestInit): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Google API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ---------- Gmail ----------

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf-8"
  );
}

function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractBody(part);
      if (text) return text;
    }
  }
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

function header(msg: any, name: string): string {
  return (
    msg.payload?.headers?.find(
      (h: any) => h.name.toLowerCase() === name.toLowerCase()
    )?.value ?? ""
  );
}

export async function searchEmail(query: string, maxResults = 10) {
  const list = await gfetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(
      query
    )}&maxResults=${maxResults}`
  );
  if (!list.messages?.length) return "No emails matched that search.";

  const results = await Promise.all(
    list.messages.map(async (m: { id: string }) => {
      const msg = await gfetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
      );
      return {
        id: m.id,
        from: header(msg, "From"),
        subject: header(msg, "Subject"),
        date: header(msg, "Date"),
        snippet: msg.snippet,
      };
    })
  );
  return JSON.stringify(results, null, 2);
}

export async function readEmail(id: string) {
  const msg = await gfetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`
  );
  const body = extractBody(msg.payload).slice(0, 6000);
  return JSON.stringify(
    {
      from: header(msg, "From"),
      to: header(msg, "To"),
      subject: header(msg, "Subject"),
      date: header(msg, "Date"),
      body: body || msg.snippet,
    },
    null,
    2
  );
}

function buildRawEmail(to: string, subject: string, body: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function draftEmail(to: string, subject: string, body: string) {
  const draft = await gfetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    {
      method: "POST",
      body: JSON.stringify({ message: { raw: buildRawEmail(to, subject, body) } }),
    }
  );
  return `Draft created (id: ${draft.id}). It's in the user's Gmail drafts folder.`;
}

export async function sendEmail(to: string, subject: string, body: string) {
  const sent = await gfetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      body: JSON.stringify({ raw: buildRawEmail(to, subject, body) }),
    }
  );
  return `Email sent to ${to} (id: ${sent.id}).`;
}

// ---------- Calendar ----------

export async function listEvents(daysAhead = 7) {
  const now = new Date();
  const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const data = await gfetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=40`
  );
  if (!data.items?.length) return "No upcoming events in that window.";
  const events = data.items.map((e: any) => ({
    summary: e.summary,
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    location: e.location,
    attendees: e.attendees?.map((a: any) => a.email),
  }));
  return JSON.stringify(events, null, 2);
}

export async function createEvent(
  summary: string,
  startIso: string,
  endIso: string,
  description?: string
) {
  const event = await gfetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      body: JSON.stringify({
        summary,
        description,
        start: { dateTime: startIso },
        end: { dateTime: endIso },
      }),
    }
  );
  return `Event created: "${event.summary}" — ${event.htmlLink}`;
}
