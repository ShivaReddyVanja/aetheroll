#!/usr/bin/env node

/**
 * replace-app-icons.js
 * 
 * Replaces all app icons for Android and iOS using assets in the `mobile/AppIcons` folder.
 * 
 * Usage:
 *   node scripts/replace-app-icons.js
 *   or: pnpm update-icons
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const APP_ICONS_DIR = path.join(ROOT_DIR, 'AppIcons');

// Target Directories
const ANDROID_RES_DIR = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'res');
const IOS_APPICONSET_DIR = path.join(ROOT_DIR, 'ios', 'mobile', 'Images.xcassets', 'AppIcon.appiconset');
const ASSETS_DIR = path.join(ROOT_DIR, 'src', 'assets');

console.log('🚀 Starting App Icon Replacement Process...');
console.log(`📁 Source: ${APP_ICONS_DIR}`);

if (!fs.existsSync(APP_ICONS_DIR)) {
  console.error(`❌ Error: AppIcons directory not found at ${APP_ICONS_DIR}`);
  process.exit(1);
}

// ----------------------------------------------------
// 1. ANDROID APP ICONS
// ----------------------------------------------------
console.log('\n🤖 Updating Android App Icons...');
const androidSource = path.join(APP_ICONS_DIR, 'android');

if (fs.existsSync(androidSource)) {
  const densities = ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];

  densities.forEach((density) => {
    const srcFile = path.join(androidSource, density, 'ic_launcher.png');
    const targetDir = path.join(ANDROID_RES_DIR, density);

    if (fs.existsSync(srcFile)) {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // 1. Standard ic_launcher.png
      const targetStandard = path.join(targetDir, 'ic_launcher.png');
      fs.copyFileSync(srcFile, targetStandard);
      console.log(`   ✓ Copied -> android/res/${density}/ic_launcher.png`);

      // 2. Round ic_launcher_round.png
      const targetRound = path.join(targetDir, 'ic_launcher_round.png');
      fs.copyFileSync(srcFile, targetRound);
      console.log(`   ✓ Copied -> android/res/${density}/ic_launcher_round.png`);
    } else {
      console.warn(`   ⚠️ Warning: Missing ${srcFile}`);
    }
  });

  // Optional: Adaptive foreground icon if available
  const adaptiveFg = path.join(androidSource, 'adaptive-foreground.png');
  if (fs.existsSync(adaptiveFg)) {
    const drawableDir = path.join(ANDROID_RES_DIR, 'drawable');
    if (!fs.existsSync(drawableDir)) fs.mkdirSync(drawableDir, { recursive: true });
    fs.copyFileSync(adaptiveFg, path.join(drawableDir, 'ic_launcher_foreground.png'));
    console.log(`   ✓ Copied -> android/res/drawable/ic_launcher_foreground.png`);
  }
} else {
  console.warn(`⚠️ Warning: Android icons folder not found at ${androidSource}`);
}

// ----------------------------------------------------
// 2. IOS APP ICONS (Xcode Images.xcassets)
// ----------------------------------------------------
console.log('\n🍎 Updating iOS App Icons...');
const iosSource = path.join(APP_ICONS_DIR, 'Assets.xcassets', 'AppIcon.appiconset');

if (fs.existsSync(iosSource)) {
  if (!fs.existsSync(IOS_APPICONSET_DIR)) {
    fs.mkdirSync(IOS_APPICONSET_DIR, { recursive: true });
  }

  const files = fs.readdirSync(iosSource);
  let count = 0;

  files.forEach((file) => {
    const srcPath = path.join(iosSource, file);
    const destPath = path.join(IOS_APPICONSET_DIR, file);

    const stat = fs.statSync(srcPath);
    if (stat.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  });

  console.log(`   ✓ Successfully copied ${count} icon files & Contents.json to iOS AppIcon.appiconset!`);
} else {
  console.warn(`⚠️ Warning: iOS AppIconset folder not found at ${iosSource}`);
}

// ----------------------------------------------------
// 3. IN-APP BRANDING LOGO (src/assets/favicon.png)
// ----------------------------------------------------
console.log('\n✨ Updating In-App Brand Icon...');
const brandSource = path.join(APP_ICONS_DIR, 'Assets.xcassets', 'AppIcon.appiconset', '180.png');
if (fs.existsSync(brandSource)) {
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }
  fs.copyFileSync(brandSource, path.join(ASSETS_DIR, 'favicon.png'));
  console.log(`   ✓ Updated in-app logo -> src/assets/favicon.png`);
}

console.log('\n🎉 All Android and iOS app icons have been successfully updated!\n');
