import fs from "fs";
import path from "path";

export interface R2StorageInterface {
  get(key: string): Promise<Buffer | null>;
  put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function getR2Storage(cloudflareR2?: any): R2StorageInterface {
  // If running on Cloudflare Workers with R2 binding
  if (cloudflareR2 && typeof cloudflareR2.put === "function") {
    return {
      async get(key: string): Promise<Buffer | null> {
        const object = await cloudflareR2.get(key);
        if (!object) return null;
        const arrayBuffer = await object.arrayBuffer();
        return Buffer.from(arrayBuffer);
      },
      async put(key: string, data: Buffer | Uint8Array, contentType: string = "image/webp"): Promise<void> {
        await cloudflareR2.put(key, data, {
          httpMetadata: { contentType },
        });
      },
      async delete(key: string): Promise<void> {
        await cloudflareR2.delete(key);
      },
    };
  }

  // Local filesystem fallback for dev server (`.data/cache/`)
  const cacheDir = path.resolve(process.cwd(), ".data/cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  return {
    async get(key: string): Promise<Buffer | null> {
      const filePath = path.join(cacheDir, key.replace(/\//g, "_"));
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath);
      }
      return null;
    },
    async put(key: string, data: Buffer | Uint8Array): Promise<void> {
      const filePath = path.join(cacheDir, key.replace(/\//g, "_"));
      fs.writeFileSync(filePath, Buffer.from(data));
    },
    async delete(key: string): Promise<void> {
      const filePath = path.join(cacheDir, key.replace(/\//g, "_"));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    },
  };
}
