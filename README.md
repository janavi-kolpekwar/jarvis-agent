# ✦ Jarvis — Your Personal AI Agent

A full-stack **personal** AI agent — not just a chat UI. Jarvis connects to your Gmail, Google Calendar, and Pocket AI notes, remembers things about you, and is installable on your phone. Powered by **Claude Opus 5** + **Next.js 15**.

![Stack](https://img.shields.io/badge/Next.js-15-black) ![React](https://img.shields.io/badge/React-19-61dafb) ![Claude](https://img.shields.io/badge/Claude-Opus%205-14b8a6)

## What Jarvis can do

- 📧 **Email** — search your inbox, read messages, draft replies (drafts land in Gmail), and send after you confirm
- 📅 **Calendar** — check your schedule, find free time, create events
- 📝 **Pocket notes** — search your Pocket AI conversations & action items (via MCP)
- 🧠 **Memory** — an "About you" profile plus memories it saves as you chat ("remember that…")
- ⚡ **Agent loop** — Claude decides which tools to use, executes them server-side, and streams the answer with live tool-activity indicators
- 🔒 **Passcode gate** — locks the app so only you can use it
- 📱 **PWA** — install it on your phone's home screen; use Jarvis anywhere

## Setup

### 1. Basics

```bash
npm install
cp .env.example .env.local   # then fill in ANTHROPIC_API_KEY
npm run dev
```

Jarvis works immediately as a chat assistant. The steps below unlock the personal integrations.

### 2. Set a passcode

Add any secret string to `.env.local`:

```
JARVIS_PASSCODE=your-secret-here
```

Do this **before** connecting Google if you plan to deploy.

### 3. Connect Google (Gmail + Calendar)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project (e.g. "jarvis")
2. **APIs & Services → Library** → enable **Gmail API** and **Google Calendar API**
3. **OAuth consent screen** → External → add yourself as a test user
4. **Credentials → Create credentials → OAuth client ID → Web application** → add authorized redirect URI: `http://localhost:53682/callback`
5. Copy the client ID + secret into `.env.local` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
6. Run:

```bash
npm run google:auth
```

A browser opens; approve access; the refresh token is saved to `.env.local` automatically. Restart the dev server and ask Jarvis *"what's in my inbox?"*

### 4. Connect Pocket notes (optional)

If your Pocket AI account exposes an MCP server (check Pocket's settings → integrations), add:

```
POCKET_MCP_URL=https://…
POCKET_MCP_TOKEN=…
```

Jarvis will search your notes and action items natively via the Claude API's MCP connector.

### 5. Deploy (use it anywhere)

1. Push to GitHub, import the repo at [vercel.com/new](https://vercel.com/new)
2. Add **all** the env vars from your `.env.local` in Vercel's project settings
3. Deploy, open the URL on your phone → **Share → Add to Home Screen** — Jarvis installs like a native app

## Architecture

```
Browser (React 19, PWA)
   │  POST /api/chat  { messages, profile, memories }  + passcode header
   ▼
Next.js Route Handler — agent loop
   │  Claude decides → tool_use
   ├── Gmail REST API        (search / read / draft / send)
   ├── Calendar REST API     (list / create events)
   ├── Pocket MCP server     (executed by Anthropic, server-side)
   └── save_memory           (streamed back → stored client-side)
   ▼
NDJSON stream → live markdown + tool activity chips
```

**Security model:** your Anthropic key and Google tokens live only in server env vars. The browser holds just your passcode and your local conversation/profile/memories. Email sending requires explicit in-chat confirmation.

## Project Structure

```
jarvis-agent/
├── app/
│   ├── api/chat/route.ts   # Agent loop: streaming + tools + auth
│   ├── page.tsx            # Chat UI, passcode gate, settings drawer
│   ├── layout.tsx          # Fonts, PWA metadata
│   ├── manifest.ts         # PWA manifest
│   └── globals.css         # Aurora theme
├── lib/
│   ├── google.ts           # Gmail + Calendar REST client
│   └── tools.ts            # Tool definitions & executor
├── scripts/
│   ├── google-auth.mjs     # One-time OAuth (npm run google:auth)
│   └── gen-icons.mjs       # PWA icon generator (npm run icons)
└── public/                 # PWA icons
```

## License

MIT
