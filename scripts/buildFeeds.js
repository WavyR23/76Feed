import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

// Write JSON to repo ROOT (recommended since GitHub Pages is set to /(root))
const OUT_DIR = path.resolve(".");
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

function writeJson(filename, obj) {
  fs.writeFileSync(path.join(OUT_DIR, filename), JSON.stringify(obj, null, 2));
}

/**
 * Finds the REAL section header (e.g. "#### Daily Challenges") by using lastIndexOf,
 * because the page contains earlier menu links like "* Daily Challenges".
 */
function sectionBetween(bodyText, startHeader, endHeaderOptions) {
  const start = bodyText.lastIndexOf(startHeader);
  if (start === -1) return "";

  // find nearest end header after start
  let end = -1;
  for (const endHeader of endHeaderOptions) {
    const idx = bodyText.indexOf(endHeader, start + startHeader.length);
    if (idx !== -1 && (end === -1 || idx < end)) end = idx;
  }

  const slice = end === -1
    ? bodyText.slice(start + startHeader.length)
    : bodyText.slice(start + startHeader.length, end);

  return slice.trim();
}

// Parse "title line" then "score line" pattern (works with NK format)
function parseChallengePairs(blockText) {
  const lines = cleanLines(blockText);
  const out = [];

  for (let i = 0; i < lines.length - 1; i++) {
    const title = lines[i]
      .replace(/^•\s*/g, "")
      .replace(/^\*\s*/g, "")
      .trim();

    const next = lines[i + 1].trim();
    const score = Number(next);

    if (
      title.length > 3 &&
      Number.isInteger(score) &&
      score > 0 &&
      score <= 5000
    ) {
      out.push({ title, score });
      i++; // skip score line
    }
  }
  return out;
}

function extractScoreFromNkHome(html) {
  const $ = cheerio.load(html);
  const bodyText = $("body").text();

  const dailyBlock = sectionBetween(
    bodyText,
    "#### Daily Challenges",
    ["#### Weekly Challenges"]
  );

  const weeklyBlock = sectionBetween(
    bodyText,
    "#### Weekly Challenges",
    ["#### Axolotl of the month", "### Current Fallout 76 Event Calendar Dates:", "### Current Fallout 76 Event Calendar Dates"]
  );

  return {
    daily: parseChallengePairs(dailyBlock),
    weekly: parseChallengePairs(weeklyBlock)
  };
}

function extractDailyOpsFromNkHome(html) {
  const $ = cheerio.load(html);
  const lines = cleanLines($("body").text());

  // Find the "Daily Ops" section that contains "Decryption" etc.
  // We'll pick the LAST "Daily Ops" header then read the next ~15 lines.
  const indices = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase() === "daily ops") indices.push(i);
  }
  const startIdx = indices.length ? indices[indices.length - 1] : -1;
  if (startIdx === -1) return null;

  const window = lines.slice(startIdx, startIdx + 25);

  // Typical format near the section:
  // Daily Ops
  // since 14.01.2026 (12:00)
  // America/New_York
  // Daily Ops
  // since 14.01.2026 (12:00) America/New_York
  // Decryption
  // Savage Strike
  // Freezing Touch
  // Watoga High School
  // Mole Miners
  const sinceLine = window.find((l) => l.toLowerCase().startsWith("since ")) || null;
  const timezoneLine = window.find((l) => l.includes("/") && l.length < 40) || null;

  const mode = window.find((l) => ["decryption", "uplink"].includes(l.toLowerCase())) || null;

  // Mutations are usually 2 lines after mode; we’ll grab next 2 non-empty lines after mode.
  let mutations = [];
  if (mode) {
    const mIdx = window.findIndex((l) => l === mode);
    mutations = window
      .slice(mIdx + 1)
      .filter((l) => l && !l.toLowerCase().startsWith("watoga") && !l.includes("/") && !l.toLowerCase().startsWith("since"))
      .slice(0, 2);
  }

  // Location: take first line that looks like a place and isn't known labels/mutations/enemy
  const blacklist = new Set(
    ["daily ops", "decryption", "uplink", "provided by", "since"].map((s) => s.toLowerCase())
  );

  const enemyCandidates = ["mole miners", "super mutants", "robots", "blood eagles", "cultists", "feral ghouls"];
  const enemy = window.find((l) => enemyCandidates.includes(l.toLowerCase())) || null;

  // location is typically right before enemy
  let location = null;
  if (enemy) {
    const eIdx = window.findIndex((l) => l === enemy);
    location = window.slice(0, eIdx).reverse().find((l) => {
      const low = l.toLowerCase();
      if (blacklist.has(low)) return false;
      if (low.startsWith("since ")) return false;
      if (low.includes("/")) return false;
      if (enemyCandidates.includes(low)) return false;
      if (mutations.map((x) => x.toLowerCase()).includes(low)) return false;
      if (["decryption", "uplink"].includes(low)) return false;
      return l.length >= 4 && l.length <= 60;
    }) || null;
  }

  return {
    since: sinceLine,
    timezone: timezoneLine,
    mode,
    mutations,
    location,
    enemy
  };
}

function extractAxolotlFromNkHome(html) {
  const $ = cheerio.load(html);
  const bodyText = $("body").text();

  const block = sectionBetween(
    bodyText,
    "#### Axolotl of the month",
    ["### Current Fallout 76 Event Calendar Dates:", "### Current Fallout 76 Event Calendar Dates"]
  );

  const lines = cleanLines(block);

  // Typical lines:
  // January 2026
  // Charcoal Axolotl
  // Start: 6th Jan 2026 12:00
  // End: 3rd Feb 2026 11:59
  // America/New_York
  const month = lines[0] || null;
  const name = lines[1] || null;

  const start = (lines.find((l) => l.toLowerCase().startsWith("start:")) || null);
  const end = (lines.find((l) => l.toLowerCase().startsWith("end:")) || null);
  const timezone = (lines.find((l) => l.includes("/") && l.length < 40) || null);

  // extra description lines (optional)
  const description = lines
    .filter((l) => !/^start:/i.test(l) && !/^end:/i.test(l) && !(l.includes("/") && l.length < 40))
    .slice(2, 8);

  if (!month && !name) return null;

  return {
    month,
    name,
    start,
    end,
    timezone,
    description
  };
}

function extractEventsFromNkHome(html) {
  const $ = cheerio.load(html);
  const bodyText = $("body").text();

  const block = sectionBetween(
    bodyText,
    "### Current Fallout 76 Event Calendar Dates:",
    ["#### Nuka Knights Discord", "###  ", "### Nuka Knights Discord"]
  );

  const lines = cleanLines(block);

  // The event list repeats month headers, then pairs of start/end lines with event names.
  // We'll parse very defensively: look for patterns like:
  // Th, 15th Jan 2026(12:00)
  // Mo, 19th Jan 2026 (12:00)
  // Treasure Hunter and Caps-o-Plenty
  const events = [];
  const dateLineRegex = /^[A-Z][a-z],\s+\d{1,2}(st|nd|rd|th)\s+[A-Za-z]{3}\s+\d{4}.*\(\d{1,2}:\d{2}\)/;

  for (let i = 0; i < lines.length - 2; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    const c = lines[i + 2];

    if (dateLineRegex.test(a) && dateLineRegex.test(b)) {
      // c should be name (sometimes repeated twice; keep first)
      const name = c;
      events.push({
        name,
        starts: a,
        ends: b
      });
    }
  }

  // Deduplicate by name+starts
  const uniq = [];
  const seen = new Set();
  for (const e of events) {
    const key = `${e.name}||${e.starts}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(e);
    }
  }

  return uniq;
}

// ---------------- Minerva (framework) from whereisminerva ----------------
function extractMinervaFramework(html) {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();

  const location =
    (text.match(/Location:\s*([^.\n\r]+?)(?:\s{2,}|\.|$)/i) || [])[1]?.trim() ||
    null;

  return {
    location,
    starts: null,     // TODO later
    ends: null,       // TODO later
    inventory: [],    // TODO later
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

async function main() {
  const fetchedAt = nowIso();

  // Fetch sources
  const nkHomeHtml = await getText("https://nukaknights.com/en/");
  const minervaHtml = await getText("https://whereisminerva.nukaknights.com/");
  const nukesHtml = await getText("https://dev.nukacrypt.com/FO76/");

  // Parse
  const score = extractScoreFromNkHome(nkHomeHtml);
  const dailyOps = extractDailyOpsFromNkHome(nkHomeHtml);
  const axolotl = extractAxolotlFromNkHome(nkHomeHtml);
  const events = extractEventsFromNkHome(nkHomeHtml);

  const minerva = extractMinervaFramework(minervaHtml);
  const nukes = extractNukeCodes(nukesHtml);

  // Write outputs
  writeJson("score.json", {
    version: 1,
    fetchedAt,
    source: "https://nukaknights.com/en/",
    daily: score.daily,
    weekly: score.weekly
  });

  writeJson("dailyops.json", {
    version: 1,
    fetchedAt,
    source: "https://nukaknights.com/en/",
    dailyOps: dailyOps
  });

  writeJson("axolotl.json", {
    version: 1,
    fetchedAt,
    source: "https://nukaknights.com/en/",
    axolotlOfTheMonth: axolotl
  });

  writeJson("events.json", {
    version: 1,
    fetchedAt,
    source: "https://nukaknights.com/en/",
    events
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

  writeJson("recipes.json", {
    version: 1,
    updatedAt: fetchedAt,
    recipes: []
  });

  console.log("Feeds built into repo root");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
