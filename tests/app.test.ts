import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import type { Express } from "express";

let app: Express;
let commandsDir: string;
let dataDir: string;

beforeAll(async () => {
  commandsDir = process.env.NEBULA_COMMANDS_DIR!;
  dataDir = process.env.NEBULA_DATA_DIR!;

  const { createApp } = await import("../app.js");
  const { initRegistry } = await import("../src/bot/commandRegistry.js");
  await initRegistry();
  app = createApp();
});

afterAll(() => {
  // Cleanup the temp commands/data directories
  try {
    fs.rmSync(commandsDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

const auth = { Authorization: "Bearer test-panel-token" };

describe("Panel authentication", () => {
  it("rejects API requests without a token", async () => {
    const res = await request(app).get("/api/bot/status");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("PANEL_TOKEN");
  });

  it("rejects API requests with a wrong token", async () => {
    const res = await request(app).get("/api/bot/status").set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("accepts API requests with a valid bearer token", async () => {
    const res = await request(app).get("/api/bot/status").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
  });

  it("hands the panel an HttpOnly cookie on page loads", async () => {
    const res = await request(app).get("/");
    const raw = res.headers["set-cookie"];
    const cookies = Array.isArray(raw) ? raw : [raw];
    const cookie = cookies.find((c) => typeof c === "string" && c.startsWith("panel_token="));
    expect(cookie).toBeDefined();
    expect(cookie).toContain("HttpOnly");
  });
});

describe("Simulation playground", () => {
  it("runs .ping successfully", async () => {
    const res = await request(app)
      .post("/api/bot/simulate")
      .set(auth)
      .send({ senderName: "Tester", text: ".ping" });
    expect(res.status).toBe(200);
    expect(res.body.text).toContain("Nebula Bot - Status");
  });

  it("runs .roast me without crashing (mock sock)", async () => {
    const res = await request(app)
      .post("/api/bot/simulate")
      .set(auth)
      .send({ senderName: "Tester", text: ".roast me" });
    expect(res.status).toBe(200);
    expect(res.body.text).toContain("Nebula Roast");
  });

  it("runs .menu with the command directory", async () => {
    const res = await request(app)
      .post("/api/bot/simulate")
      .set(auth)
      .send({ senderName: "Tester", text: ".menu" });
    expect(res.status).toBe(200);
    expect(res.body.text).toContain("SERVICES");
    expect(res.body.text).toContain("Powered by Nebula Engine");
  });

  it("reports unknown commands gracefully", async () => {
    const res = await request(app)
      .post("/api/bot/simulate")
      .set(auth)
      .send({ senderName: "Tester", text: ".doesnotexist" });
    expect(res.status).toBe(200);
    expect(res.body.text).toContain("not found");
  });

  it("rejects messages without text and oversized text", async () => {
    const missing = await request(app).post("/api/bot/simulate").set(auth).send({ senderName: "T" });
    expect(missing.status).toBe(400);

    const oversized = await request(app)
      .post("/api/bot/simulate")
      .set(auth)
      .send({ senderName: "T", text: "x".repeat(2001) });
    expect(oversized.status).toBe(400);
  });
});

describe("Command registry", () => {
  it("lists unique commands (no alias duplicates)", async () => {
    const res = await request(app).get("/api/bot/commands").set(auth);
    expect(res.status).toBe(200);
    const names = res.body.map((c: { name: string }) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("ping");
    expect(names).toContain("help");
  });

  it("saves a command to disk and hot-loads it into the registry", async () => {
    // Self-contained command (no relative imports) so it loads from the temp dir.
    const code = `const cmd = {
  name: "hellocmd",
  category: "Test",
  description: "Test command saved via API",
  usage: "hellocmd",
  execute: async (_sock, _msg, context) => {
    await context.reply("Hello from disk!");
  }
};

export default cmd;
`;
    const save = await request(app)
      .post("/api/bot/commands/save")
      .set(auth)
      .send({ name: "hello_cmd", code });
    expect(save.status).toBe(200);
    expect(save.body.loaded).toBe(true);

    const filePath = path.join(commandsDir, "hellocmd.ts");
    expect(fs.existsSync(filePath)).toBe(true);

    const list = await request(app).get("/api/bot/commands").set(auth);
    expect(list.body.some((c: { name: string }) => c.name === "hellocmd")).toBe(true);

    const sim = await request(app)
      .post("/api/bot/simulate")
      .set(auth)
      .send({ senderName: "Tester", text: ".hellocmd" });
    expect(sim.status).toBe(200);
    expect(sim.body.text).toContain("Hello from disk!");
  });

  it("rejects empty or invalid command names", async () => {
    const res = await request(app)
      .post("/api/bot/commands/save")
      .set(auth)
      .send({ name: "!!!", code: "export default {};" });
    expect(res.status).toBe(400);
  });
});

describe("Config persistence", () => {
  it("persists config updates to disk", async () => {
    const res = await request(app)
      .post("/api/bot/config")
      .set(auth)
      .send({ botName: "TestBot", prefix: "!" });
    expect(res.status).toBe(200);
    expect(res.body.botName).toBe("TestBot");

    const configFile = path.join(dataDir, "config.json");
    expect(fs.existsSync(configFile)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    expect(onDisk.botName).toBe("TestBot");

    const get = await request(app).get("/api/bot/config").set(auth);
    expect(get.body.prefix).toBe("!");
  });

  it("rejects invalid config values", async () => {
    const res = await request(app)
      .post("/api/bot/config")
      .set(auth)
      .send({ prefix: "toolong" });
    expect(res.status).toBe(400);
  });
});

describe("ZIP export", () => {
  it("packages a runnable bot without leaking the API key", async () => {
    // A command that imports a shared runtime module (like ai.ts does)
    const aiLike = `import { generateTextWithFallback } from "../geminiClient.js";
import { BotCommand } from "../types.js";

const zipai: BotCommand = {
  name: "zipai",
  category: "Test",
  description: "ZIP test command",
  execute: async (_sock, _msg, context) => {
    await generateTextWithFallback("hello").catch(() => {});
    await context.reply("ok");
  }
};

export default zipai;
`;
    fs.writeFileSync(path.join(commandsDir, "zipai.ts"), aiLike, "utf-8");

    const res = await request(app).get("/api/bot/download-zip").set(auth).responseType("arraybuffer");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/zip");

    const zip = new AdmZip(res.body as Buffer);
    const names = zip.getEntries().map((e) => e.entryName);

    // Core files
    expect(names).toContain("index.js");
    expect(names).toContain("package.json");
    expect(names).toContain("config.json");
    expect(names).toContain("commands/zipai.js");

    // Shared runtime modules must be packaged so AI/admin commands work
    expect(names).toContain("geminiClient.js");
    expect(names).toContain("database.js");

    // The .env must contain a placeholder, never the live key
    const envContent = zip.readAsText(".env");
    expect(envContent).toContain("MY_GEMINI_API_KEY");
    expect(envContent).not.toContain("test-gemini-key");

    // Transpiled commands must reference the packaged modules, not missing types
    const zipaiJs = zip.readAsText("commands/zipai.js");
    expect(zipaiJs).toContain("geminiClient");
    expect(zipaiJs).not.toContain("types.js");
  });
});

describe("Gemini endpoints", () => {
  it("rejects unsupported audio mime types before calling the API", async () => {
    const res = await request(app)
      .post("/api/gemini/transcribe")
      .set(auth)
      .send({ audioBase64: "AAAA", mimeType: "video/mp4" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("mime");
  });

  it("rejects oversized audio payloads (413)", async () => {
    const huge = "A".repeat(26 * 1024 * 1024); // > 25mb body limit
    const res = await request(app)
      .post("/api/gemini/transcribe")
      .set(auth)
      .send({ audioBase64: huge, mimeType: "audio/webm" });
    expect(res.status).toBe(413);
  });

  it("rejects missing prompts for voice conversation", async () => {
    const res = await request(app).post("/api/gemini/voice-conversation").set(auth).send({});
    expect(res.status).toBe(400);
  });
});

describe("Project archive download", () => {
  it("serves the project zip when present, else a clean 404", async () => {
    const res = await request(app).get("/nebula-bot-latest.zip").set(auth);
    if (res.status === 200) {
      expect(res.headers["content-type"]).toContain("application/zip");
    } else {
      expect(res.status).toBe(404);
    }
  });
});

describe("Rate limiting", () => {
  it("limits rapid simulate calls with 429", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await request(app)
        .post("/api/bot/simulate")
        .set(auth)
        .send({ senderName: "Spammer", text: ".ping" });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("Secrets management", () => {
  it("lists secret status without exposing the raw value", async () => {
    const res = await request(app).get("/api/bot/secrets").set(auth);
    expect(res.status).toBe(200);
    const gemini = res.body.secrets.find((s: { name: string }) => s.name === "GEMINI_API_KEY");
    expect(gemini).toBeDefined();
    expect(gemini.configured).toBe(true); // test env sets a key
    expect(gemini.masked).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain("test-gemini-key");
  });

  it("rejects placeholder values", async () => {
    const res = await request(app)
      .post("/api/bot/secrets")
      .set(auth)
      .send({ name: "GEMINI_API_KEY", value: "MY_GEMINI_API_KEY" });
    expect(res.status).toBe(400);
  });

  it("rejects unsupported secret names (allowlist enforced)", async () => {
    const res = await request(app)
      .post("/api/bot/secrets")
      .set(auth)
      .send({ name: "AWS_SECRET_ACCESS_KEY", value: "x" });
    expect(res.status).toBe(400);
  });

  it("saves a secret to the .env file and applies it immediately", async () => {
    const envFile = path.join(dataDir, ".env");
    const value = "sk-test-12345-secretvalue";

    const res = await request(app)
      .post("/api/bot/secrets")
      .set(auth)
      .send({ name: "GEMINI_API_KEY", value });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.fileSaved).toBe(true);
    expect(res.body.masked).toContain(value.slice(-4));

    // Persisted to the .env file
    expect(fs.existsSync(envFile)).toBe(true);
    const content = fs.readFileSync(envFile, "utf-8");
    expect(content).toContain(`GEMINI_API_KEY=${value}`);

    // Applied to the running process — no restart needed
    expect(process.env.GEMINI_API_KEY).toBe(value);

    // Status endpoint reflects it, still masked
    const status = await request(app).get("/api/bot/secrets").set(auth);
    const gemini = status.body.secrets.find((s: { name: string }) => s.name === "GEMINI_API_KEY");
    expect(gemini.configured).toBe(true);
    expect(JSON.stringify(status.body)).not.toContain(value);
  });

  it("preserves unrelated lines in the .env file", async () => {
    const envFile = path.join(dataDir, ".env");
    fs.writeFileSync(envFile, "APP_URL=\"https://example.com\"\n# a comment\n", "utf-8");

    await request(app)
      .post("/api/bot/secrets")
      .set(auth)
      .send({ name: "GEMINI_API_KEY", value: "another-key-99" });

    const content = fs.readFileSync(envFile, "utf-8");
    expect(content).toContain('APP_URL="https://example.com"');
    expect(content).toContain("# a comment");
    expect(content).toContain("GEMINI_API_KEY=another-key-99");
  });

  it("removes a secret and cleans the .env file", async () => {
    const res = await request(app)
      .delete("/api/bot/secrets")
      .set(auth)
      .send({ name: "GEMINI_API_KEY" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const envFile = path.join(dataDir, ".env");
    const content = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf-8") : "";
    expect(content).not.toContain("GEMINI_API_KEY=");
    expect(process.env.GEMINI_API_KEY).toBeUndefined();

    const status = await request(app).get("/api/bot/secrets").set(auth);
    const gemini = status.body.secrets.find((s: { name: string }) => s.name === "GEMINI_API_KEY");
    expect(gemini.configured).toBe(false);
  });
});

describe("System and commands checkup diagnostics", () => {
  it("executes the full checkup diagnostic suite successfully", async () => {
    const res = await request(app).get("/api/bot/checkup").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.overallStatus).toBeDefined();
    expect(res.body.healthScore).toBeGreaterThanOrEqual(0);
    expect(res.body.system).toBeDefined();
    expect(res.body.system.nodeVersion).toBeDefined();
    expect(res.body.commands.totalRegistered).toBeGreaterThan(0);
    expect(Array.isArray(res.body.tests)).toBe(true);
    expect(res.body.tests.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.dependencies)).toBe(true);
  });
});

