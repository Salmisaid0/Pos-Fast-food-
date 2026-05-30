const { execFileSync } = require("node:child_process");

const trackedBuildFiles = execFileSync("git", ["ls-files", "dist", ".turbo", "coverage"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

if (trackedBuildFiles.length > 0) {
  console.error("Build/cache artifacts must not be tracked:");
  for (const file of trackedBuildFiles) console.error(`- ${file}`);
  process.exit(1);
}

console.log("No tracked build artifacts found.");
