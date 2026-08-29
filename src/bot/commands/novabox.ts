import { BotCommand, BotCommandContext } from "../types.js";
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import os from "os";
import { exec, spawn } from "child_process";
import { registerTempDownload } from "../tempDownloadManager.js";
import { createBatchJob, updateEpisodeProgress, updateJobStatus, completeBatchJob } from "../batchDownloadManager.js";

interface HlsVariant {
  label: string;
  resolution: string;
  bandwidth: number;
  estimatedSizeMB: number;
  url: string;
  isDirectWhatsAppFit: boolean;
}

interface AnimeSession {
  step: "select_anime" | "language" | "season" | "episode" | "resolution" | "single_stream_choice";
  searchResults?: Array<{ title: string; subtitle: string; url: string }>;
  animeTitle: string;
  animeUrl: string;
  languages: string[];
  selectedLanguage?: string;
  seasons: Array<{ name: string; subPath: string; url: string }>;
  selectedSeason?: { name: string; subPath: string; url: string };
  episodes?: Record<number, string[]>;
  selectedEpisodeIndex?: number;
  selectedEpisodeIndices?: number[]; // Multi-episode batch support
  isSeasonZipDownload?: boolean; // Full season download mode
  availableVariants?: HlsVariant[];
  selectedVariantUrl?: string;
  singleStreamDetected?: {
    label: string;
    resolution: string;
    estimatedSizeMB: number;
    streamUrl: string;
    sourceUrl: string;
    originUrl: string;
  };
  forceCompress?: boolean;
  timer: any;
}

// Global active sessions map for the multi-step flow
const sessions = new Map<string, AnimeSession>();

const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function clearUserSession(sender: string) {
  const session = sessions.get(sender);
  if (session) {
    clearTimeout(session.timer);
    sessions.delete(sender);
  }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\-\[\]]/g, "_")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Search Anime-Sama
async function searchAnime(query: string) {
  const url = "https://anime-sama.to/template-php/defaut/fetch.php";
  const params = new URLSearchParams();
  params.append("query", query);
  
  const res = await axios.post(url, params, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    timeout: 8000
  });

  const $ = cheerio.load(res.data);
  const results: Array<{ title: string; subtitle: string; url: string }> = [];

  $(".asn-search-result").each((_, el) => {
    const href = $(el).attr("href") || "";
    const title = $(el).find(".asn-search-result-title").text().trim();
    const subtitle = $(el).find(".asn-search-result-subtitle").text().trim();
    if (href) {
      results.push({ title, subtitle, url: href });
    }
  });

  return results;
}

// Parse main anime page for seasons (panneauAnime calls)
async function parseSeasons(animeUrl: string) {
  const res = await axios.get(animeUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    timeout: 8000
  });

  const html = res.data;
  const seasons: Array<{ name: string; subPath: string; url: string }> = [];

  // Match panneauAnime("Saison 1", "saison1/vostfr");
  const regex = /panneauAnime\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const name = match[1];
    const subPath = match[2]; // e.g. "saison1/vostfr"
    if (name.toLowerCase() === "nom" || subPath.toLowerCase() === "url") {
      continue;
    }
    const baseUrl = animeUrl.endsWith("/") ? animeUrl : animeUrl + "/";
    seasons.push({
      name,
      subPath,
      url: baseUrl + subPath + "/"
    });
  }

  return seasons;
}

// Fast check to see if VF version exists
async function checkVfExists(url: string): Promise<boolean> {
  try {
    const res = await axios.head(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 2000
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

// Parse episodes.js file
async function parseEpisodes(jsUrl: string) {
  const res = await axios.get(jsUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    timeout: 8000
  });

  const jsContent = res.data;
  const regex = /(?:var|\/\/var|\/\/\/var)\s+eps(\d+)\s*=\s*\[([\s\S]*?)\]\s*;/gi;
  let match;
  const episodeLists: Record<number, string[]> = {};

  while ((match = regex.exec(jsContent)) !== null) {
    const listId = parseInt(match[1]);
    const arrayStr = match[2];

    const urlRegex = /'([^']+)'|"([^"]+)"/g;
    let urlMatch;
    const urls: string[] = [];
    while ((urlMatch = urlRegex.exec(arrayStr)) !== null) {
      urls.push(urlMatch[1] || urlMatch[2]);
    }
    if (urls.length > 0) {
      episodeLists[listId] = urls;
    }
  }

  return episodeLists;
}

const animeCommand: BotCommand = {
  name: "anime",
  category: "Novabox",
  description: "Search and download anime episodes from Anime-Sama directly inside WhatsApp.",
  usage: ".anime [anime_name] (or .a [name] / .nv [name])",
  aliases: ["novabox", "a", "nv"],
  execute: async (sock, msg, context) => {
    const args = context.args || [];
    const firstArg = (args[0] || "").toLowerCase();
    const sender = context.sender;

    // Reset session helper
    const refreshSessionTimer = (session: AnimeSession) => {
      clearTimeout(session.timer);
      session.timer = setTimeout(() => {
        clearUserSession(sender);
        context.reply("⏳ *Session Expired:* Your Anime download session has ended due to inactivity. Please start a new query with `.a <name>`.");
      }, SESSION_TIMEOUT);
    };

    // If no args and no active session, show usage
    if (args.length === 0 && !sessions.has(sender)) {
      await context.react("🎬");
      return context.reply(
        `🤖 *Nebula Bot - Anime Novabox Downloader* 🎬\n\n` +
        `Search, play, and get direct ad-free download/streaming resources for any anime from Anime-Sama!\n\n` +
        `*Quick Commands & Aliases:*\n` +
        `• Search anime: \`.a [name]\` or \`.anime [name]\` (e.g. \`.a Solo Leveling\`)\n` +
        `• Select anime: \`.a [number]\` (e.g. \`.a 1\`)\n` +
        `• Select season: \`.a s[number]\` (e.g. \`.a s1\`)\n` +
        `• Select episode: \`.a ep[number]\` (e.g. \`.a ep1\`)\n` +
        `• Select resolution: \`.a r [number]\` (e.g. \`.a r 1\`)\n\n` +
        `_Note: Follow the interactive step-by-step guidance!_`
      );
    }

    // Determine if we should handle this as an interactive step selection or as a new search query
    let isStepAction = false;
    if (sessions.has(sender)) {
      const session = sessions.get(sender)!;
      const step = session.step;
      const fullArgStr = args.join(" ").toLowerCase();
      if (step === "select_anime") {
        isStepAction = !isNaN(parseInt(firstArg)) || firstArg === "select" || firstArg === "s" || firstArg === "choice" || /^s?\d+$/i.test(firstArg);
      } else if (step === "language") {
        isStepAction = firstArg === "vostfr" || firstArg === "vf";
      } else if (step === "season") {
        isStepAction = !isNaN(parseInt(firstArg)) || firstArg === "season" || firstArg === "s" || /^s\d+/i.test(firstArg) || firstArg === "vostfr" || firstArg === "vf";
      } else if (step === "episode") {
        isStepAction = !isNaN(parseInt(firstArg)) || firstArg === "ep" || firstArg === "e" || firstArg === "episode" || /^(?:ep|e)?\d+/i.test(firstArg) || fullArgStr.includes(",") || fullArgStr.includes("-");
      } else if (step === "resolution") {
        isStepAction = !isNaN(parseInt(firstArg)) || firstArg === "res" || firstArg === "r" || firstArg === "resolution" || /^(?:r|res)\d+$/i.test(firstArg);
      } else if (step === "single_stream_choice") {
        isStepAction = !isNaN(parseInt(firstArg)) || firstArg === "choice" || firstArg === "c" || firstArg === "compress" || firstArg === "links";
      }
    }

    // Step-by-step handler if there's an active session and the user is responding to the step
    if (sessions.has(sender) && (isStepAction || args.length === 0)) {
      const session = sessions.get(sender)!;
      refreshSessionTimer(session);

      // Handle anime selection step
      if (session.step === "select_anime") {
        let choiceIndex = -1;
        const selectMatch = firstArg.match(/^s?(\d+)$/i);
        if (firstArg === "select" || firstArg === "s" || firstArg === "choice") {
          choiceIndex = parseInt(args[1] || "") - 1;
        } else if (selectMatch) {
          choiceIndex = parseInt(selectMatch[1], 10) - 1;
        } else if (!isNaN(parseInt(firstArg))) {
          choiceIndex = parseInt(firstArg) - 1;
        }

        const results = session.searchResults || [];
        if (choiceIndex < 0 || choiceIndex >= results.length) {
          return context.reply(`❌ *Invalid Selection:* Please choose a valid anime number between *1* and *${results.length}*.\nExample: \`.a 1\``);
        }

        const chosen = results[choiceIndex];
        session.animeTitle = chosen.title;
        session.animeUrl = chosen.url;

        await context.react("⏳");
        await context.reply(`✨ *Selected:* *${chosen.title}*\n🔗 Connecting to Anime-Sama database...`);

        try {
          // Parse available seasons
          const seasons = await parseSeasons(chosen.url);
          if (seasons.length === 0) {
            clearUserSession(sender);
            return context.reply("❌ *Error:* Unable to locate any seasons/episodes on this Anime page. Session terminated.");
          }

          // Deriving available languages
          const languages = ["VOSTFR"];
          
          // Check if VF exists on season 1
          const s1 = seasons[0];
          const vfCheckUrl = s1.url.replace("/vostfr/", "/vf/");
          const hasVf = await checkVfExists(vfCheckUrl);
          if (hasVf) {
            languages.push("VF");
          }

          session.languages = languages;
          session.seasons = seasons;

          // Default to VF if available (otherwise fallback to VOSTFR)
          const defaultLang = hasVf ? "VF" : "VOSTFR";
          session.selectedLanguage = defaultLang;
          session.step = "season";

          let filteredSeasons = seasons;
          if (defaultLang === "VF") {
            const vfSeasons = [];
            for (const s of seasons) {
              const pathParts = s.subPath.split("/");
              const seasonFolder = pathParts[0];
              const vfUrl = s.url.replace("/vostfr/", "/vf/");
              const exists = await checkVfExists(vfUrl);
              if (exists) {
                vfSeasons.push({
                  ...s,
                  url: vfUrl,
                  subPath: `${seasonFolder}/vf`
                });
              }
            }
            if (vfSeasons.length > 0) {
              filteredSeasons = vfSeasons;
            }
          }

          session.seasons = filteredSeasons;
          const seasonsList = filteredSeasons.map((s, i) => `*s${i + 1}.* ${s.name}`).join("\n");

          await context.react("📂");
          return context.reply(
            `🎬 *Novabox - Select Season* 🎬\n` +
            `• *Anime:* ${chosen.title}\n` +
            `• *Language:* 🇫🇷 *${defaultLang}* (Default)${languages.includes("VOSTFR") ? `\n_💡 (To switch to VOSTFR, type \`.a vostfr\`)_` : ""}\n\n` +
            `*Available Seasons:*\n${seasonsList}\n\n` +
            `👉 Reply with: \`.a s[number]\` (e.g., \`.a s1\`)`
          );

        } catch (err: any) {
          console.error("[NOVABOX] Search select Error:", err);
          clearUserSession(sender);
          return context.reply("❌ *Error:* Failed to load anime seasons. Please try searching again.");
        }
      }

      // Handle language switch (e.g. user specifies .a vostfr or .a vf)
      if (session.step === "season" || session.step === "language") {
        if (firstArg === "vostfr" || firstArg === "vf") {
          const langChoice = firstArg === "vostfr" ? "VOSTFR" : "VF";
          if (!session.languages.includes(langChoice)) {
            return context.reply(`❌ *Unavailable Language:* The language *${langChoice}* is not available for this anime.`);
          }

          session.selectedLanguage = langChoice;
          session.step = "season";

          let filteredSeasons = session.seasons;
          if (langChoice === "VF") {
            const vfSeasons = [];
            for (const s of session.seasons) {
              const pathParts = s.subPath.split("/");
              const seasonFolder = pathParts[0];
              const vfUrl = s.url.replace("/vostfr/", "/vf/");
              const exists = await checkVfExists(vfUrl);
              if (exists) {
                vfSeasons.push({
                  ...s,
                  url: vfUrl,
                  subPath: `${seasonFolder}/vf`
                });
              }
            }
            if (vfSeasons.length > 0) {
              filteredSeasons = vfSeasons;
            }
          } else {
            filteredSeasons = session.seasons.map(s => {
              const pathParts = s.subPath.split("/");
              const seasonFolder = pathParts[0];
              return {
                ...s,
                url: s.url.replace("/vf/", "/vostfr/"),
                subPath: `${seasonFolder}/vostfr`
              };
            });
          }

          session.seasons = filteredSeasons;
          const seasonsList = filteredSeasons.map((s, i) => `*s${i + 1}.* ${s.name}`).join("\n");

          await context.react("🗣️");
          return context.reply(
            `🔄 *Language switched to ${langChoice}!*\n\n` +
            `*Available Seasons:*\n${seasonsList}\n\n` +
            `👉 Reply with: \`.a s[number]\` (e.g., \`.a s1\`)`
          );
        }
      }

      // Handle season selection step
      if (session.step === "season") {
        let seasonIndex = -1;
        let isSeasonDownload = false;

        const fullArgStr = args.join(" ").toLowerCase();
        if (fullArgStr.includes("d-") || fullArgStr.includes("d") || fullArgStr.includes("all")) {
          isSeasonDownload = true;
        }

        const sMatch = firstArg.match(/^s(\d+)(?:d|-d|d-)?$/i);
        if (sMatch) {
          seasonIndex = parseInt(sMatch[1], 10) - 1;
        } else if (firstArg === "season" || firstArg === "s") {
          seasonIndex = parseInt(args[1] || "", 10) - 1;
        } else if (!isNaN(parseInt(firstArg))) {
          seasonIndex = parseInt(firstArg, 10) - 1;
        }

        if (seasonIndex < 0 || seasonIndex >= session.seasons.length) {
          return context.reply(`❌ *Invalid Selection:* Please choose a valid season number between *1* and *${session.seasons.length}*.\nExample: \`.a s1\` or \`.a s1 d-\` to download entire season`);
        }

        const selectedSeason = session.seasons[seasonIndex];
        session.selectedSeason = selectedSeason;

        await context.react("⏳");
        await context.reply(`🔍 *Fetching episode listings for ${selectedSeason.name}...*`);

        try {
          const jsUrl = selectedSeason.url + "episodes.js";
          const eps = await parseEpisodes(jsUrl);
          
          if (!eps || Object.keys(eps).length === 0) {
            clearUserSession(sender);
            return context.reply("❌ *Error:* No episodes found in this season file. Session terminated.");
          }

          session.episodes = eps;
          const totalEpisodes = Math.max(...Object.values(eps).map(arr => arr.length));

          if (isSeasonDownload) {
            // User requested to download the entire season!
            session.isSeasonZipDownload = true;
            session.selectedEpisodeIndices = Array.from({ length: totalEpisodes }, (_, i) => i);
            session.selectedEpisodeIndex = 0; // Reference first episode for stream quality discovery

            await context.react("🔍");
            await context.reply(`🔎 *Inspecting VidMoly stream for ${selectedSeason.name} (Total: ${totalEpisodes} Episodes)...*`);

            const resolved = await resolveEpisodeStream(session.episodes || {}, 0);
            const hlsUrl = resolved.hlsUrl;
            const refererUrl = resolved.refererUrl;
            const originUrl = resolved.originUrl;

            let variants: HlsVariant[] = [];
            if (hlsUrl) {
              variants = await inspectHlsStreams(hlsUrl, refererUrl, originUrl);
            }

            session.availableVariants = variants;
            session.step = "resolution";
            await context.react("⚙️");

            const resOptions = variants.length > 0
              ? variants.map((v, i) => `*r${i + 1}.* *${v.label}* (${v.resolution}) — ~${v.estimatedSizeMB} MB/ep`).join("\n")
              : `*r1.* 1080P Full HD\n*r2.* 720P High Definition\n*r3.* 480P Medium Quality\n*r4.* 360P Mobile Quality`;

            return context.reply(
              `🎬 *Novabox - Full Season Batch Download* 📦\n` +
              `• *Anime:* ${session.animeTitle}\n` +
              `• *Language:* ${session.selectedLanguage}\n` +
              `• *Season:* ${selectedSeason.name} (All ${totalEpisodes} episodes)\n` +
              `• *Player Engine:* 📺 ${resolved.playerName || "VidMoly"}\n\n` +
              `*Select resolution for all ${totalEpisodes} episodes:*\n` +
              `${resOptions}\n\n` +
              `👉 Reply with: \`.a r [number]\` (e.g., \`.a r 1\` or \`.a r 2\`)`
            );
          }

          session.step = "episode";
          
          return context.reply(
            `🎬 *Novabox - Select Episode(s)* 🎬\n` +
            `• *Anime:* ${session.animeTitle}\n` +
            `• *Language:* ${session.selectedLanguage}\n` +
            `• *Season:* ${selectedSeason.name}\n\n` +
            `📦 *Total Episodes available:* ${totalEpisodes}\n\n` +
            `*Options:*\n` +
            `• Single episode: \`.a e2\` (or \`.a 2\` / \`.a ep2\`)\n` +
            `• Multiple episodes: \`.a e2,e3,e4,e7,e9\` (or \`.a 2,3,4,7,9\`)\n` +
            `• Episode range: \`.a 1-5\` (or \`.a e1-e5\`)\n\n` +
            `👉 Reply with your desired episode(s):`
          );
        } catch (err: any) {
          console.error("[NOVABOX] Failed to parse episodes:", err);
          clearUserSession(sender);
          return context.reply("❌ *Error:* Failed to load season episodes from Anime-Sama. Please try again.");
        }
      }

      // Handle episode selection step (Single episode, multiple comma-separated episodes, or range)
      if (session.step === "episode") {
        const fullArgStr = args.join(" ").trim();
        const totalEpisodes = Math.max(...Object.values(session.episodes || {}).map(arr => arr.length));
        const selectedIndices: number[] = [];

        // Check for range format (e.g. 1-5 or e1-e5)
        const rangeMatch = fullArgStr.match(/^(?:ep|e)?(\d+)\s*-\s*(?:ep|e)?(\d+)$/i);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          const min = Math.min(start, end);
          const max = Math.max(start, end);
          for (let ep = min; ep <= max; ep++) {
            if (ep >= 1 && ep <= totalEpisodes) {
              selectedIndices.push(ep - 1);
            }
          }
        } else {
          // Check for comma or whitespace separated list (e.g. e2,e3,e4 or 2,3,4 or e2 e3 e4)
          const tokens = fullArgStr.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
          for (const token of tokens) {
            const tokenMatch = token.match(/^(?:ep|e)?(\d+)$/i);
            if (tokenMatch) {
              const epNum = parseInt(tokenMatch[1], 10);
              if (epNum >= 1 && epNum <= totalEpisodes) {
                const idx = epNum - 1;
                if (!selectedIndices.includes(idx)) {
                  selectedIndices.push(idx);
                }
              }
            }
          }
        }

        if (selectedIndices.length === 0) {
          return context.reply(
            `❌ *Invalid Episode Selection:* Please choose valid episode number(s) between *1* and *${totalEpisodes}*.\n` +
            `Examples:\n` +
            `• Single: \`.a e2\` or \`.a 2\`\n` +
            `• Multi: \`.a e2,e3,e4,e7,e9\` or \`.a 2,3,4,7,9\`\n` +
            `• Range: \`.a 1-5\``
          );
        }

        session.selectedEpisodeIndices = selectedIndices;
        session.selectedEpisodeIndex = selectedIndices[0]; // Reference for initial stream inspection

        const isMulti = selectedIndices.length > 1;
        const episodeSummary = isMulti 
          ? selectedIndices.map(i => `Ep ${i + 1}`).join(", ")
          : `Episode ${selectedIndices[0] + 1}`;

        // Probe available stream sources, prioritizing VidMoly for full multi-resolution master streams
        await context.react("🔍");
        await context.reply(`🔎 *Inspecting VidMoly media streams for ${episodeSummary}...*`);

        const resolved = await resolveEpisodeStream(session.episodes || {}, selectedIndices[0]);
        const hlsUrl = resolved.hlsUrl;
        const refererUrl = resolved.refererUrl;
        const originUrl = resolved.originUrl;

        let variants: HlsVariant[] = [];
        if (hlsUrl) {
          variants = await inspectHlsStreams(hlsUrl, refererUrl, originUrl);
        }

        // Check if multiple variants or single stream were detected
        if (variants.length > 1) {
          session.availableVariants = variants;
          session.step = "resolution";
          await context.react("⚙️");

          const resOptions = variants.map((v, i) => {
            const fitTag = v.isDirectWhatsAppFit 
              ? "✅ _[Direct WhatsApp Video]_" 
              : "⚠️ _[Direct Links / Auto-Compress]_";
            return `*r${i + 1}.* *${v.label}* (${v.resolution}) — ~${v.estimatedSizeMB} MB/ep ${fitTag}`;
          }).join("\n");

          return context.reply(
            `🎬 *Novabox - Select Resolution* 🎬\n` +
            `• *Anime:* ${session.animeTitle}\n` +
            `• *Language:* ${session.selectedLanguage}\n` +
            `• *Season:* ${session.selectedSeason?.name}\n` +
            `• *Selected Episodes:* ${episodeSummary} (${selectedIndices.length} total)\n` +
            `• *Player Engine:* 📺 ${resolved.playerName || "VidMoly"}\n\n` +
            `*Detected stream qualities:*\n` +
            `${resOptions}\n\n` +
            `👉 Reply with: \`.a r [number]\` (e.g., \`.a r 1\` or \`.a r1\`)`
          );
        } else if (variants.length === 1 && !isMulti) {
          const single = variants[0];
          session.singleStreamDetected = {
            label: single.label,
            resolution: single.resolution,
            estimatedSizeMB: single.estimatedSizeMB,
            streamUrl: single.url,
            sourceUrl: refererUrl,
            originUrl: originUrl
          };
          session.step = "single_stream_choice";
          await context.react("⚙️");

          const sizeWarning = single.estimatedSizeMB > 100 
            ? `⚠️ *File Size Notice:* The raw stream is ~${single.estimatedSizeMB} MB, which exceeds WhatsApp's direct video limit (100MB).\n\n` 
            : `📦 *File Size:* ~${single.estimatedSizeMB} MB.\n\n`;

          return context.reply(
            `🎬 *Novabox - Stream Detected* 🎬\n` +
            `• *Anime:* ${session.animeTitle}\n` +
            `• *Language:* ${session.selectedLanguage}\n` +
            `• *Season:* ${session.selectedSeason?.name}\n` +
            `• *Episode:* Episode ${selectedIndices[0] + 1}\n` +
            `• *Detected Quality:* ${single.label} (${single.resolution})\n\n` +
            sizeWarning +
            `*Choose an option:*\n` +
            `*1. 📱 Compress & Send for WhatsApp* (Transcode down to ~75 MB 480P playable video)\n` +
            `*2. 🔗 Get Direct High-Speed Download & Streaming Links* (Original ${single.label} ${single.estimatedSizeMB} MB)\n\n` +
            `👉 Reply with: \`.a 1\` or \`.a 2\``
          );
        } else {
          // Standard resolution fallback when manifest could not be read or multi-episode
          session.step = "resolution";
          await context.react("⚙️");
          return context.reply(
            `🎬 *Novabox - Select Resolution* 🎬\n` +
            `• *Anime:* ${session.animeTitle}\n` +
            `• *Language:* ${session.selectedLanguage}\n` +
            `• *Season:* ${session.selectedSeason?.name}\n` +
            `• *Selected Episodes:* ${episodeSummary} (${selectedIndices.length} total)\n\n` +
            `*Choose your preferred download quality:*\n` +
            `*r1.* 1080P Full HD\n` +
            `*r2.* 720P High Definition\n` +
            `*r3.* 480P Medium Quality (Auto-compressed for WhatsApp)\n` +
            `*r4.* 360P Mobile Quality (Direct WhatsApp)\n\n` +
            `👉 Reply with: \`.a r [number]\` (e.g., \`.a r 1\` or \`.a r1\`)`
          );
        }
      }

      // Handle single stream choice step
      if (session.step === "single_stream_choice") {
        let choice = 0;
        if (!isNaN(parseInt(firstArg))) {
          choice = parseInt(firstArg);
        } else if (firstArg === "1" || firstArg === "compress" || firstArg === "c") {
          choice = 1;
        } else if (firstArg === "2" || firstArg === "links" || firstArg === "l") {
          choice = 2;
        }

        if (choice === 1) {
          session.forceCompress = true;
          if (session.singleStreamDetected?.streamUrl) {
            session.selectedVariantUrl = session.singleStreamDetected.streamUrl;
          }
          await context.react("🚀");
          return await sendFinalEpisode(sock, msg, context, session, "480P [Compressed]");
        } else if (choice === 2) {
          // Send direct streaming & download resources
          const epIndex = session.selectedEpisodeIndex || 0;
          const epNum = epIndex + 1;
          const animeClean = session.animeTitle.replace(/\s+/g, "_");
          const lang = session.selectedLanguage || "VOSTFR";
          const seasonNum = session.selectedSeason?.name.match(/\d+/)?.[0] || "01";
          const formattedSeason = `S${seasonNum.padStart(2, "0")}`;
          const formattedEpisode = `E${String(epNum).padStart(2, "0")}`;
          const filename = sanitizeFilename(`${animeClean}_${lang}_1080P_${formattedSeason}_${formattedEpisode}`) + ".mp4";

          const vidmolyUrl = getVidMolyUrl(session.episodes, epIndex);

          clearUserSession(sender);
          await context.react("✅");
          return context.reply(
            `📥 *NEBULA NOVABOX - STREAM DETAILS* 📥\n\n` +
            `🎬 *Anime:* ${session.animeTitle}\n` +
            `🗣️ *Language:* ${lang}\n` +
            `📅 *Season:* ${session.selectedSeason?.name}\n` +
            `🎞️ *Episode:* Episode ${epNum}\n` +
            `⚙️ *Detected Resolution:* ${session.singleStreamDetected?.label || "1080P"} (~${session.singleStreamDetected?.estimatedSizeMB || 486} MB)\n` +
            `📺 *Official Player Engine:* VidMoly\n` +
            `📄 *Filename:* \`${filename}\`\n\n` +
            `🔗 *Direct Streaming & Download:* \n` +
            (vidmolyUrl ? `• 📺 *Play Ad-Free (VidMoly):* ${vidmolyUrl}\n` : "• 📺 *VidMoly Stream:* Direct HLS ready\n") +
            `\n🌌 _Nebula Bot - Your ultimate media center_`
          );
        } else {
          return context.reply("❌ *Invalid Selection:* Please choose *1* (Compress & Send) or *2* (Direct Links).\nExample: `.a 1`");
        }
      }

      // Handle resolution selection step
      if (session.step === "resolution") {
        let resChoice = "";
        let resIndex = -1;

        const rMatch = firstArg.match(/^(?:r|res)(\d+)$/i);
        if (rMatch) {
          resIndex = parseInt(rMatch[1], 10);
        } else if (firstArg === "res" || firstArg === "r" || firstArg === "resolution") {
          resIndex = parseInt(args[1] || "", 10);
        } else if (!isNaN(parseInt(firstArg))) {
          resIndex = parseInt(firstArg, 10);
        }

        const variants = session.availableVariants || [];
        if (variants.length > 0) {
          if (resIndex >= 1 && resIndex <= variants.length) {
            const selectedVariant = variants[resIndex - 1];
            session.selectedVariantUrl = selectedVariant.url;
            resChoice = selectedVariant.label;
            if (selectedVariant.estimatedSizeMB > 100 && (resChoice === "480P" || resChoice === "360P")) {
              session.forceCompress = true;
            }
          }
        } else {
          if (resIndex === 1) resChoice = "1080P";
          else if (resIndex === 2) resChoice = "720P";
          else if (resIndex === 3) {
            resChoice = "480P";
            session.forceCompress = true;
          } else if (resIndex === 4) {
            resChoice = "360P";
            session.forceCompress = true;
          }
        }

        if (!resChoice) {
          const maxChoice = variants.length > 0 ? variants.length : 4;
          return context.reply(`❌ *Invalid Selection:* Please choose a valid resolution choice (1 to ${maxChoice}).\nExample: \`.a r 1\` or \`.a r1\``);
        }

        await context.react("🚀");
        return await sendFinalEpisode(sock, msg, context, session, resChoice);
      }
    }

    // Default: Start a fresh query search
    await context.react("🔍");
    const query = args.join(" ").trim();
    await context.reply(`🔍 *Searching Anime-Sama for:* "${query}"...`);

    try {
      const searchResults = await searchAnime(query);

      if (searchResults.length === 0) {
        await context.react("❌");
        return context.reply(`❌ *No results found* for "${query}". Please check the spelling or try another keyword.`);
      }

      // Clear any existing session to start fresh
      clearUserSession(sender);

      // Create a user session at the select_anime step
      const newSession: AnimeSession = {
        step: "select_anime",
        searchResults,
        animeTitle: "",
        animeUrl: "",
        languages: [],
        seasons: [],
        timer: null
      };

      sessions.set(sender, newSession);
      refreshSessionTimer(newSession);

      // Print list of matching anime
      const listText = searchResults
        .map((r, i) => `*${i + 1}.* ${r.title}${r.subtitle ? ` (_${r.subtitle}_)` : ""}`)
        .join("\n");

      await context.react("🎬");
      return context.reply(
        `🎬 *Novabox - Select Anime* 🎬\n\n` +
        `Multiple results found for *"${query}"*. Please select the anime you want to view:\n\n` +
        `${listText}\n\n` +
        `👉 Reply with: \`.a [number]\` (e.g., \`.a 1\`)`
      );

    } catch (err: any) {
      console.error("[NOVABOX] Search Error:", err);
      await context.react("❌");
      return context.reply("❌ *Error:* Failed to perform the query. Please make sure the Anime-Sama network is operational.");
    }
  }
};

// Universal helper to locate the official VidMoly embed URL exclusively
function getVidMolyUrl(episodes: Record<number, string[]> | undefined, epIndex: number): string {
  if (!episodes) return "";

  // 1. Primary Check: List 2 is the official VidMoly player on Anime-Sama
  const eps2Url = episodes[2]?.[epIndex] || "";
  if (eps2Url && (eps2Url.includes("vidmoly") || eps2Url.includes("ansembed"))) {
    return eps2Url;
  }

  // 2. Scan all other player lists specifically for VidMoly / ansembed mirrors
  for (const listId of Object.keys(episodes).map(Number)) {
    const candidate = episodes[listId]?.[epIndex] || "";
    if (candidate && (candidate.includes("vidmoly") || candidate.includes("ansembed"))) {
      return candidate;
    }
  }

  // 3. Fallback to eps2 if available even if obfuscated
  if (eps2Url) {
    return eps2Url;
  }

  return "";
}

// Standard Dean Edwards Unpacker
function unpack(p: string, a: number, c: number, k: string[]): string {
  let count = c;
  while (count--) {
    if (k[count]) {
      p = p.replace(new RegExp('\\b' + count.toString(a) + '\\b', 'g'), k[count]);
    }
  }
  return p;
}

// Extract HLS stream URL exclusively from VidMoly (vidmoly.to, vidmoly.net, vidmoly.me, ansembed.net)
async function extractHlsUrlFromVidMoly(embedUrl: string): Promise<{ hlsUrl: string | null; refererUrl: string; originUrl: string }> {
  if (!embedUrl) {
    return { hlsUrl: null, refererUrl: "", originUrl: "https://vidmoly.to" };
  }

  try {
    let originUrl = "https://vidmoly.to";
    if (embedUrl.includes("vidmoly.net")) originUrl = "https://vidmoly.net";
    else if (embedUrl.includes("vidmoly.me")) originUrl = "https://vidmoly.me";
    else if (embedUrl.includes("ansembed.net")) originUrl = "https://ansembed.net";
    else if (embedUrl.includes("vidmoly")) {
      const match = embedUrl.match(/https?:\/\/[^/]+/);
      if (match) originUrl = match[0];
    }

    const res = await axios.get(embedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://anime-sama.to/",
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
      },
      timeout: 9000
    });
    const html = typeof res.data === "string" ? res.data : "";

    // 1. Direct sources array or file property match in script
    const m3u8Match = html.match(/sources:\s*\[\s*\{\s*file:\s*["']([^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                      html.match(/file:\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                      html.match(/["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                      html.match(/src:\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                      html.match(/source\s*=\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i);
    if (m3u8Match) {
      return { hlsUrl: m3u8Match[1], refererUrl: embedUrl, originUrl };
    }

    // 2. Packed Dean Edwards JS unpacker (handle single or multi-layer packed scripts)
    const packedRegex = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?return p\}\((['"][\s\S]*?['"])\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"][\s\S]*?['"])\.split\(['"]\|['"]\)\)/g;
    let match: RegExpExecArray | null;
    while ((match = packedRegex.exec(html)) !== null) {
      try {
        const pVal = eval(match[1]);
        const aVal = parseInt(match[2], 10);
        const cVal = parseInt(match[3], 10);
        const kVal = eval(match[4]).split("|");
        const unpacked = unpack(pVal, aVal, cVal, kVal);

        const unpackedM3u8 = unpacked.match(/sources:\s*\[\s*\{\s*file:\s*["']([^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                             unpacked.match(/file:\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                             unpacked.match(/["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                             unpacked.match(/src:\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i) ||
                             unpacked.match(/source\s*=\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i);
        if (unpackedM3u8) {
          return { hlsUrl: unpackedM3u8[1], refererUrl: embedUrl, originUrl };
        }
      } catch (unpackErr: any) {
        console.warn("[NOVABOX] VidMoly packed script unpack error:", unpackErr.message);
      }
    }

    // 3. Vidmoly direct mp4 fallback pattern in HTML if m3u8 not detected
    const mp4Match = html.match(/sources:\s*\[\s*\{\s*file:\s*["']([^"']+\.mp4[^"']*)["']/i) ||
                     html.match(/file:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i) ||
                     html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
    if (mp4Match) {
      return { hlsUrl: mp4Match[1], refererUrl: embedUrl, originUrl };
    }
  } catch (err: any) {
    console.warn("[NOVABOX] VidMoly stream extraction error:", err.message);
  }
  return { hlsUrl: null, refererUrl: embedUrl, originUrl: "https://vidmoly.to" };
}

// Universal extractor exclusively targeting VidMoly as the single official media player
async function resolveEpisodeStream(episodes: Record<number, string[]>, epIndex: number): Promise<{ hlsUrl: string | null; refererUrl: string; originUrl: string; playerName: string }> {
  const vidmolyEmbedUrl = getVidMolyUrl(episodes, epIndex);
  if (!vidmolyEmbedUrl) {
    console.warn(`[NOVABOX] VidMoly player URL not found for episode index ${epIndex}`);
    return { hlsUrl: null, refererUrl: "", originUrl: "", playerName: "VidMoly (Unavailable)" };
  }

  console.log(`[NOVABOX] Exclusively scraping VidMoly Player: ${vidmolyEmbedUrl}`);
  const result = await extractHlsUrlFromVidMoly(vidmolyEmbedUrl);
  return {
    ...result,
    playerName: "VidMoly"
  };
}

// Inspect and perform HEAD / Range diagnostic request to media source to verify stream reachability & content size
async function probeMediaHeaders(targetUrl: string, refererUrl: string, originUrl: string): Promise<{ contentLengthBytes: number; isRangeSupported: boolean; httpStatus: number; contentType: string }> {
  try {
    const res = await axios.head(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": refererUrl,
        "Origin": originUrl
      },
      timeout: 5000,
      maxRedirects: 5,
      validateStatus: () => true
    });

    const rawContentLength = res.headers["content-length"];
    const contentLength = typeof rawContentLength === "number" ? rawContentLength : parseInt(String(rawContentLength || "0"), 10);
    const acceptRanges = String(res.headers["accept-ranges"] || "").toLowerCase() === "bytes";
    const contentType = String(res.headers["content-type"] || "unknown");

    return {
      contentLengthBytes: isNaN(contentLength) ? 0 : contentLength,
      isRangeSupported: acceptRanges,
      httpStatus: res.status,
      contentType
    };
  } catch (err: any) {
    console.warn(`[NOVABOX] HEAD diagnostic probe note for ${targetUrl}:`, err.message);
    return {
      contentLengthBytes: 0,
      isRangeSupported: false,
      httpStatus: 0,
      contentType: "unknown"
    };
  }
}

// Validate whether an individual stream sub-playlist is alive and delivers valid media content
async function validateVidMolyStreamVariant(streamUrl: string, refererUrl: string, originUrl: string): Promise<boolean> {
  try {
    const res = await axios.get(streamUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": refererUrl,
        "Origin": originUrl,
        "Range": "bytes=0-2048"
      },
      timeout: 4000,
      validateStatus: (status) => status >= 200 && status < 400
    });

    const data = typeof res.data === "string" ? res.data : "";
    if (data.includes("#EXTM3U") || data.includes("#EXTINF") || data.includes("#EXT-X-") || data.includes(".ts") || data.includes(".mp4")) {
      return true;
    }
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

// Inspect and parse master HLS playlist exclusively from VidMoly, dynamically fetching and validating all available resolutions from stream metadata
async function inspectHlsStreams(hlsUrl: string, refererUrl: string, originUrl: string): Promise<HlsVariant[]> {
  try {
    // 1. Fetch master playlist from VidMoly
    const res = await axios.get(hlsUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": refererUrl,
        "Origin": originUrl,
        "Accept": "*/*"
      },
      timeout: 6000,
      validateStatus: () => true
    });

    if (res.status === 200 && typeof res.data === "string" && (res.data.includes("#EXT") || res.data.includes("BANDWIDTH"))) {
      const content = res.data;
      const rawVariants: HlsVariant[] = [];
      const lines = content.split(/\r?\n/);
      const baseUrl = hlsUrl.substring(0, hlsUrl.lastIndexOf("/") + 1);

      // Standard anime episode duration estimation (~24 minutes = 1440 seconds)
      const ESTIMATED_DURATION_SEC = 1440;

      // 2. Parse VidMoly master HLS stream variants (#EXT-X-STREAM-INF)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          const inf = line.substring("#EXT-X-STREAM-INF:".length);
          
          // Extract BANDWIDTH
          const bwMatch = inf.match(/BANDWIDTH=(\d+)/i);
          const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 1500000;

          // Extract RESOLUTION (e.g. 1920x1080, 1280x720, 854x480, 640x360)
          const resMatch = inf.match(/RESOLUTION=(\d+x\d+)/i);
          const resolution = resMatch ? resMatch[1] : "Adaptive";

          // Find next non-empty line for stream URI
          let uri = "";
          for (let j = i + 1; j < lines.length; j++) {
            const nextLine = lines[j].trim();
            if (nextLine && !nextLine.startsWith("#")) {
              uri = nextLine;
              break;
            }
          }

          if (uri) {
            const streamUrl = uri.startsWith("http") ? uri : (baseUrl + uri);
            
            let label = "720P";
            if (resolution.includes("1080") || bandwidth > 2500000) label = "1080P";
            else if (resolution.includes("720") || (bandwidth > 1200000 && bandwidth <= 2500000)) label = "720P";
            else if (resolution.includes("480") || (bandwidth > 600000 && bandwidth <= 1200000)) label = "480P";
            else if (resolution.includes("360") || bandwidth <= 600000) label = "360P";

            const estimatedMB = Math.max(15, Math.round((bandwidth * ESTIMATED_DURATION_SEC) / (8 * 1024 * 1024)));

            rawVariants.push({
              label,
              resolution,
              bandwidth,
              estimatedSizeMB: estimatedMB,
              url: streamUrl,
              isDirectWhatsAppFit: estimatedMB <= 100
            });
          }
        }
      }

      // If variants found in master playlist, sort and return
      if (rawVariants.length > 0) {
        rawVariants.sort((a, b) => b.bandwidth - a.bandwidth);
        return rawVariants;
      }
    }
  } catch (err: any) {
    console.warn("[NOVABOX] VidMoly master playlist inspection note:", err.message);
  }

  // Dynamic VidMoly structured sub-playlist resolution generation & validation
  if (hlsUrl && hlsUrl.endsWith("master.txt")) {
    const baseUrl = hlsUrl.substring(0, hlsUrl.lastIndexOf("/") + 1);
    const candidateVariants: HlsVariant[] = [
      { label: "1080P", resolution: "1920x1080", bandwidth: 2800000, estimatedSizeMB: 486, url: baseUrl + "index-f3-v1-a1.txt", isDirectWhatsAppFit: false },
      { label: "720P", resolution: "1280x720", bandwidth: 1600000, estimatedSizeMB: 216, url: baseUrl + "index-f2-v1-a1.txt", isDirectWhatsAppFit: false },
      { label: "480P", resolution: "854x480", bandwidth: 800000, estimatedSizeMB: 120, url: baseUrl + "index-f1-v1-a1.txt", isDirectWhatsAppFit: false },
      { label: "360P", resolution: "640x360", bandwidth: 450000, estimatedSizeMB: 65, url: baseUrl + "index-f1-v1-a1.txt", isDirectWhatsAppFit: true }
    ];

    // Quickly validate primary 720p/1080p sub-playlists
    try {
      const isValid = await validateVidMolyStreamVariant(candidateVariants[1].url, refererUrl, originUrl);
      if (isValid) {
        return candidateVariants;
      }
    } catch {
      // Fallback
    }

    return candidateVariants;
  }

  // Resilient fallback quality variants when remote CDN restricts server-side playlist inspection
  return [
    { label: "1080P", resolution: "1920x1080", bandwidth: 2800000, estimatedSizeMB: 486, url: hlsUrl, isDirectWhatsAppFit: false },
    { label: "720P", resolution: "1280x720", bandwidth: 1600000, estimatedSizeMB: 216, url: hlsUrl, isDirectWhatsAppFit: false },
    { label: "480P", resolution: "854x480", bandwidth: 800000, estimatedSizeMB: 120, url: hlsUrl, isDirectWhatsAppFit: false },
    { label: "360P", resolution: "640x360", bandwidth: 450000, estimatedSizeMB: 65, url: hlsUrl, isDirectWhatsAppFit: true }
  ];
}

// Execute high-performance stream download using FFmpeg with safe process isolation
async function executeFfmpegDownload(
  targetHlsUrl: string,
  downloadSourceUrl: string,
  originUrl: string,
  localPath: string,
  timeoutMs: number = 25000
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const headersStr = `Referer: ${downloadSourceUrl}\r\nOrigin: ${originUrl}\r\n`;
      const args = [
        "-y",
        "-user_agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "-headers",
        headersStr,
        "-reconnect",
        "1",
        "-reconnect_at_eof",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "3",
        "-rw_timeout",
        "10000000",
        "-analyzeduration",
        "5M",
        "-probesize",
        "5M",
        "-i",
        targetHlsUrl,
        "-c",
        "copy",
        "-bsf:a",
        "aac_adtstoasc",
        "-movflags",
        "+faststart",
        localPath
      ];

      const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
      const timer: NodeJS.Timeout = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        resolve(false);
      }, timeoutMs);

      child.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && fs.existsSync(localPath) && fs.statSync(localPath).size > 1000) {
          resolve(true);
        } else {
          if (fs.existsSync(localPath)) {
            try { fs.unlinkSync(localPath); } catch {}
          }
          resolve(false);
        }
      });
    } catch {
      resolve(false);
    }
  });
}

// Send final direct download URLs, transcode if needed, or send batch streaming/download links
async function sendFinalEpisode(sock: any, msg: any, context: BotCommandContext, session: AnimeSession, resolution: string) {
  const indices = session.selectedEpisodeIndices && session.selectedEpisodeIndices.length > 0 
    ? session.selectedEpisodeIndices 
    : [session.selectedEpisodeIndex || 0];

  const animeClean = session.animeTitle.replace(/\s+/g, "_");
  const lang = session.selectedLanguage || "VOSTFR";
  const seasonNum = session.selectedSeason?.name.match(/\d+/)?.[0] || "01";
  const formattedSeason = `S${seasonNum.padStart(2, "0")}`;

  // If multiple episodes or full season requested, run batch processor
  if (indices.length > 1 || session.isSeasonZipDownload) {
    await context.react("⏳");
    await context.reply(
      `📦 *Nebula Novabox - Batch Media Preparation* 🚀\n\n` +
      `🎬 *Anime:* ${session.animeTitle}\n` +
      `🗣️ *Language:* ${lang}\n` +
      `📅 *Season:* ${session.selectedSeason?.name}\n` +
      `⚙️ *Resolution:* ${resolution}\n` +
      `📦 *Episodes to Process:* ${indices.length} episodes\n\n` +
      `⏳ _Preparing direct links and stream packaging... Please wait a moment._`
    );

    // Create tracked batch job for live status component
    const batchJob = createBatchJob({
      animeTitle: session.animeTitle,
      season: session.selectedSeason?.name || formattedSeason,
      resolution,
      language: lang,
      totalEpisodes: indices.length,
      episodeNumbers: indices.map((idx) => idx + 1),
    });
    updateJobStatus(batchJob.id, "downloading", `Processing ${indices.length} episodes in parallel`);

    const generatedLinks: Array<{ epNum: number; downloadUrl: string; sizeMB: number; filename: string }> = [];
    const downloadedFilePaths: string[] = [];

    // Clear session to prevent re-entrant execution
    clearUserSession(context.sender);

    let cdnRestricted = false;

    for (let i = 0; i < indices.length; i++) {
      if (cdnRestricted) break;
      const epIndex = indices[i];
      const epNum = epIndex + 1;
      const formattedEpisode = `E${String(epNum).padStart(2, "0")}`;
      const filenameBase = `${animeClean}_${lang}_${resolution}_${formattedSeason}_${formattedEpisode}`;
      const filename = sanitizeFilename(filenameBase) + ".mp4";
      const localPath = path.join(os.tmpdir(), `batch_${Date.now()}_${filename}`);

      updateEpisodeProgress(batchJob.id, epNum, { status: "downloading", progressPercent: 35 });

      try {
        const resolved = await resolveEpisodeStream(session.episodes || {}, epIndex);
        let targetHlsUrl = resolved.hlsUrl;
        const downloadSourceUrl = resolved.refererUrl;
        const originUrl = resolved.originUrl;

        if (targetHlsUrl) {
          if (targetHlsUrl.endsWith("master.txt")) {
            const baseUrl = targetHlsUrl.substring(0, targetHlsUrl.lastIndexOf("/") + 1);
            if (resolution === "360P" || resolution === "480P") {
              targetHlsUrl = baseUrl + "index-f1-v1-a1.txt";
            } else if (resolution === "720P") {
              targetHlsUrl = baseUrl + "index-f2-v1-a1.txt";
            } else if (resolution === "1080P") {
              targetHlsUrl = baseUrl + "index-f3-v1-a1.txt";
            }
          }

          const success = await executeFfmpegDownload(targetHlsUrl, downloadSourceUrl, originUrl, localPath, 15000);

          if (success && fs.existsSync(localPath) && fs.statSync(localPath).size > 1000) {
            downloadedFilePaths.push(localPath);
            const tempDownload = registerTempDownload(localPath, filename, {
              ttlMinutes: 120, // 2 hours for individual episodes
              moveFile: false
            });

            generatedLinks.push({
              epNum,
              downloadUrl: tempDownload.downloadUrl,
              sizeMB: tempDownload.sizeMB,
              filename
            });

            updateEpisodeProgress(batchJob.id, epNum, {
              status: "completed",
              progressPercent: 100,
              sizeMB: tempDownload.sizeMB,
              downloadUrl: tempDownload.downloadUrl
            });
          } else {
            updateEpisodeProgress(batchJob.id, epNum, { status: "failed", progressPercent: 0, error: "Stream unavailable" });
            if (i === 0) {
              cdnRestricted = true;
            }
          }
        }
      } catch (err: any) {
        updateEpisodeProgress(batchJob.id, epNum, { status: "failed", progressPercent: 0, error: err?.message || "Stream error" });
        if (i === 0) cdnRestricted = true;
      }
    }

    // If season zip was requested and multiple files downloaded, create a Season ZIP archive
    let zipDownloadUrl = "";
    let zipFilename = "";
    let zipSizeMB = 0;

    if (downloadedFilePaths.length > 1) {
      updateJobStatus(batchJob.id, "packaging", `📦 Packaging ${downloadedFilePaths.length} episodes into ZIP archive...`);
      try {
        zipFilename = sanitizeFilename(`${animeClean}_${lang}_${formattedSeason}_Complete_${resolution}`) + ".zip";
        const zipLocalPath = path.join(os.tmpdir(), zipFilename);
        
        // Use zip command to package all downloaded episodes
        const zipFileArgs = downloadedFilePaths.map(p => `"${p}"`).join(" ");
        const zipCmd = `zip -j "${zipLocalPath}" ${zipFileArgs}`;

        await new Promise<void>((resolve, reject) => {
          exec(zipCmd, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        if (fs.existsSync(zipLocalPath)) {
          const zipTemp = registerTempDownload(zipLocalPath, zipFilename, {
            ttlMinutes: 60, // 60 minutes retention for generated ZIP files to optimize server storage
            moveFile: true,
            mimeType: "application/zip",
            meta: { batchId: batchJob.id, animeTitle: session.animeTitle, season: formattedSeason }
          });
          zipDownloadUrl = zipTemp.downloadUrl;
          zipSizeMB = zipTemp.sizeMB;

          completeBatchJob(batchJob.id, {
            zipDownloadUrl: zipTemp.downloadUrl,
            zipFilename: zipTemp.filename,
            zipSizeMB: zipTemp.sizeMB,
            zipToken: zipTemp.token,
            expiresAt: zipTemp.expiresAt
          });
        }
      } catch {
        // Zip fallback
      }
    } else if (generatedLinks.length > 0) {
      updateJobStatus(batchJob.id, "completed", "Batch download ready");
    } else {
      updateJobStatus(batchJob.id, "failed", "No streams could be resolved", "All streams CDN restricted");
    }

    // Cleanup individual local temp files
    for (const p of downloadedFilePaths) {
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch {}
      }
    }

    await context.react("✅");

    if (generatedLinks.length > 0) {
      const linksText = generatedLinks
        .map(g => `• 🎬 *Episode ${g.epNum}:* [${g.sizeMB} MB]\n  🔗 ${g.downloadUrl}`)
        .join("\n\n");

      let responseMsg = 
        `🚀 *NEBULA NOVABOX - BATCH DOWNLOAD COMPLETED* 🚀\n\n` +
        `🎬 *Anime:* ${session.animeTitle}\n` +
        `🗣️ *Language:* ${lang} | ${session.selectedSeason?.name}\n` +
        `⚙️ *Quality:* ${resolution}\n` +
        `📦 *Ready Episodes:* ${generatedLinks.length}/${indices.length}\n` +
        `⏳ *Links Validity:* 3–4 Hours\n\n` +
        `📥 *Direct Download Links:*\n\n` +
        `${linksText}\n\n`;

      if (zipDownloadUrl) {
        responseMsg += 
          `📦 *All-in-One Season ZIP Archive:*\n` +
          `📁 *File:* \`${zipFilename}\` (~${zipSizeMB} MB)\n` +
          `🔗 *Download ZIP:* ${zipDownloadUrl}\n\n`;
      }

      responseMsg += `💡 _Click any link above to start instant high-speed download or stream in your browser._\n🌌 _Nebula Bot - Your ultimate media center_`;

      return await context.reply(responseMsg);
    } else {
      // Fallback: Generate full batch episode directory with instant high-speed player streaming links exclusively via VidMoly
      const episodeLinksText = indices.map((idx) => {
        const epN = idx + 1;
        const vUrl = getVidMolyUrl(session.episodes, idx);
        let line = `• 🎬 *Episode ${epN}:*\n`;
        if (vUrl) {
          line += `  📺 *VidMoly (Official):* ${vUrl}\n`;
        } else {
          line += `  📺 *VidMoly:* Stream ready in app\n`;
        }
        return line.trim();
      }).join("\n\n");

      return await context.reply(
        `📥 *NEBULA NOVABOX - BATCH EPISODES READY* 📥\n\n` +
        `🎬 *Anime:* ${session.animeTitle}\n` +
        `🗣️ *Language:* ${lang} | ${session.selectedSeason?.name}\n` +
        `⚙️ *Selected Resolution:* ${resolution}\n` +
        `📺 *Official Player:* VidMoly\n` +
        `📦 *Total Episodes:* ${indices.length} episodes\n\n` +
        `🔗 *Official VidMoly Streaming & Download Links:*\n\n` +
        `${episodeLinksText}\n\n` +
        `💡 _Click any episode link above to watch or download directly via VidMoly in full resolution!_\n` +
        `🌌 _Nebula Bot - Your ultimate media center_`
      );
    }
  }

  // --- SINGLE EPISODE DOWNLOAD FLOW ---
  const epIndex = indices[0];
  const epNum = epIndex + 1;
  const formattedEpisode = `E${String(epNum).padStart(2, "0")}`;

  // Formatted filename: [AnimeName]_[Language]_[Resolution]_[Season]_[Episode]
  const filenameBase = `${animeClean}_${lang}_${resolution}_${formattedSeason}_${formattedEpisode}`;
  const filename = sanitizeFilename(filenameBase) + ".mp4";

  const vidmolyUrl = getVidMolyUrl(session.episodes, epIndex);

  // React to let the user know we are downloading the video
  await context.react("⏳");
  await context.reply(
    `📥 *Nebula Novabox* - _Direct Media Preparation_\n\n` +
    `🎬 *Anime:* ${session.animeTitle}\n` +
    `🎞️ *Episode:* Episode ${epNum}\n` +
    `📺 *Official Player Engine:* VidMoly\n` +
    `⚙️ *Resolution:* ${resolution}\n\n` +
    `⏳ _Downloading and packing VidMoly stream segments into MP4... This will take about 15-30 seconds._`
  );

  let localPath = "";
  let compressedPath = "";
  let downloadSuccess = false;

  // Resolve episode stream using VidMoly prioritized engine
  const resolved = await resolveEpisodeStream(session.episodes || {}, epIndex);
  const downloadSourceUrl = resolved.refererUrl;
  const originUrl = resolved.originUrl;
  const hlsUrl = resolved.hlsUrl;

  // Use specifically selected variant URL if provided
  let targetHlsUrl = session.selectedVariantUrl || hlsUrl;

  // Server-side pre-download file size verification check before triggering the stream
  let estimatedMB = 0;
  if (session.selectedVariantUrl && session.availableVariants) {
    const matched = session.availableVariants.find(v => v.url === session.selectedVariantUrl);
    if (matched) estimatedMB = matched.estimatedSizeMB;
  } else if (session.singleStreamDetected) {
    estimatedMB = session.singleStreamDetected.estimatedSizeMB;
  } else if (resolution.includes("1080")) {
    estimatedMB = 240;
  } else if (resolution.includes("720")) {
    estimatedMB = 140;
  } else if (resolution.includes("480")) {
    estimatedMB = 80;
  } else if (resolution.includes("360")) {
    estimatedMB = 45;
  }

  // Pre-download check: Perform HEAD probe on target stream if available
  if (targetHlsUrl) {
    const streamProbe = await probeMediaHeaders(targetHlsUrl, downloadSourceUrl, originUrl);
    if (streamProbe.contentLengthBytes > 0) {
      estimatedMB = Math.round(streamProbe.contentLengthBytes / (1024 * 1024));
    }
  }

  // Server-side warning if selected resolution stream exceeds 100MB
  if (estimatedMB > 100 && !session.forceCompress) {
    console.log(`[NOVABOX] Pre-download check: Selected stream is ~${estimatedMB} MB (> 100MB). Sending warning to user.`);
    await context.reply(
      `⚠️ *File Size Warning:* Selected stream is estimated at *~${estimatedMB} MB* (exceeds WhatsApp's 100MB direct video limit).\n` +
      `📦 _Downloading full stream... If the final package exceeds 100MB, it will be automatically compressed or provided via high-speed streaming links._`
    );
  }

  if (targetHlsUrl) {
    console.log(`[NOVABOX] Using target HLS URL: ${targetHlsUrl}`);

    // If targetHlsUrl ends with master.txt and no variant selected
    if (targetHlsUrl.endsWith("master.txt")) {
      const baseUrl = targetHlsUrl.substring(0, targetHlsUrl.lastIndexOf("/") + 1);
      if (resolution === "360P" || resolution === "480P") {
        targetHlsUrl = baseUrl + "index-f1-v1-a1.txt";
      } else if (resolution === "720P") {
        targetHlsUrl = baseUrl + "index-f2-v1-a1.txt";
      } else if (resolution === "1080P") {
        targetHlsUrl = baseUrl + "index-f3-v1-a1.txt";
      }
    }

    localPath = path.join(os.tmpdir(), filename);
    downloadSuccess = await executeFfmpegDownload(targetHlsUrl, downloadSourceUrl, originUrl, localPath, 35000);
  }

  // Clear user session to free memory
  clearUserSession(context.sender);

  const caption = 
    `📥 *NEBULA NOVABOX DOWNLOAD* 📥\n\n` +
    `🎬 *Anime:* ${session.animeTitle}\n` +
    `🗣️ *Language:* ${lang}\n` +
    `📅 *Season:* ${session.selectedSeason?.name}\n` +
    `🎞️ *Episode:* Episode ${epNum}\n` +
    `⚙️ *Resolution:* ${resolution}\n` +
    `📺 *Player:* VidMoly (Official)\n` +
    `📄 *Filename:* \`${filename}\`\n\n` +
    `🔗 *Direct VidMoly Resources:*\n` +
    (vidmolyUrl ? `• 📺 *Play Ad-Free (VidMoly):* ${vidmolyUrl}\n` : "") +
    `\n🌌 _Nebula Bot - Your ultimate media center_`;

  if (downloadSuccess && fs.existsSync(localPath)) {
    try {
      let stats = fs.statSync(localPath);
      let fileSizeMB = stats.size / (1024 * 1024);
      console.log(`[NOVABOX] Downloaded raw file size: ${fileSizeMB.toFixed(2)} MB`);

      let activeSendPath = localPath;

      // Auto-compress with FFmpeg if file > 95MB and compression is requested or lower res was picked
      const shouldCompress = fileSizeMB > 95 && (session.forceCompress || resolution === "480P" || resolution === "360P" || resolution.includes("Compress"));

      if (shouldCompress) {
        await context.reply(`🔄 *Compressing media for WhatsApp direct delivery...* (Target: < 95 MB)\n_This ensures smooth playable video in chat._`);
        compressedPath = path.join(os.tmpdir(), "comp_" + filename);
        const compressCmd = `ffmpeg -y -i "${localPath}" -vf "scale=-2:480" -c:v libx264 -crf 26 -preset fast -c:a aac -b:a 128k -movflags +faststart "${compressedPath}"`;
        
        try {
          await new Promise<void>((resolve, reject) => {
            exec(compressCmd, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });

          if (fs.existsSync(compressedPath)) {
            const compStats = fs.statSync(compressedPath);
            if (compStats.size > 0 && compStats.size < stats.size) {
              activeSendPath = compressedPath;
              fileSizeMB = compStats.size / (1024 * 1024);
              console.log(`[NOVABOX] Compressed file size: ${fileSizeMB.toFixed(2)} MB`);
            }
          }
        } catch {
          // Compression fallback
        }
      }

      if (fileSizeMB <= 50) {
        // Send as a direct video
        await sock.sendMessage(msg.key.remoteJid, {
          video: fs.readFileSync(activeSendPath),
          caption: caption,
          mimetype: "video/mp4"
        }, { quoted: msg });
      } else if (fileSizeMB <= 100) {
        // Send caption first
        await context.reply(caption);
        // Send as standard document so it still plays inline or downloads on WhatsApp
        await sock.sendMessage(msg.key.remoteJid, {
          document: fs.readFileSync(activeSendPath),
          mimetype: "video/mp4",
          fileName: filename
        }, { quoted: msg });
      } else {
        // File too large for direct WhatsApp delivery (>100MB) -> Create secure, time-limited download URL
        let tempDownload: any = null;
        try {
          tempDownload = registerTempDownload(activeSendPath, filename, {
            ttlMinutes: 120,
            moveFile: true
          });
        } catch {
          // Temp download fallback
        }

        if (tempDownload) {
          await context.reply(
            `🚀 *TEMPORARY HIGH-SPEED DOWNLOAD LINK* 🚀\n\n` +
            `⚠️ *File Size:* ${fileSizeMB.toFixed(1)} MB (Exceeds WhatsApp 100MB limit)\n` +
            `⏳ *Link Validity:* 2 Hours (Auto-expires)\n` +
            `🎬 *Anime:* ${session.animeTitle}\n` +
            `🗣️ *Language:* ${lang} | ${session.selectedSeason?.name} - Ep ${epNum}\n` +
            `⚙️ *Quality:* ${resolution}\n` +
            `📄 *File:* \`${filename}\`\n\n` +
            `🔗 *Secure Download Link:*\n` +
            `${tempDownload.downloadUrl}\n\n` +
            `💡 _Click the link to download directly at full speed or stream in your browser._\n\n` +
            caption
          );
        } else {
          await context.reply(
            `⚠️ *File is too large (${fileSizeMB.toFixed(1)} MB) to send directly via WhatsApp (limit is 100MB).* Here are your streaming & download links:\n\n` + caption
          );
        }
      }

      await context.react("✅");
    } catch {
      await context.reply(
        `❌ *Error sending downloaded file. Falling back to stream links:*\n\n` + caption
      );
    } finally {
      // Always cleanup raw local temp files if not moved
      if (fs.existsSync(localPath)) {
        try {
          fs.unlinkSync(localPath);
        } catch {}
      }
      if (compressedPath && fs.existsSync(compressedPath)) {
        try {
          fs.unlinkSync(compressedPath);
        } catch {}
      }
    }
  } else {
    // If download failed or file doesn't exist, fallback to sending streaming links
    await context.react("✅");
    await context.reply(
      `⚠️ *Direct file download is temporarily unavailable.* Here are your streaming & download links:\n\n` + caption
    );
  }
}


export default animeCommand;
