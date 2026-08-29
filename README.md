# 🌌 Nebula Bot

Lightweight, modular **WhatsApp multi-device bot** with AI capabilities (Gemini), dynamic commands, group moderation, and an interactive **controller panel** (React + Express).

## ✨ Features

- **WhatsApp Multi-Device** via Baileys — QR pairing from the panel, automatic reconnect with bad-session recovery
- **126 built-in commands and 115 imported commands** — AI chat, image generation, media download, weather, dictionary, games (trivia, RPS, truth/dare), roasts, quotes, jokes, and more
- **Dynamic command registry** — commands are loaded from `src/bot/commands/*.ts` at startup; new commands can be saved or AI-generated from the panel and run **sandboxed** (no filesystem/process/network) without restarting
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
| `PANEL_TOKEN` | recommended | Panel access key. The panel UI asks for it once and exchanges it for a server-side HttpOnly session cookie (12h sliding); the key is never stored in the browser. Also accepted as a bearer token for scripts. If unset, a random key is generated and printed once to the console |
| `APP_URL` | optional | Public URL of the panel. When set, requests with a foreign `Host` header are rejected (host-header/rebinding guard) |
| `NEBULA_PANEL_COMMANDS` | optional | `on` (default) enables sandboxed panel-created commands; `off` disables the feature |
| `NEBULA_AI_DAILY_LIMIT` | optional | Per-sender daily AI request budget (default 40) |
| `NEBULA_AI_MAX_CONCURRENT` | optional | Global cap on concurrent AI requests (default 3) |
| `NEBULA_TEMP_MAX_BYTES` | optional | Storage ceiling for temp downloads (default 4 GiB) |
| `PORT` | optional | HTTP port (default 3000) |
| `NEBULA_DATA_DIR` | optional | Runtime state directory (config, access policies, panel commands, stats). Default `./database` |
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

- **Panel auth (C1/H5):** every `/api/*` endpoint requires a login. The access key is exchanged for a server-side HttpOnly session cookie; state-changing requests made with the cookie also require a matching `Origin`/`Referer` (CSRF). Bearer tokens work for tooling without CSRF checks.
- **Import command ACL (C2):** the import bridge enforces `ownerOnly` / `adminOnly` / `groupOnly` / `privateOnly` / `botAdminNeeded` metadata centrally, with a hard owner-only deny-list for dangerous commands (`update`, `restart`, `broadcast`, …).
- **Sandboxed panel commands (C4):** commands created in the panel are stored as data and executed in a `vm` sandbox with no `fs`/`process`/network/`child_process` access; dangerous imports are rejected at save time. Set `NEBULA_PANEL_COMMANDS=off` to disable.
- **SSRF (H2):** every user-supplied URL (downloads, video, novabox/ffmpeg) is validated per redirect hop with DNS pinning to the resolved IP, plus host allowlists for YouTube/VidMoly.
- **Resource caps (H3):** streamed downloads with byte caps + timeouts, temp-storage quotas, batch episode/size limits, media buffer cap, AI daily budget + concurrency cap.
- The ZIP export **never embeds your live API key** — it ships a placeholder `.env`.
- Simulator output is HTML-escaped before rendering (no XSS from AI/user content).
- Admin commands are restricted to group admins/owner; group policies can be managed per group with `/access` (RoleGuard).

## 🧩 Adding Commands

Create a file in `src/bot/commands/` exporting a `BotCommand` (see `ping.ts` for the minimal shape) — it is picked up automatically on startup. You can also create commands from the panel (**Command Customizer → AI Smart Command Creator**); those are sandboxed and stored as data, never written into the source tree. The panel **Security → RoleGuard** panel and the `/access` command let you set per-group allow/deny policies (owner-only).

## 📦 Local ZIP Export

Use **Export** in the panel: the ZIP contains the full bot runner (Baileys, all commands transpiled to CommonJS, shared runtime modules), a `config.json`, and instructions. `npm install && npm start` prints a QR code to pair your phone.
