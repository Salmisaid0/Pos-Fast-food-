const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");

const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

const textFilePattern = /\.(cjs|css|html|js|json|md|ts|tsx|yaml|yml)$/i;
const conflictMarkerPattern = /^(<<<<<<<|=======|>>>>>>>)(?:\s|$)|codex\/develop/i;
const findings = [];

for (const file of trackedFiles) {
  if (!textFilePattern.test(file)) continue;

  const contents = readFileSync(file, "utf8");
  const lines = contents.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (conflictMarkerPattern.test(line)) {
      findings.push({ file, lineNumber: index + 1, line });
    }
  });
}

if (findings.length > 0) {
  console.error("Git conflict markers or branch labels were found in tracked source files.");
  console.error("Resolve these files before running npm install/build/test:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.lineNumber}: ${finding.line}`);
  }
  process.exit(1);
}

console.log("No git conflict markers found in tracked source files.");
