// EXP-11 offline acceptance. Stages a scratch vault with the BUILT plugin
// installed under .obsidian/plugins/ontomark/, then runs the end-to-end driver
// inside `docker run --network none` (files streamed in over stdin, so no
// host bind mount and no package install happens inside the container).
//
//   node scripts/offline-test.mjs           # docker --network none (required for the proof)
//   node scripts/offline-test.mjs --local   # same driver on this host, tripwire only (not an offline proof)
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = resolve(here, "..");
const stage = join(plugin, ".offline/stage");
const local = process.argv.includes("--local");
const image = process.env.ONTOMARK_OFFLINE_IMAGE ?? "node:24-bookworm-slim";

for (const f of ["main.js", "manifest.json", "styles.css"]) {
  if (!existsSync(join(plugin, "dist", f))) {
    console.error(`dist/${f} missing: run npm run build first`);
    process.exit(2);
  }
}
rmSync(join(plugin, ".offline"), { recursive: true, force: true });
const vault = join(stage, "vault");
cpSync(resolve(plugin, "test/fixtures/vault"), vault, { recursive: true });
// 3,000 extra classes in an 8-ary taxonomy (depth ~4, like real vaults) so
// classification spans many worker steps for the EXP-06 edit race. A deep
// chain is avoided on purpose: its closure is quadratic (see README limits).
mkdirSync(join(vault, "Chain"), { recursive: true });
writeFileSync(join(vault, "Chain/K0.md"), "---\ntype: class\n---\n");
for (let i = 1; i < 3000; i++) {
  writeFileSync(join(vault, `Chain/K${i}.md`), `---\ntype: class\nsubclass-of: ["[[K${Math.floor((i - 1) / 8)}]]"]\n---\n`);
}
const installed = join(vault, ".obsidian/plugins/ontomark");
mkdirSync(installed, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) cpSync(join(plugin, "dist", f), join(installed, f));
writeFileSync(join(vault, ".obsidian/community-plugins.json"), '["ontomark"]\n');
cpSync(join(plugin, "test/e2e"), join(stage, "e2e"), { recursive: true });

let out;
let invocation;
if (local) {
  invocation = [process.execPath, join(stage, "e2e/offline.e2e.cjs"), vault];
  out = spawnSync(invocation[0], invocation.slice(1), { encoding: "utf8" });
} else {
  const tar = execFileSync("tar", ["-C", stage, "-cf", "-", "."], { maxBuffer: 1 << 30 });
  invocation = ["docker", "run", "--rm", "-i", "--network", "none", image, "sh", "-c", "mkdir -p /w && tar -x -C /w && node /w/e2e/offline.e2e.cjs /w/vault"];
  out = spawnSync(invocation[0], invocation.slice(1), { input: tar, encoding: "utf8", maxBuffer: 1 << 28 });
}
const meta = { mode: local ? "local (not an offline proof)" : "docker --network none", invocation: invocation.join(" "), image: local ? null : image, exit: out.status };
writeFileSync(join(plugin, ".offline/report.json"), out.stdout || "{}");
writeFileSync(join(plugin, ".offline/run.json"), JSON.stringify(meta, null, 2));
process.stdout.write(out.stdout);
if (out.stderr) process.stderr.write(out.stderr);
console.error(JSON.stringify(meta));
process.exit(out.status ?? 1);
