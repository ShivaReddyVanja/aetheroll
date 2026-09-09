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

  // Generate release notes
  const logRange = latestTag ? `${latestTag}..HEAD` : "-n 10";
  const commitList = runGit(`log ${logRange} --pretty=format:"- %s (%h)"`);
  const releaseNotes = commitList || "- General improvements and bug fixes";

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
    ].join("\n");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, outputContent + "\n");
  }
}
