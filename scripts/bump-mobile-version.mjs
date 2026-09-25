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

function formatCleanCommitList(rawCommitLogs) {
  if (!rawCommitLogs) return "";
  const lines = rawCommitLogs.split("\n").map((l) => l.trim()).filter(Boolean);
  const formattedLines = [];

  for (const line of lines) {
    // Ignore chore, ci, test, merge commits
    if (/^-( )?(chore|ci|test|build|refactor\(internal\))(\(.*\))?:/i.test(line)) continue;
    if (/^-( )?Merge (branch|pull request)/i.test(line)) continue;

    // Clean up conventional commit prefixes for public display
    let cleaned = line
      .replace(/^-( )?feat(\([^)]+\))?:\s*/i, "- New: ")
      .replace(/^-( )?fix(\([^)]+\))?:\s*/i, "- Fixed: ")
      .replace(/^-( )?perf(\([^)]+\))?:\s*/i, "- Improved: ")
      .replace(/^-( )?docs(\([^)]+\))?:\s*/i, "- Docs: ");

    // Remove commit hashes at the end like (a752881)
    cleaned = cleaned.replace(/\s*\([a-f0-9]{7,10}\)$/i, "");

    // Capitalize first letter after dash
    if (cleaned.startsWith("- ")) {
      cleaned = "- " + cleaned.slice(2).charAt(0).toUpperCase() + cleaned.slice(3);
    }

    if (cleaned && !formattedLines.includes(cleaned)) {
      formattedLines.push(cleaned);
    }
  }

  return formattedLines.join("\n");
}

export function determineNextVersion(options = {}) {
  const { customVersion, bumpType, runNumber, customNotes, notesFile } = options;

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
      // If no tag ever existed, start at 1.0.0
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

  // ── Determine Release Notes ──
  let releaseNotes = "";

  // Priority 1: Explicit customNotes passed as string
  if (customNotes && customNotes.trim()) {
    releaseNotes = customNotes.trim();
  }
  // Priority 2: File specified via notesFile
  else if (notesFile && fs.existsSync(notesFile)) {
    try {
      releaseNotes = fs.readFileSync(notesFile, "utf8").trim();
    } catch (e) {
      console.warn(`Could not read notesFile: ${notesFile}`);
    }
  }
  // Priority 3: RELEASE_NOTES.md at root or apps/mobile/RELEASE_NOTES.md
  else if (fs.existsSync(path.join(rootDir, "RELEASE_NOTES.md"))) {
    const content = fs.readFileSync(path.join(rootDir, "RELEASE_NOTES.md"), "utf8").trim();
    if (content) releaseNotes = content;
  } else if (fs.existsSync(path.join(rootDir, "apps", "mobile", "RELEASE_NOTES.md"))) {
    const content = fs.readFileSync(path.join(rootDir, "apps", "mobile", "RELEASE_NOTES.md"), "utf8").trim();
    if (content) releaseNotes = content;
  }

  // Priority 4: Clean, formatted git commit log fallback
  if (!releaseNotes) {
    const logRange = latestTag ? `${latestTag}..HEAD` : "-n 10";
    const rawCommitList = runGit(`log ${logRange} --pretty=format:"- %s (%h)"`);
    const cleanNotes = formatCleanCommitList(rawCommitList);
    releaseNotes = cleanNotes || "- General performance improvements and bug fixes";
  }

  return {
    previousTag: latestTag || "none",
    version: versionString,
    tag: tagName,
    versionCode,
    releaseNotes,
  };
}

// CLI Execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let customVersion = null;
  let bumpType = null;
  let customNotes = null;
  let notesFile = null;
  let syncPackage = false;
  let writeGithubOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--custom" && args[i + 1]) {
      customVersion = args[++i];
    } else if (args[i] === "--type" && args[i + 1]) {
      bumpType = args[++i];
    } else if (args[i] === "--notes" && args[i + 1]) {
      customNotes = args[++i];
    } else if (args[i] === "--notes-file" && args[i + 1]) {
      notesFile = args[++i];
    } else if (args[i] === "--sync-package") {
      syncPackage = true;
    } else if (args[i] === "--github-output") {
      writeGithubOutput = true;
    }
  }

  const runNumber = process.env.GITHUB_RUN_NUMBER || null;
  const result = determineNextVersion({ customVersion, bumpType, runNumber, customNotes, notesFile });

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
    ].join("\n");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, outputContent + "\n");
  }
}
