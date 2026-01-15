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
    .map(x => x.trim())
    .filter(Boolean);
}

function sliceBetween(haystack, startMarker, endMarker) {
  const start = haystack.indexOf(startMarker);
  if (start === -1) return "";
  const rest = haystack.slice(start + startMarker.length);
  const end = rest.indexOf(endMarker);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

// SCORE (Daily + Weekly) from NukaKnights homepage
function extractChallengesFromNkHome(html) {
  const $ = cheerio.load(html);
  const bodyText = cleanLines($("body").text()).join("\n");

  const dailyBlock = sliceBetween(bodyText, "Daily Challenges", "Weekly Challenges");
  const weeklyBlock =
    sliceBetween(bodyText, "Weekly Challenges", "Daily Ops") ||
    sliceBetween(bodyText, "Weekly Challenges", "Nuke codes") ||
    sliceBetween(bodyText, "Weekly Challenges", "Minerva");

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

// Minerva from whereisminerva
function extractMinerva(html) {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const loc = (text.match(/Location:\s*([^.\n\r]+?)(?:\s{2,}|\.|$)/i) || [])[1]?.trim() || null;

  return {
    location: loc,
    rawSummary: text.slice(0, 300) + (text.length > 300 ? "…" : ""),
    source: "https://whereisminerva.nukaknights.com/"
  };
}

// Nuke codes from NukaCrypt dev page (8 digits each)
function extractNukeCodes(html) {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();

  const alpha = (text.match(/Alpha\.\s*([0-9]{8})/) || [])[1] || null;
  const bravo = (text.match(/Bravo\.\s*([0-9]{8})/) || [])[1] || null;
  const charlie = (text.match(/Charlie\.\s*([0-9]{8})/) || [])[1] || null;
  const resetsIn = (text.match(/Resets in:\s*([0-9a-z\s]+)\./i) || [])[1]?.trim() || null;

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

  const nkHomeHtml = await getText("https://nukaknights.com/en/");
  const score = extractChallengesFromNkHome(nkHomeHtml);

  const minervaHtml = await getText("https://whereisminerva.nukaknights.com/");
  const minerva = extractMinerva(minervaHtml);

  const nukesHtml = await getText("https://dev.nukacrypt.com/FO76/");
  const nukes = extractNukeCodes(nukesHtml);

  writeJson("score.json", {
    fetchedAt,
    source: "https://nukaknights.com/en/",
    ...score
  });

  writeJson("minerva.json", {
    fetchedAt,
    ...minerva
  });

  writeJson("nukecodes.json", {
    fetchedAt,
    ...nukes
  });

  // Recipes placeholder template (you'll fill later)
  const recipesPath = path.join(OUT_DIR, "recipes.json");
  if (!fs.existsSync(recipesPath)) {
    writeJson("recipes.json", {
      version: 1,
      updatedAt: fetchedAt,
      recipes: []
    });
  }

  console.log("Feeds built into /public");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
