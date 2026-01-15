import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const OUT_DIR = path.resolve("public");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function getText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "76feed-bot/1.0 (GitHub Actions)" }
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

function nowIso() {
  return new Date().toISOString();
}

function cleanLines(text) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function sliceBetween(haystack, startMarker, endMarker) {
  const start = haystack.indexOf(startMarker);
  if (start === -1) return "";
  const rest = haystack.slice(start + startMarker.length);
  const end = rest.indexOf(endMarker);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

// ---------------- SCORE (Daily + Weekly) from NukaKnights homepage ----------------
function extractChallengesFromNkHome(html) {
  const $ = cheerio.load(html);
  const bodyText = cleanLines($("body").text()).join("\n");

  const dailyBlock = sliceBetween(bodyText, "Daily Challenges", "Weekly Challenges");
  const weeklyBlock =
    sliceBetween(bodyText, "Weekly Challenges", "Daily Ops") ||
    sliceBetween(bodyText, "Weekly Challenges", "Nuke codes") ||
    sliceBetween(bodyText, "Weekly Challenges", "Minerva") ||
    "";

  return {
    daily: parseChallengePairs(dailyBlock),
    weekly: parseChallengePairs(weeklyBlock)
  };
}

function parseChallengePairs(blockText) {
  const lines = cleanLines(blockText);
  const out = [];

  for (let i = 0; i < lines.length - 1; i++) {
    const title = lines[i];
    const score = Number(lines[i + 1]);

    if (
      title.length > 6 &&
      Number.isInteger(score) &&
      score > 0 &&
      score <= 5000 &&
      !/^daily challenges$/i.test(title) &&
      !/^weekly challenges$/i.test(title)
    ) {
      out.push({ title, score });
      i++;
    }
  }
  return out;
}

// ---------------- Minerva (framework) from whereisminerva ----------------
// For now: location is best-effort; starts/ends/inventory placeholders
function extractMinervaFramework(html) {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();

  // Best-effort: look for "Location:" pattern if present
  const location =
    (text.match(/Location:\s*([^.\n\r]+?)(?:\s{2,}|\.|$)/i) || [])[1]?.trim() ||
    null;

  return {
    location,
    starts: null, // TODO: parse later
    ends: null, // TODO: parse later
    inventory: [], // TODO: parse later (items + price)
    rawSummary: text.slice(0, 300) + (text.length > 300 ? "…" : ""),
    source: "https://whereisminerva.nukaknights.com/"
  };
}

// ---------------- Nuke codes from NukaCrypt dev page (8 digits each) ----------------
function extractNukeCodes(html) {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();

  const alpha = (text.match(/Alpha\.\s*([0-9]{8})/) || [])[1] || null;
  const bravo = (text.match(/Bravo\.\s*([0-9]{8})/) || [])[1] || null;
  const charlie = (text.match(/Charlie\.\s*([0-9]{8})/) || [])[1] || null;

  // Optional: reset string (human readable)
  const resetsIn =
    (text.match(/Resets in:\s*([0-9a-z\s]+)\./i) || [])[1]?.trim() || null;

  return {
    alpha,
    bravo,
    charlie,
    resetsIn,
    source: "https://dev.nukacrypt.com/FO76/"
  };
}

function writeJson(filename, obj) {
  fs.writeFileSync(path.join(OUT_DIR, filename), JSON.stringify(obj, null, 2));
}

async function main() {
  const fetchedAt = nowIso();

  // Fetch sources
  const nkHomeHtml = await getText("https://nukaknights.com/en/");
  const minervaHtml = await getText("https://whereisminerva.nukaknights.com/");
  const nukesHtml = await getText("https://dev.nukacrypt.com/FO76/");

  // DEBUG: capture what the scraper "sees" on the NK homepage
  const $nk = cheerio.load(nkHomeHtml);
  const nkBodyTextSample = $nk("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);

  writeJson("debug_nukaknights_home.json", {
    version: 1,
    fetchedAt,
    note: "First 2000 chars of NukaKnights /en/ body text as seen by scraper",
    bodyTextSample: nkBodyTextSample,
    source: "https://nukaknights.com/en/"
  });

  // Parse
  const score = extractChallengesFromNkHome(nkHomeHtml);
  const minerva = extractMinervaFramework(minervaHtml);
  const nukes = extractNukeCodes(nukesHtml);

  // Write outputs (always)
  writeJson("score.json", {
    version: 1,
    fetchedAt,
    source: "https://nukaknights.com/en/",
    daily: score.daily,
    weekly: score.weekly
  });

  writeJson("nukecodes.json", {
    version: 1,
    fetchedAt,
    ...nukes
  });

  writeJson("minerva.json", {
    version: 1,
    fetchedAt,
    location: minerva.location,
    starts: minerva.starts,
    ends: minerva.ends,
    inventory: minerva.inventory,
    source: minerva.source,
    rawSummary: minerva.rawSummary
  });

  // Placeholders for future scraping targets (stable schema for your app)
  writeJson("dailyops.json", {
    version: 1,
    fetchedAt,
    dailyOps: null,
    source: "https://nukaknights.com/en/"
  });

  writeJson("axolotl.json", {
    version: 1,
    fetchedAt,
    axolotlOfTheMonth: null,
    source: "https://nukaknights.com/en/"
  });

  writeJson("events.json", {
    version: 1,
    fetchedAt,
    events: [],
    source: "https://nukaknights.com/en/"
  });

  // Recipes template (you’ll fill later)
  writeJson("recipes.json", {
    version: 1,
    updatedAt: fetchedAt,
    recipes: []
  });

  console.log("Feeds built into /public");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
