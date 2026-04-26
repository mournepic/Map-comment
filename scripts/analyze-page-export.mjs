import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const INPUT_FILE = process.env.INPUT_FILE || "codex-analysis/latest-page-export.txt";
const OUTPUT_FILE = process.env.OUTPUT_FILE || "codex-analysis/latest-page-export-analysis.md";
const MODEL = process.env.ANALYSIS_MODEL || "gpt-4.1-mini";
const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS || 70000);

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("Missing OPENAI_API_KEY environment variable.");
}

const rawText = await readFile(INPUT_FILE, "utf8");
const cleanedText = rawText
  .replace(/[\uE000-\uF8FF]/g, "")
  .replace(/\u00a0/g, " ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const truncatedText =
  cleanedText.length > MAX_INPUT_CHARS
    ? `${cleanedText.slice(0, MAX_INPUT_CHARS)}\n\n[TRUNCATED: source text was ${cleanedText.length} characters]`
    : cleanedText;

const count = (pattern) => (cleanedText.match(pattern) || []).length;
const countText = (term) => cleanedText.split(term).length - 1;
const average = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const numbersFor = (label) =>
  [...cleanedText.matchAll(new RegExp(`${label}([1-5])`, "g"))].map((match) => Number(match[1]));

const ratingMatch = cleanedText.match(/\n(\d(?:\.\d)?)\n([\d,]+) 篇評論/);
const allRatings = [...cleanedText.matchAll(/\b([1-5])\/5\b/g)].map((match) => Number(match[1]));
const roomRatings = numbersFor("房間：");
const serviceRatings = numbersFor("服務：");
const locationRatings = numbersFor("地點：");
const foodRatings = numbersFor("餐點：");
const atmosphereRatings = numbersFor("氣氛：");

const keywords = [
  "地鐵",
  "BTS",
  "MRT",
  "位置",
  "交通",
  "購物中心",
  "早餐",
  "房間",
  "服務",
  "員工",
  "乾淨",
  "老舊",
  "浴室",
  "冷氣",
  "噪音",
  "裝修",
  "升級",
  "貴賓室",
  "行政酒廊",
  "泳池",
  "健身房",
  "便利",
  "不方便",
  "推薦",
  "失望",
  "不滿意",
];

const keywordCounts = Object.fromEntries(
  keywords
    .map((keyword) => [keyword, countText(keyword)])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
);

const stats = {
  sourceFile: INPUT_FILE,
  sourceCharacters: cleanedText.length,
  visibleGoogleRating: ratingMatch?.[1] || "unknown",
  visibleReviewCount: ratingMatch?.[2] || "unknown",
  parsedReviewRatings: {
    count: allRatings.length,
    average: average(allRatings)?.toFixed(2) || "unknown",
    counts: Object.fromEntries([1, 2, 3, 4, 5].map((score) => [score, allRatings.filter((value) => value === score).length])),
  },
  subratings: {
    room: { count: roomRatings.length, average: average(roomRatings)?.toFixed(2) || "unknown" },
    service: { count: serviceRatings.length, average: average(serviceRatings)?.toFixed(2) || "unknown" },
    location: { count: locationRatings.length, average: average(locationRatings)?.toFixed(2) || "unknown" },
    food: { count: foodRatings.length, average: average(foodRatings)?.toFixed(2) || "unknown" },
    atmosphere: { count: atmosphereRatings.length, average: average(atmosphereRatings)?.toFixed(2) || "unknown" },
  },
  localGuides: count(/在地嚮導/g),
  ownerReplies: count(/業主回應/g),
  googleTranslations: count(/由 Google 提供翻譯/g),
  keywordCounts,
};

const prompt = `你正在分析一份從 Google Maps 匯出的頁面文字。請用繁體中文輸出一份適合店家/營運者看的 Markdown 分析報告。\n\n要求：\n- 不要逐字重貼評論。\n- 先講結論，再講證據。\n- 區分「從統計可見」與「從評論內容推論」。\n- 指出優勢、痛點、可改善事項、可用於行銷的賣點。\n- 如果資料看起來是飯店，就用飯店營運角度；如果是餐廳，就用餐廳營運角度。\n- 最後提供 5 條可執行建議。\n\n本地統計：\n${JSON.stringify(stats, null, 2)}\n\n頁面文字：\n${truncatedText}`;

const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: MODEL,
    input: [
      {
        role: "system",
        content:
          "你是資深市場研究與顧客評論分析師。你的輸出要精準、可執行、避免誇大，並使用繁體中文。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    max_output_tokens: 3500,
  }),
});

const body = await response.json();

if (!response.ok) {
  throw new Error(body?.error?.message || `OpenAI API request failed: ${response.status}`);
}

const analysis =
  body.output_text ||
  body.output
    ?.flatMap((item) => item.content || [])
    .map((item) => item.text || "")
    .join("\n")
    .trim();

if (!analysis) {
  throw new Error("OpenAI response did not include analysis text.");
}

const generatedAt = new Date().toISOString();
const output = `# Latest Page Export Analysis\n\nGenerated at: ${generatedAt}\n\nModel: ${MODEL}\n\nSource: \`${INPUT_FILE}\`\n\n---\n\n${analysis.trim()}\n`;

await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
await writeFile(OUTPUT_FILE, output, "utf8");

console.log(`Wrote ${OUTPUT_FILE}`);
