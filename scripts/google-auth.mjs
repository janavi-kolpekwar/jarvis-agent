#!/usr/bin/env node
// One-time Google OAuth helper.
// Prereq: a Google Cloud OAuth client (Web application) with redirect URI
// http://localhost:53682/callback, and GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
// already present in .env.local. See README → "Connect Google".

import { createServer } from "node:http";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const ENV_PATH = new URL("../.env.local", import.meta.url).pathname;

function readEnv(key) {
  if (!existsSync(ENV_PATH)) return undefined;
  const match = readFileSync(ENV_PATH, "utf8").match(
    new RegExp(`^${key}=(.*)$`, "m")
  );
  return match?.[1]?.trim();
}

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? readEnv("GOOGLE_CLIENT_ID");
const CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET ?? readEnv("GOOGLE_CLIENT_SECRET");

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "\n✗ Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local first.\n" +
      "  Create them at https://console.cloud.google.com/apis/credentials\n" +
      "  (OAuth client ID → Web application → redirect URI http://localhost:53682/callback)\n"
  );
  process.exit(1);
}

const REDIRECT = "http://localhost:53682/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
].join(" ");

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:53682");
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("Missing code");
    return;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();

  if (!tokens.refresh_token) {
    res.end("No refresh token returned — check the terminal.");
    console.error("\n✗ Google did not return a refresh token:", tokens);
    process.exit(1);
  }

  appendFileSync(ENV_PATH, `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  res.end(
    "✓ Google connected! Refresh token saved to .env.local. You can close this tab."
  );
  console.log(
    "\n✓ GOOGLE_REFRESH_TOKEN saved to .env.local." +
      "\n  Restart the dev server, and add the same three GOOGLE_* vars to Vercel for production.\n"
  );
  setTimeout(() => process.exit(0), 200);
});

server.listen(53682, () => {
  console.log("\nOpening Google consent screen…\n" + authUrl + "\n");
  try {
    execSync(`open "${authUrl}"`);
  } catch {
    console.log("(Open the URL above manually.)");
  }
});
