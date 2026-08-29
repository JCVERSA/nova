import fs from "fs";
import path from "path";

const DB_DIR = process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");

// Core group settings schema
export interface GroupSettings {
  antilink: boolean;
  antilinkAction: "delete" | "kick";
  antitag: boolean;
  antitagAction: "delete" | "kick";
  antibot: boolean;
  antibotAction: "delete" | "kick" | "warn";
  welcome: boolean;
  welcomeMessage: string;
  goodbye: boolean;
  goodbyeMessage: string;
}

export interface UserWarning {
  count: number;
  reasons: string[];
}

const defaultGroupSettings: GroupSettings = {
  antilink: false,
  antilinkAction: "delete",
  antitag: false,
  antitagAction: "delete",
  antibot: false,
  antibotAction: "delete",
  welcome: false,
  welcomeMessage: "👋 Welcome @user to our group *@group*! Enjoy your stay!",
  goodbye: false,
  goodbyeMessage: "👋 Goodbye @user. We will miss you!",
};

// Memory cache
const groupsCache = new Map<string, GroupSettings>();
const warningsCache = new Map<string, UserWarning>();

// Init directories
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const GROUPS_FILE = path.join(DB_DIR, "groups.json");
const WARNINGS_FILE = path.join(DB_DIR, "warnings.json");

// Load at startup
function loadDB() {
  try {
    if (fs.existsSync(GROUPS_FILE)) {
      const data = JSON.parse(fs.readFileSync(GROUPS_FILE, "utf-8"));
      Object.entries(data).forEach(([key, val]) => {
        groupsCache.set(key, { ...defaultGroupSettings, ...(val as any) });
      });
    }
  } catch (e: any) {
    console.error("[Database] Error loading groups database:", e.message);
  }

  try {
    if (fs.existsSync(WARNINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(WARNINGS_FILE, "utf-8"));
      Object.entries(data).forEach(([key, val]) => {
        warningsCache.set(key, val as UserWarning);
      });
    }
  } catch (e: any) {
    console.error("[Database] Error loading warnings database:", e.message);
  }
}

// Map to hold promise chains for each file to serialize writes
const writeChains = new Map<string, Promise<void>>();

// Atomic safe file writing
function writeJsonAtomic(filePath: string, data: any) {
  const previousPromise = writeChains.get(filePath) || Promise.resolve();
  
  const currentPromise = previousPromise.then(async () => {
    try {
      const dirPath = path.dirname(filePath);
      await fs.promises.mkdir(dirPath, { recursive: true });
      const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      await fs.promises.rename(tmpPath, filePath);
    } catch (e: any) {
      console.error(`[Database] Error in writeJsonAtomic for ${filePath}:`, e.message);
    }
  });
  
  writeChains.set(filePath, currentPromise);
}

// Synchronous save functions
function saveGroups() {
  try {
    const obj: Record<string, GroupSettings> = {};
    groupsCache.forEach((val, key) => {
      obj[key] = val;
    });
    writeJsonAtomic(GROUPS_FILE, obj);
  } catch (e: any) {
    console.error("[Database] Error saving groups database:", e.message);
  }
}

function saveWarnings() {
  try {
    const obj: Record<string, UserWarning> = {};
    warningsCache.forEach((val, key) => {
      obj[key] = val;
    });
    writeJsonAtomic(WARNINGS_FILE, obj);
  } catch (e: any) {
    console.error("[Database] Error saving warnings database:", e.message);
  }
}

// Initialize on load
loadDB();

export const database = {
  getGroupSettings(groupId: string): GroupSettings {
    if (!groupsCache.has(groupId)) {
      groupsCache.set(groupId, { ...defaultGroupSettings });
      saveGroups();
    }
    return groupsCache.get(groupId)!;
  },

  updateGroupSettings(groupId: string, settings: Partial<GroupSettings>): GroupSettings {
    const current = this.getGroupSettings(groupId);
    const updated = { ...current, ...settings };
    groupsCache.set(groupId, updated);
    saveGroups();
    return updated;
  },

  getWarnings(groupId: string, userId: string): UserWarning {
    const key = `${groupId}_${userId}`;
    if (!warningsCache.has(key)) {
      return { count: 0, reasons: [] };
    }
    return warningsCache.get(key)!;
  },

  addWarning(groupId: string, userId: string, reason: string): UserWarning {
    const key = `${groupId}_${userId}`;
    const current = this.getWarnings(groupId, userId);
    const updated = {
      count: current.count + 1,
      reasons: [...current.reasons, reason],
    };
    warningsCache.set(key, updated);
    saveWarnings();
    return updated;
  },

  clearWarnings(groupId: string, userId: string): void {
    const key = `${groupId}_${userId}`;
    warningsCache.delete(key);
    saveWarnings();
  },
};
