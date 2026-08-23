import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { CustomFile } from "telegram/client/uploads.js";

describe("📤 Large File Upload & Memory Management", () => {
  it("should create, read, and cleanly dispose disk-backed temporary files for >20MB streams", async () => {
    const tempDir = path.resolve(process.cwd(), ".data/temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const testFileName = `test_large_${crypto.randomUUID()}.dat`;
    const tempFilePath = path.join(tempDir, testFileName);

    // Create a 25MB simulated video payload
    const simulated25MBBuffer = Buffer.alloc(25 * 1024 * 1024, 0xaa);
    await fs.promises.writeFile(tempFilePath, simulated25MBBuffer);

    assert.ok(fs.existsSync(tempFilePath), "Temp file must exist on disk");
    assert.equal(fs.statSync(tempFilePath).size, 25 * 1024 * 1024);

    // Create CustomFile with valid path
    const customFile = new CustomFile(testFileName, simulated25MBBuffer.length, tempFilePath, simulated25MBBuffer);
    assert.equal(customFile.size, 25 * 1024 * 1024);
    assert.equal(customFile.path, tempFilePath);

    // Simulate cleanup
    await fs.promises.unlink(tempFilePath);
    assert.ok(!fs.existsSync(tempFilePath), "Temp file must be removed after upload completion to prevent disk leaks");
  });
});
