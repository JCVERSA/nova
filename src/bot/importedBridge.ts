import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { BotCommand } from "./types.js";

const require = createRequire(import.meta.url);

export function loadImportedCommands(): BotCommand[] {
  const commandsList: BotCommand[] = [];
  const baseDir = path.join(process.cwd(), "src/bot/imported/commands");
  
  if (!fs.existsSync(baseDir)) {
    console.log("[Bridge] Imported commands directory not found.");
    return [];
  }

  const subdirs = ["admin", "anime", "fun", "general", "media", "textmaker", "user", "utility"];
  
  for (const subdir of subdirs) {
    const dirPath = path.join(baseDir, subdir);
    if (!fs.existsSync(dirPath)) continue;
    
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (!file.endsWith(".js")) continue;
      
      const filePath = path.join(dirPath, file);
      try {
        const rawCmd = require(filePath);
        if (rawCmd && typeof rawCmd === "object" && rawCmd.name) {
          // Wrap into our BotCommand structure
          const bridgedCommand: BotCommand = {
            name: rawCmd.name,
            aliases: rawCmd.aliases || [],
            category: rawCmd.category || subdir,
            description: rawCmd.description || "Imported Command",
            usage: rawCmd.usage || `.${rawCmd.name}`,
            execute: async (sock, msg, context) => {
              const from = msg.key.remoteJid || "";
              const isGroup = from.endsWith("@g.us");
              
              let groupMetadata = null;
              let isBotAdmin = false;
              
              if (isGroup && sock && typeof sock.groupMetadata === "function") {
                try {
                  groupMetadata = await sock.groupMetadata(from);
                  const botId = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
                  const participant = groupMetadata?.participants?.find((p: any) => p.id === botId);
                  isBotAdmin = participant?.admin === "admin" || participant?.admin === "superadmin";
                } catch (e) {
                  // silent
                }
              }

              // Create formatted reply wrapper that acts exactly like Baileys sendMessage
              const replyWrapper = async (text: string, mediaUrl?: string) => {
                if (mediaUrl) {
                  return await context.reply(text, mediaUrl);
                } else {
                  return await context.reply(text);
                }
              };

              const extra = {
                from,
                sender: context.sender,
                pushName: context.senderName || "User",
                isGroup,
                groupMetadata,
                isOwner: context.isOwner,
                isAdmin: context.isAdmin,
                isBotAdmin,
                isMod: context.isOwner,
                reply: replyWrapper,
                react: async (emoji: string) => {
                  return await context.react(emoji);
                },
                formatter: {
                  bold: (t: string) => `*${t}*`,
                  italic: (t: string) => `_${t}_`,
                  monospace: (t: string) => `\`\`\`${t}\`\`\``
                }
              };

              // Execute original CJS handler with standard argument passing
              await rawCmd.execute(sock, msg, context.args, extra);
            }
          };
          commandsList.push(bridgedCommand);
        }
      } catch (err: any) {
        // Some commands might have unresolved compilation requirements at initialization,
        // we log them cleanly to prevent crashing the whole app.
        console.warn(`[Bridge] Gracefully skipped loading command '${file}' from '${subdir}':`, err.message);
      }
    }
  }

  console.log(`[Bridge] Successfully adapted ${commandsList.length} imported commands.`);
  return commandsList;
}
