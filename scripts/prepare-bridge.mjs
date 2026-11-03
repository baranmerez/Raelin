// Builds the raelin-mcp bridge and puts it where Tauri's `externalBin` expects it
// (src-tauri/binaries/raelin-mcp-<target triple>.exe), so the installer ships it next
// to the app. Pass --release for installer builds.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const release = process.argv.includes("--release");
const profile = release ? "release" : "debug";

const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (\S+)$/m)?.[1];
if (!host) throw new Error("rustc did not report a host triple");

execFileSync("cargo", ["build", "-p", "raelin-mcp", ...(release ? ["--release"] : [])], {
  cwd: root,
  stdio: "inherit",
});

const ext = process.platform === "win32" ? ".exe" : "";
const built = path.join(root, "target", profile, `raelin-mcp${ext}`);
const dir = path.join(root, "src-tauri", "binaries");
const dest = path.join(dir, `raelin-mcp-${host}${ext}`);
fs.mkdirSync(dir, { recursive: true });

// Leave an identical file alone: touching it makes tauri-build re-copy the sidecar,
// which fails while an AI client is running the copy in target/.
const same =
  fs.existsSync(dest) && Buffer.compare(fs.readFileSync(dest), fs.readFileSync(built)) === 0;
if (!same) fs.copyFileSync(built, dest);
console.log(
  `raelin-mcp (${profile}) ${same ? "unchanged" : "copied"}: ${path.relative(root, dest)}`,
);
