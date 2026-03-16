const fs = require("fs");
const path = require("path");

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : "";
}

const batch = readArg("--batch") || "unknown-batch";
const task = readArg("--task") || "unknown-task";
const query = readArg("--query") || "";
const output = readArg("--out");

if (!output) {
  console.error("[v2-agent-task] missing --out");
  process.exit(1);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  [
    "batch,task,status,next_step,query",
    JSON.stringify(batch) + "," +
      JSON.stringify(task) + "," +
      JSON.stringify("planned") + "," +
      JSON.stringify("manual_implementation") + "," +
      JSON.stringify(query),
  ].join("\n") + "\n"
);

console.log(JSON.stringify({
  ok: true,
  batch,
  task,
  query,
  output,
}));
