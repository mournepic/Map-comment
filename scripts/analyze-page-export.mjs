import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const INPUT_FILE = process.env.INPUT_FILE || "codex-analysis/latest-page-export.txt";
const OUTPUT_FILE = process.env.OUTPUT_FILE || "codex-analysis/latest-page-export-analysis.md";
const MODEL = process.env.ANALYSIS_MODEL || "gpt-4.1-mini";
const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS || 70000);

const apiKey = process.env.OPENAI_API_KEY;

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

const formatAverage = (value) => (value === "unknown" ? "unknown" : value);
const formatKeywordCounts = () =>
  Object.entries(keywordCounts)
    .slice(0, 15)
    .map(([keyword, value]) => `- ${keyword}: ${value}`)
    .join("\n") || "- No tracked keyword matched.";

const buildFallbackAnalysis = (reason) => `## 狀態

OpenAI 深度分析沒有完成，因此這份報告先使用腳本本地統計產生。

原因：${reason}

## 本地統計摘要

- Google Maps 頁面顯示評分：${stats.visibleGoogleRating}
- Google Maps 頁面顯示評論數：${stats.visibleReviewCount}
- 匯出文字長度：${stats.sourceCharacters} 字
- 解析到的星等評論數：${stats.parsedReviewRatings.count}
- 解析到的星等平均：${stats.parsedReviewRatings.average}
- 在地嚮導出現次數：${stats.localGuides}
- 業主回應出現次數：${stats.ownerReplies}
- Google 翻譯標記出現次數：${stats.googleTranslations}

## 細項評分

- 房間：${formatAverage(stats.subratings.room.average)}，樣本 ${stats.subratings.room.count}
- 服務：${formatAverage(stats.subratings.service.average)}，樣本 ${stats.subratings.service.count}
- 地點：${formatAverage(stats.subratings.location.average)}，樣本 ${stats.subratings.location.count}
- 餐點：${formatAverage(stats.subratings.food.average)}，樣本 ${stats.subratings.food.count}
- 氣氛：${formatAverage(stats.subratings.atmosphere.average)}，樣本 ${stats.subratings.atmosphere.count}

## 高頻關鍵字

${formatKeywordCounts()}

## 初步判讀

- 若「位置」「BTS」「MRT」「交通」排名靠前，代表地點便利性是主要優勢。
- 若「服務」「員工」排名靠前，代表服務體驗是評論的重要主題，需搭配星等與負評文字判讀方向。
- 若「老舊」「浴室」「冷氣」「噪音」「裝修」出現，通常代表硬體或房況是改善重點。
- 若「早餐」「貴賓室」「行政酒廊」出現，代表餐飲與會員/高樓層服務可能是可行銷賣點。

## 下一步

請到 OpenAI Platform 確認 API billing 或 quota。修好後重新執行 GitHub Actions，就會產生 AI 深度分析版。
`;

const buildPrompt = () => `你正在分析一份從 Google Maps 匯出的頁面文字。請用繁體中文輸出一份適合店家/營運者看的 Markdown 分析報告。

要求：
- 不要逐字重貼評論。
- 先講結論，再講證據。
- 區分「從統計可見」與「從評論內容推論」。
- 指出優勢、痛點、可改善事項、可用於行銷的賣點。
- 如果資料看起來是飯店，就用飯店營運角度；如果是餐廳，就用餐廳營運角度。
- 最後提供 5 條可執行建議。

本地統計：
${JSON.stringify(stats, null, 2)}

頁面文字：
${truncatedText}`;

const generateOpenAIAnalysis = async () => {
  if (!apiKey) {
    return buildFallbackAnalysis("Missing OPENAI_API_KEY environment variable.");
  }

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
          content: buildPrompt(),
        },
      ],
      max_output_tokens: 3500,
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    return buildFallbackAnalysis(body?.error?.message || `OpenAI API request failed: ${response.status}`);
  }

  const analysis =
    body.output_text ||
    body.output
      ?.flatMap((item) => item.content || [])
      .map((item) => item.text || "")
      .join("\n")
      .trim();

  return analysis || buildFallbackAnalysis("OpenAI response did not include analysis text.");
};

const generatedAt = new Date().toISOString();
const analysis = await generateOpenAIAnalysis();
const output = `# Latest Page Export Analysis\n\nGenerated at: ${generatedAt}\n\nModel: ${MODEL}\n\nSource: \`${INPUT_FILE}\`\n\n---\n\n${analysis.trim()}\n`;

await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
await writeFile(OUTPUT_FILE, output, "utf8");

console.log(`Wrote ${OUTPUT_FILE}`);
