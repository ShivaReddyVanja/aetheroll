#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const mobilePackageJsonPath = path.join(rootDir, "apps", "mobile", "package.json");

function runGit(command) {
  try {
    return execSync(`git ${command}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function parseSemVer(versionStr) {
  const clean = versionStr.replace(/^[^\d]*/, "");
  const parts = clean.split(".").map((p) => parseInt(p, 10));
  return {
    major: isNaN(parts[0]) ? 1 : parts[0],
    minor: isNaN(parts[1]) ? 0 : parts[1],
    patch: isNaN(parts[2]) ? 0 : parts[2],
  };
}

function formatSemVer({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

export function readReleaseNotesFromFile() {
  const possiblePaths = [
    path.join(rootDir, "RELEASE_NOTES.md"),
    path.join(rootDir, "apps", "mobile", "RELEASE_NOTES.md"),
    path.join(rootDir, "RELEASE_NOTES.txt"),
  ];

  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const lines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("<!--") && !l.startsWith("//"))
        .map((l) => l.replace(/^[-*•\s]+/, "").trim())
        .filter(Boolean);

      if (lines.length > 0) {
        return lines;
      }
    }
  }
  return null;
}

export function fallbackFormatCommits(commits) {
  const notes = [];
  const seen = new Set();

  for (const raw of commits) {
    const cleaned = raw
      .replace(/^[-*•\s]+/, "")
      .replace(/\s*\([a-f0-9]{7,}\)$/i, "")
      .trim();

    if (!cleaned) continue;
    if (/^(merge|chore|ci|test|bump|style|refactor\(internal\))/i.test(cleaned)) continue;

    let formatted = "";
    if (/^feat(\(.*\))?:\s*/i.test(cleaned)) {
      const desc = cleaned.replace(/^feat(\(.*\))?:\s*/i, "").trim();
      formatted = `${desc.charAt(0).toUpperCase() + desc.slice(1)}`;
    } else if (/^fix(\(.*\))?:\s*/i.test(cleaned)) {
      const desc = cleaned.replace(/^fix(\(.*\))?:\s*/i, "").trim();
      formatted = `${desc.charAt(0).toUpperCase() + desc.slice(1)}`;
    } else if (/^(perf|fast)(\(.*\))?:\s*/i.test(cleaned)) {
      const desc = cleaned.replace(/^(perf|fast)(\(.*\))?:\s*/i, "").trim();
      formatted = `${desc.charAt(0).toUpperCase() + desc.slice(1)}`;
    } else if (/^refactor(\(.*\))?:\s*/i.test(cleaned)) {
      const desc = cleaned.replace(/^refactor(\(.*\))?:\s*/i, "").trim();
      formatted = `${desc.charAt(0).toUpperCase() + desc.slice(1)}`;
    } else {
      formatted = `${cleaned.charAt(0).toUpperCase() + cleaned.slice(1)}`;
    }

    if (!seen.has(formatted.toLowerCase())) {
      seen.add(formatted.toLowerCase());
      notes.push(formatted);
    }

    if (notes.length >= 4) break;
  }

  return notes.length > 0 ? notes : ["General performance improvements and bug fixes"];
}

export function determineNextVersion(options = {}) {
  const { customVersion, bumpType, runNumber } = options;

  // 1. Get latest git tag
  const allTagsOutput = runGit("tag -l 'v*'");
  const tags = allTagsOutput
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);

  let latestVersion = { major: 1, minor: 0, patch: 0 };
  let latestTag = "";

  if (tags.length > 0) {
    // Sort semver tags descending
    const sorted = tags
      .map((tag) => ({ tag, semver: parseSemVer(tag) }))
      .sort((a, b) => {
        if (a.semver.major !== b.semver.major) return b.semver.major - a.semver.major;
        if (a.semver.minor !== b.semver.minor) return b.semver.minor - a.semver.minor;
        return b.semver.patch - a.semver.patch;
      });

    latestTag = sorted[0].tag;
    latestVersion = sorted[0].semver;
  }

  let nextVersion = { ...latestVersion };

  if (customVersion) {
    nextVersion = parseSemVer(customVersion);
  } else if (bumpType === "major") {
    nextVersion.major += 1;
    nextVersion.minor = 0;
    nextVersion.patch = 0;
  } else if (bumpType === "minor") {
    nextVersion.minor += 1;
    nextVersion.patch = 0;
  } else if (bumpType === "patch") {
    nextVersion.patch += 1;
  } else {
    // Auto-detect from commit messages since latest tag (or last 20 commits if no tag)
    const logRange = latestTag ? `${latestTag}..HEAD` : "-n 20";
    const commitLogs = runGit(`log ${logRange} --pretty=format:"%s"`);

    let isMajor = false;
    let isMinor = false;

    if (commitLogs) {
      for (const line of commitLogs.split("\n")) {
        const msg = line.trim();
        if (/^(\w+)(\(.*\))?!:/.test(msg) || /BREAKING CHANGE/i.test(msg)) {
          isMajor = true;
          break;
        }
        if (/^feat(\(.*\))?:/i.test(msg)) {
          isMinor = true;
        }
      }
    }

    if (tags.length === 0) {
      nextVersion = { major: 1, minor: 0, patch: 0 };
    } else if (isMajor) {
      nextVersion.major += 1;
      nextVersion.minor = 0;
      nextVersion.patch = 0;
    } else if (isMinor) {
      nextVersion.minor += 1;
      nextVersion.patch = 0;
    } else {
      nextVersion.patch += 1;
    }
  }

  const versionString = formatSemVer(nextVersion);
  const tagName = `v${versionString}`;

  // VersionCode computation
  let versionCode = 1;
  if (runNumber && !isNaN(parseInt(runNumber, 10))) {
    versionCode = parseInt(runNumber, 10);
  } else {
    const commitCount = parseInt(runGit("rev-list --count HEAD") || "1", 10);
    versionCode = Math.max(1, commitCount);
  }

  // Release notes: Read directly from curated RELEASE_NOTES.md, with fallback to commits
  const fileNotes = readReleaseNotesFromFile();
  let releaseNotesArray = [];

  if (fileNotes && fileNotes.length > 0) {
    releaseNotesArray = fileNotes;
  } else {
    const logRange = latestTag ? `${latestTag}..HEAD` : "-n 15";
    const rawCommits = runGit(`log ${logRange} --pretty=format:"%s"`);
    const commitLines = rawCommits ? rawCommits.split("\n").map((c) => c.trim()).filter(Boolean) : [];
    releaseNotesArray = fallbackFormatCommits(commitLines);
  }

  const releaseNotesMarkdown = releaseNotesArray.map((line) => `- ${line.replace(/^[-*•\s]+/, "")}`).join("\n");

  return {
    previousTag: latestTag || "none",
    version: versionString,
    tag: tagName,
    versionCode,
    releaseNotes: releaseNotesMarkdown,
    releaseNotesArray,
  };
}

// CLI Execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let customVersion = null;
  let bumpType = null;
  let syncPackage = false;
  let writeGithubOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--custom" && args[i + 1]) {
      customVersion = args[++i];
    } else if (args[i] === "--type" && args[i + 1]) {
      bumpType = args[++i];
    } else if (args[i] === "--sync-package") {
      syncPackage = true;
    } else if (args[i] === "--github-output") {
      writeGithubOutput = true;
    }
  }

  const runNumber = process.env.GITHUB_RUN_NUMBER || null;
  const result = determineNextVersion({ customVersion, bumpType, runNumber });

  console.log(JSON.stringify(result, null, 2));

  if (syncPackage && fs.existsSync(mobilePackageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(mobilePackageJsonPath, "utf8"));
      pkg.version = result.version;
      fs.writeFileSync(mobilePackageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
      console.log(`Updated ${mobilePackageJsonPath} to version ${result.version}`);
    } catch (err) {
      console.error(`Failed to update mobile package.json:`, err);
    }
  }

  if (writeGithubOutput && process.env.GITHUB_OUTPUT) {
    const delimiter = `EOF_RELEASE_NOTES_${Date.now()}`;
    const outputContent = [
      `version=${result.version}`,
      `tag=${result.tag}`,
      `version_code=${result.versionCode}`,
      `previous_tag=${result.previousTag}`,
      `release_notes<<${delimiter}\n${result.releaseNotes}\n${delimiter}`,
      `release_notes_json=${JSON.stringify(result.releaseNotesArray)}`,
    ].join("\n");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, outputContent + "\n");
  }
}
