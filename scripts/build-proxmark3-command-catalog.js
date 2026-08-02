#!/usr/bin/env node
/* Builds the local, source-attributed Proxmark3 command catalogue. */
const fs = require("fs");
const path = require("path");

const workspace = path.resolve(__dirname, "..");
const input = process.env.PM3_COMMAND_DOC || path.resolve(workspace, "..", "proxmark3-iceman-device-studio", "doc", "commands.md");
const output = path.join(workspace, "renderer", "devices", "proxmark3", "iceman-command-catalog.json");

function safetyLevel(command, description) {
  const value = `${command} ${description}`.toLowerCase();
  if (/(?:\bwrite\b|\bclone\b|\brestore\b|\bwipe\b|\bsimulat|\bemulat|\bset uid\b|\bset key\b|\bset password\b|\bpersonaliz|\bformat\b|\bconfigure security\b|\btear.?off\b|\bdangerraw\b|\bincrement\b|\bdecrement\b)/.test(value)) return "restricted";
  if (/(?:\battack\b|\bbrute.?force\b|\bkey recovery\b|\brecover.*key\b|\bdictionary check\b|\bsniff\b|\bstandalone\b|\bjam\b)/.test(value)) return "advanced";
  if (/(?:\bread\b|\bshow\b|\bdisplay\b|\bprint\b|\bview\b|\bdecode\b|\blist\b|\bdump\b|\binfo\b|\bsearch\b|\bdetect\b|\bcheck\b|\bcalculat|\bgenerat|\bget\b|\btest\b)/.test(value)) return "read-only";
  return "unknown";
}

const markdown = fs.readFileSync(input, "utf8");
let section = "General";
const entries = new Map();
for (const line of markdown.split(/\r?\n/)) {
  const heading = line.match(/^###\s+(.+)\s*$/);
  if (heading) { section = heading[1].trim(); continue; }
  const row = line.match(/^\|`([^`]+)`\|([YN])\s*\|`?([^`|]*)`?\s*\|?\s*$/);
  if (!row) continue;
  const command = row[1].trim().replace(/\s+/g, " ");
  const description = row[3].trim();
  if (!command || !description || entries.has(command.toLowerCase())) continue;
  entries.set(command.toLowerCase(), {command, description, safetyLevel:safetyLevel(command, description), offlineAvailable:row[2] === "Y", section});
}
const catalogue = {
  version: 1,
  source: "RfidResearchGroup/proxmark3 doc/commands.md",
  sourceUrl: "https://github.com/RfidResearchGroup/proxmark3/blob/master/doc/commands.md",
  license: "GPL-3.0-or-later (upstream Proxmark3 documentation)",
  entries: [...entries.values()]
};
fs.writeFileSync(output, `${JSON.stringify(catalogue, null, 2)}\n`);
console.log(`Wrote ${catalogue.entries.length} source-backed command descriptions to ${output}`);
