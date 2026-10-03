const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const models = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const yaml = fs.readFileSync(".github/workflows/summarize-map-export.yml", "utf8");
const source = yaml.match(/          \(async \(\) => \{([\s\S]*?)\n          NODE/)[0]
  .replace(/\n          NODE$/, "")
  .split("\n").map(line => line.startsWith("          ") ? line.slice(10) : line).join("\n");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "map-gemini-test-"));
const input = path.join(dir, "reviews.txt");
fs.writeFileSync(input, "示範拉麵店 測試分店\n4.4\n100 篇評論\n評論甲：鹽味拉麵清爽，服務親切，每人約300元。\n評論乙：喜歡鹽味拉麵，靠近捷運站。\n評論丙：我覺得湯偏鹹，晚餐等了20分鐘。\n", "utf8");
const sanitize = text => String(text).split(process.env.GEMINI_API_KEY || "__no_key__").join("[REDACTED]");

function runScript(modelList, output, prefix = "") {
  return spawnSync(process.execPath, ["--input-type=commonjs", "-e", prefix + source], {
    env: { ...process.env, GEMINI_API_KEY: process.env.GEMINI_API_KEY || "test-placeholder", GEMINI_MODELS: modelList.join(","), INPUT_PATH: input, OUTPUT_PATH: output },
    encoding: "utf8", timeout: 150000,
  });
}

// Exercise every fallback position and the all-failed case without API calls.
for (let succeedAt = 0; succeedAt <= models.length; succeedAt++) {
  const output = path.join(dir, `fallback-${succeedAt}.md`);
  const calls = path.join(dir, `calls-${succeedAt}.json`);
  const stub = `const testModels = ${JSON.stringify(models)}; const testCalls = []; global.fetch = async (url) => {
    const model = String(url).match(/models\\/([^:]+):generateContent/)[1];
    testCalls.push(model); require('fs').writeFileSync(${JSON.stringify(calls)}, JSON.stringify(testCalls));
    return model === testModels[${succeedAt}] ? {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'# 中文總結\\n\\n測試成功\\n\\n# English Summary\\n\\nTest passed'}]}}]})} : {ok:false,status:503,json:async()=>({error:{message:'Simulated unavailable model'}})};
  };\n`;
  const result = runScript(models, output, stub);
  assert.deepEqual(JSON.parse(fs.readFileSync(calls, "utf8")), models.slice(0, Math.min(succeedAt + 1, models.length)));
  if (succeedAt < models.length) {
    assert.equal(result.status, 0, sanitize(result.stderr));
    assert.ok(fs.readFileSync(output, "utf8").includes(`with \`${models[succeedAt]}\``));
  } else {
    assert.notEqual(result.status, 0);
    assert.ok(!fs.existsSync(output));
  }
}
console.log("PASS: all six fallback positions, stop after success, and all-models-failed behavior.");

async function main() {
  if (process.env.LIVE_MODEL_TEST !== "true") return;
  assert.ok(process.env.GEMINI_API_KEY, "Missing GEMINI_API_KEY repository secret");
  const results = [];
  for (const model of ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"]) {
    let passed = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const output = path.join(dir, `${model}.md`);
      console.log(`LIVE: ${model}, attempt ${attempt}`);
      const result = runScript([model], output);
      if (result.status === 0 && fs.existsSync(output)) {
        const report = fs.readFileSync(output, "utf8");
        if (report.includes("# 中文總結") && report.includes("# English Summary") && report.includes(`with \`${model}\``)) {
          console.log(`PASS: ${model}, bilingual analysis returned (${report.length} characters).`);
          passed = true;
          break;
        }
      }
      console.log(sanitize((result.stdout || "") + (result.stderr || "")).slice(-1600));
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 15000));
    }
    results.push({model, passed});
  }
  const table = "| Model | Live result |\n|---|---|\n" + results.map(r => `| ${r.model} | ${r.passed ? "PASS" : "FAIL"} |`).join("\n") + "\n";
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
  const chainOutput = path.join(dir, "live-fallback-chain.md");
  const chainResult = runScript(models, chainOutput);
  assert.equal(chainResult.status, 0, sanitize(chainResult.stderr));
  const chainReport = fs.readFileSync(chainOutput, "utf8");
  assert.ok(chainReport.includes("# 中文總結") && chainReport.includes("# English Summary"));
  console.log("PASS: complete live fallback chain.");
  console.log(sanitize(chainResult.stdout));
  assert.ok(results.every(r => r.passed), "One or more models failed the live test; do not change production configuration.");
}

main().catch(error => { console.error(sanitize(error.message)); process.exitCode = 1; });
