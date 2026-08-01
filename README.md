# ✦ Jarvis — Your Personal AI Agent

A full-stack personal AI assistant with a streaming chat interface, powered by **Claude Opus 5** and built with **Next.js 15**.

![Stack](https://img.shields.io/badge/Next.js-15-black) ![React](https://img.shields.io/badge/React-19-61dafb) ![Claude](https://img.shields.io/badge/Claude-Opus%205-14b8a6)

## Features

- ⚡ **Real-time streaming** — responses appear token-by-token as Claude thinks
- 🧠 **Conversation memory** — chat history persists in your browser (localStorage)
- 🎨 **Aurora UI** — animated backdrop, glassmorphism panels, glowing status orb
- 📝 **Full markdown** — code blocks, tables, lists rendered beautifully
- 💾 **Prompt caching** — system prompt is cached server-side to cut cost & latency
- 🔒 **Key stays server-side** — your API key never touches the browser

## Architecture

```
Browser (React 19)
   │  POST /api/chat  { messages: [...] }
   ▼
Next.js Route Handler (Node runtime)
   │  @anthropic-ai/sdk  →  messages.stream()
   ▼
Claude API (claude-opus-5)
   │  text deltas streamed back
   ▼
Browser renders markdown live
```

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Add your API key

```bash
cp .env.example .env.local
```

Then edit `.env.local` and paste your Anthropic API key (get one at [platform.claude.com](https://platform.claude.com)).

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and say hi to Jarvis.

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo
3. Add the environment variable `ANTHROPIC_API_KEY` in project settings
4. Deploy — done 🎉

Or with the CLI:

```bash
npm i -g vercel
vercel
vercel env add ANTHROPIC_API_KEY
vercel --prod
```

## Project Structure

```
jarvis-agent/
├── app/
│   ├── api/chat/route.ts   # Backend: streaming Claude endpoint
│   ├── page.tsx            # Frontend: chat UI (client component)
│   ├── layout.tsx          # Root layout + fonts
│   └── globals.css         # Aurora theme
├── .env.example            # Environment template
└── package.json
```

## License

MIT
