# 🌌 Nebula Bot

Lightweight, modular **WhatsApp multi-device bot** with AI capabilities (Gemini), dynamic commands, group moderation, and an interactive **controller panel** (React + Express).

## ✨ Features

- **WhatsApp Multi-Device** via Baileys — QR pairing from the panel, automatic reconnect with bad-session recovery
- **21+ built-in commands** — AI chat, image generation, media download, weather, dictionary, games (trivia, RPS, truth/dare), roasts, quotes, jokes, and more
- **Dynamic command registry** — commands are loaded from `src/bot/commands/*.ts` at startup; new commands can be saved or AI-generated from the panel and hot-loaded without restarting
- **Group moderation** — antilink (delete/kick), antitag (mass-mention protection), welcome/goodbye messages, hidetag broadcasts (admin-gated)
- **Gemini AI playground** — audio transcription and voice conversation with TTS
- **Secrets manager** — set your `GEMINI_API_KEY` right from the panel (saved to the server's `.env`, applied immediately, masked display only)
- **Simulation playground** — test any command in the browser before touching WhatsApp
- **ZIP export** — download a self-contained Node package to run the bot locally

## 🚀 Quick Start

```bash
npm install
npm run dev        # controller panel at http://localhost:3000
```

Requirements: **Node.js 18+** (npm is the canonical package manager).

## 🔑 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | for AI features | Google Gemini API key (AI Studio injects it via Secrets) |
| `PANEL_TOKEN` | optional | Protects all `/api/*` endpoints. If unset, a random token is generated at startup and handed to the panel as an HttpOnly cookie (printed once to the console) |
| `APP_URL` | optional | Public URL of this applet |
| `PORT` | optional | HTTP port (default 3000) |
| `NEBULA_DATA_DIR` | optional | Runtime state directory (config, group settings, stats). Default `./database` |
| `NEBULA_ENV_FILE` | optional | Path of the env file the Secrets UI writes to. Default `./.env` |

Copy `.env.example` to `.env` and fill in your values.

## 🔑 Managing Secrets From the Panel

Open **Settings & Access → API Secrets** in the dashboard:

- Paste your `GEMINI_API_KEY` and press **Save Secret** — it is written to the server's `.env` file (preserving all other lines, atomic write) and applied to the running process immediately, no restart needed.
- The panel only ever shows a **masked** status (e.g. `••••••••••••abcd`); the raw value never leaves the server.
- Press the trash icon to remove the key (also cleans the `.env` file).
- Only allowlisted variables (`GEMINI_API_KEY`) can be set — arbitrary env-var writes from the web UI are rejected for security.

## 🧪 Tests

```bash
npm test           # vitest (API, registry, SSRF guard)
npm run lint       # strict TypeScript typecheck
npm run build      # production build (client + server)
npm start          # serve the production build
```

Tests run against an isolated temp data directory and never touch real WhatsApp sessions or the Gemini API.

## 🏗 Architecture

```
server.ts (entry) ── createApp() (app.ts: auth, rate limiting, /api routes)
      │
      ├── src/bot/botEngine.ts        Baileys socket, QR, reconnect, moderation,
      │                               welcome/goodbye, message routing
      ├── src/bot/commandRegistry.ts  static built-ins + disk-loaded commands
      ├── src/bot/commands/*.ts       individual commands (BotCommand interface)
      ├── src/bot/geminiClient.ts     Gemini text/image with fallback chains
      ├── src/bot/database.ts         JSON-file group settings (groups.json)
      ├── src/bot/config.ts           persisted bot configuration (config.json)
      ├── src/bot/commandStats.ts     persisted usage analytics (stats.json)
      └── src/bot/urlSafety.ts        SSRF guard for user-supplied URLs
```

**Data flow:** WhatsApp message → engine unwraps/decorates it → moderation filters → command lookup (registry) → command executes with a rich context (`reply`, `react`, `downloadMedia`, `isOwner`, `isAdmin`).

## 🔒 Security Notes

- Every `/api/*` endpoint requires the panel token (cookie for the panel UI, `Authorization: Bearer <token>` for tools).
- Rate limiting protects the Gemini and command-generation endpoints.
- The ZIP export **never embeds your live API key** — it ships a placeholder `.env`.
- User-supplied download URLs are validated against private/loopback/link-local networks (SSRF guard) before any fetch.
- Simulator output is HTML-escaped before rendering (no XSS from AI/user content).
- Admin commands (`antilink`, `antitag`, `hidetag`) are restricted to group admins/owner.

## 🧩 Adding Commands

Create a file in `src/bot/commands/` exporting a `BotCommand` (see `ping.ts` for the minimal shape) — it is picked up automatically on startup. You can also create commands from the panel (**Command Customizer → AI Smart Command Creator**), which saves and hot-loads them.

## 📦 Local ZIP Export

Use **Export** in the panel: the ZIP contains the full bot runner (Baileys, all commands transpiled to CommonJS, shared runtime modules), a `config.json`, and instructions. `npm install && npm start` prints a QR code to pair your phone.
