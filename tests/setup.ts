/**
 * Isolates every test file into a temporary data + commands directory and
 * fixes the panel token, so tests never touch real runtime state and the
 * API is always exercised in authenticated mode.
 */
import fs from "fs";
import path from "path";

/**
 * Test directories live inside the repo root (gitignored via `.test-tmp/`)
 * so the test runner can transform/import command files written during tests.
 */
const tmpRoot = path.join(process.cwd(), ".test-tmp");

process.env.NEBULA_DATA_DIR = path.join(tmpRoot, "data");
process.env.NEBULA_COMMANDS_DIR = path.join(tmpRoot, "commands");
process.env.NEBULA_ENV_FILE = path.join(tmpRoot, "data", ".env");
process.env.PANEL_TOKEN = "test-panel-token";
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.NODE_ENV = "test";

fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.mkdirSync(process.env.NEBULA_DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.NEBULA_COMMANDS_DIR, { recursive: true });
