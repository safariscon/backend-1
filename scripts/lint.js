const { spawnSync } = require("child_process");
const { readdirSync, statSync } = require("fs");
const { join } = require("path");

const walk = (dir, files = []) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (full.endsWith(".js")) files.push(full);
  }
  return files;
};

let failed = false;
for (const file of walk(join(__dirname, "..", "src"))) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
