import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function run(cmd, allowFail = false) {
  console.log(`\x1b[36m> ${cmd}\x1b[0m`);
  try {
    return execSync(cmd, { stdio: 'inherit', encoding: 'utf-8' });
  } catch (err) {
    if (!allowFail) {
      console.error(`\x1b[31mCommand failed: ${cmd}\x1b[0m`, err);
      process.exit(1);
    }
  }
}

const root = process.cwd();

console.log('\n\x1b[32m=== 1. Scaffolding Monorepo Directories ===\x1b[0m');
fs.mkdirSync(path.join(root, 'apps'), { recursive: true });
fs.mkdirSync(path.join(root, 'workers'), { recursive: true });
fs.mkdirSync(path.join(root, 'packages/types/src'), { recursive: true });
fs.mkdirSync(path.join(root, 'packages/crypto/src'), { recursive: true });
fs.mkdirSync(path.join(root, 'packages/config'), { recursive: true });

console.log('\n\x1b[32m=== 2. History-Preserving Git Moves ===\x1b[0m');

// A. Move Mobile to apps/mobile
if (fs.existsSync(path.join(root, 'mobile')) && !fs.existsSync(path.join(root, 'apps/mobile'))) {
  run('git mv mobile apps/mobile');
}

// B. Move Cloudflare Worker to workers/api
if (!fs.existsSync(path.join(root, 'workers/api'))) {
  fs.mkdirSync(path.join(root, 'workers/api'), { recursive: true });
  if (fs.existsSync(path.join(root, 'src/server'))) {
    run('git mv src/server workers/api/src');
  }
  if (fs.existsSync(path.join(root, 'wrangler.jsonc'))) {
    run('git mv wrangler.jsonc workers/api/wrangler.jsonc');
  }
}

// C. Move Next.js Web to apps/web
if (!fs.existsSync(path.join(root, 'apps/web'))) {
  fs.mkdirSync(path.join(root, 'apps/web/src'), { recursive: true });
  if (fs.existsSync(path.join(root, 'src/app'))) {
    run('git mv src/app apps/web/src/app');
  }
  if (fs.existsSync(path.join(root, 'src/components'))) {
    run('git mv src/components apps/web/src/components');
  }
  if (fs.existsSync(path.join(root, 'src/lib'))) {
    run('git mv src/lib apps/web/src/lib');
  }
  if (fs.existsSync(path.join(root, 'public'))) {
    run('git mv public apps/web/public');
  }
  if (fs.existsSync(path.join(root, 'next.config.mjs'))) {
    run('git mv next.config.mjs apps/web/next.config.mjs');
  }
  if (fs.existsSync(path.join(root, 'tailwind.config.ts'))) {
    run('git mv tailwind.config.ts apps/web/tailwind.config.ts');
  }
  if (fs.existsSync(path.join(root, 'postcss.config.js'))) {
    run('git mv postcss.config.js apps/web/postcss.config.js');
  }
}

// Clean up old empty src directory if it still exists
if (fs.existsSync(path.join(root, 'src')) && fs.readdirSync(path.join(root, 'src')).length === 0) {
  fs.rmdirSync(path.join(root, 'src'));
}

console.log('\n\x1b[32m=== 3. Writing Root Monorepo Configuration ===\x1b[0m');

// pnpm-workspace.yaml
fs.writeFileSync(
  path.join(root, 'pnpm-workspace.yaml'),
`packages:
  - 'apps/*'
  - 'workers/*'
  - 'packages/*'
`
);

// turbo.json
fs.writeFileSync(
  path.join(root, 'turbo.json'),
JSON.stringify(
  {
    "$schema": "https://turbo.build/schema.json",
    "tasks": {
      "build": {
        "dependsOn": ["^build"],
        "outputs": [".next/**", "!.next/cache/**", "dist/**", "build/**"]
      },
      "lint": {
        "dependsOn": ["^lint"]
      },
      "test": {
        "dependsOn": ["^build"]
      },
      "test:unit": {},
      "dev": {
        "cache": false,
        "persistent": true
      }
    }
  },
  null,
  2
) + '\n'
);

// Root package.json
const rootPkg = {
  "name": "aetheroll-monorepo",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "dev:web": "pnpm --filter @aetheroll/web dev",
    "dev:api": "pnpm --filter @aetheroll/api dev",
    "dev:mobile": "pnpm --filter @aetheroll/mobile start",
    "build": "turbo build",
    "build:web": "pnpm --filter @aetheroll/web build",
    "build:api": "pnpm --filter @aetheroll/api build",
    "test": "turbo test",
    "test:unit": "pnpm --filter @aetheroll/api test:unit",
    "deploy:api": "pnpm --filter @aetheroll/api deploy"
  },
  "devDependencies": {
    "turbo": "^2.4.4",
    "typescript": "^5.8.2"
  }
};
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(rootPkg, null, 2) + '\n');

console.log('\n\x1b[32m=== 4. Setting up packages/types ===\x1b[0m');

fs.writeFileSync(
  path.join(root, 'packages/types/package.json'),
JSON.stringify(
  {
    "name": "@aetheroll/types",
    "version": "0.1.0",
    "private": true,
    "main": "./src/index.ts",
    "types": "./src/index.ts",
    "scripts": {
      "typecheck": "tsc --noEmit"
    },
    "devDependencies": {
      "typescript": "^5.8.2"
    }
  },
  null,
  2
) + '\n'
);

fs.writeFileSync(
  path.join(root, 'packages/types/tsconfig.json'),
JSON.stringify(
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "declaration": true,
      "strict": true,
      "skipLibCheck": true
    },
    "include": ["src/**/*"]
  },
  null,
  2
) + '\n'
);

fs.writeFileSync(
  path.join(root, 'packages/types/src/index.ts'),
`export type MediaType = 'image' | 'video' | 'document';

export interface MediaItem {
  id: string;
  channel_id: string;
  telegram_message_id: number;
  original_telegram_message_id?: number | null;
  file_type: MediaType;
  file_size_bytes: number;
  original_file_size_bytes?: number | null;
  mime_type?: string | null;
  original_mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  blurhash?: string | null;
  caption?: string | null;
  is_favorite: number;
  is_pinned?: number;
  is_archived?: number;
  media_group_id?: string | null;
  taken_at?: number | null;
  created_at?: string;
  updated_at?: string;
  transcode_status?: 'queued' | 'processing' | 'ready' | 'failed' | null;
  transcode_error?: string | null;
}

export interface MediaVariant {
  id: string;
  media_item_id: string;
  quality: '1080p' | '720p' | '480p' | '360p';
  telegram_message_id: number;
  file_size_bytes: number;
  width: number;
  height: number;
  bitrate_kbps?: number;
  mime_type: string;
  codec: string;
  created_at?: string;
}

export interface TelemetryLogEntry {
  id: string;
  timestamp: number;
  category: 'EDGE_CACHE' | 'STREAM' | 'PREFETCH' | 'UPLOAD' | 'MTPROTO' | 'EXOPLAYER' | 'SYSTEM' | 'ERROR' | 'RAM' | 'AUTH';
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  meta?: any;
}
`
);

console.log('\n\x1b[32m=== 5. Setting up workers/api ===\x1b[0m');

fs.writeFileSync(
  path.join(root, 'workers/api/package.json'),
JSON.stringify(
  {
    "name": "@aetheroll/api",
    "version": "0.1.0",
    "private": true,
    "scripts": {
      "dev": "wrangler dev",
      "deploy": "wrangler deploy",
      "test:unit": "node --test 'src/**/*.test.ts'",
      "typecheck": "tsc --noEmit"
    },
    "dependencies": {
      "@aetheroll/types": "workspace:*",
      "@hono/node-server": "^1.13.8",
      "better-sqlite3": "^11.8.1",
      "hono": "^4.7.2",
      "qrcode": "^1.5.4",
      "telegram": "^2.26.22"
    },
    "devDependencies": {
      "@types/better-sqlite3": "^7.6.12",
      "@types/node": "^22.13.9",
      "@types/qrcode": "^1.5.5",
      "typescript": "^5.8.2",
      "wrangler": "^3.111.0"
    }
  },
  null,
  2
) + '\n'
);

fs.writeFileSync(
  path.join(root, 'workers/api/tsconfig.json'),
JSON.stringify(
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "lib": ["ESNext"],
      "strict": true,
      "skipLibCheck": true,
      "esModuleInterop": true,
      "allowSyntheticDefaultImports": true,
      "resolveJsonModule": true,
      "noEmit": true
    },
    "include": ["src/**/*"]
  },
  null,
  2
) + '\n'
);

console.log('\n\x1b[32m=== 6. Setting up apps/web ===\x1b[0m');

fs.writeFileSync(
  path.join(root, 'apps/web/package.json'),
JSON.stringify(
  {
    "name": "@aetheroll/web",
    "version": "0.1.0",
    "private": true,
    "scripts": {
      "dev": "next dev",
      "build": "next build",
      "start": "next start",
      "lint": "next lint"
    },
    "dependencies": {
      "@aetheroll/types": "workspace:*",
      "blurhash": "^2.0.5",
      "clsx": "^2.1.1",
      "exifreader": "^4.26.0",
      "lucide-react": "^1.16.0",
      "next": "^15.2.0",
      "qrcode": "^1.5.4",
      "react": "^19.0.0",
      "react-dom": "^19.0.0",
      "tailwind-merge": "^3.0.2"
    },
    "devDependencies": {
      "@types/node": "^22.13.9",
      "@types/qrcode": "^1.5.5",
      "@types/react": "^19.0.10",
      "@types/react-dom": "^19.0.4",
      "autoprefixer": "^10.4.20",
      "postcss": "^8.5.3",
      "tailwindcss": "^3.4.17",
      "typescript": "^5.8.2"
    }
  },
  null,
  2
) + '\n'
);

fs.writeFileSync(
  path.join(root, 'apps/web/tsconfig.json'),
JSON.stringify(
  {
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["dom", "dom.iterable", "esnext"],
      "allowJs": true,
      "skipLibCheck": true,
      "strict": true,
      "noEmit": true,
      "esModuleInterop": true,
      "module": "esnext",
      "moduleResolution": "bundler",
      "resolveJsonModule": true,
      "isolatedModules": true,
      "jsx": "preserve",
      "incremental": true,
      "plugins": [{ "name": "next" }],
      "paths": {
        "@/*": ["./src/*"]
      }
    },
    "include": [
      "next-env.d.ts",
      "src/**/*.ts",
      "src/**/*.tsx",
      ".next/types/**/*.ts"
    ],
    "exclude": ["node_modules", ".next"]
  },
  null,
  2
) + '\n'
);

console.log('\n\x1b[32m=== 7. Updating apps/mobile ===\x1b[0m');

// Update apps/mobile/package.json name to @aetheroll/mobile
const mobilePkgPath = path.join(root, 'apps/mobile/package.json');
if (fs.existsSync(mobilePkgPath)) {
  const mobilePkg = JSON.parse(fs.readFileSync(mobilePkgPath, 'utf-8'));
  mobilePkg.name = "@aetheroll/mobile";
  mobilePkg.dependencies = mobilePkg.dependencies || {};
  mobilePkg.dependencies["@aetheroll/types"] = "workspace:*";
  fs.writeFileSync(mobilePkgPath, JSON.stringify(mobilePkg, null, 2) + '\n');
}

console.log('\n\x1b[32m=== Migration Script Completed Successfully! ===\x1b[0m\n');
