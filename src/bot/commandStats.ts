import fs from "fs";
import path from "path";

// In-memory command usage statistics, persisted to disk so real usage
// survives restarts. Starts empty (no fabricated seed data).
const commandStats: Record<string, number> = {};

function getStatsFile(): string {
  const dir = process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
  return path.join(dir, "stats.json");
}

function loadStats() {
  try {
    if (fs.existsSync(getStatsFile())) {
      const parsed = JSON.parse(fs.readFileSync(getStatsFile(), "utf-8"));
      Object.assign(commandStats, parsed);
    }
  } catch (e: any) {
    console.error("[Stats] Failed to load stats file:", e?.message || e);
  }
}

let saveTimer: NodeJS.Timeout | null = null;

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const dir = process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(getStatsFile(), JSON.stringify(commandStats, null, 2), "utf-8");
    } catch (e: any) {
      console.error("[Stats] Failed to persist stats:", e?.message || e);
    }
  }, 500);
}

loadStats();

export function getCommandStats(): Record<string, number> {
  return { ...commandStats };
}

export function incrementCommandStats(commandName: string) {
  const cleanName = commandName.toLowerCase().trim();
  if (cleanName) {
    commandStats[cleanName] = (commandStats[cleanName] || 0) + 1;
    scheduleSave();
  }
}
