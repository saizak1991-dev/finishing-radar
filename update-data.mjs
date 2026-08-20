// update-data.mjs
// يعمل هذا السكربت داخل GitHub Action مجدولة فقط — لا يُستدعى أبدًا من المتصفح.
// يستخدم مفتاح Gemini API (سري، مخزّن في GitHub Secrets) للبحث الحي على الويب
// وتحديث قائمة المشاريع، ثم يكتب النتيجة إلى data.json بجانب index.html.

import { readFileSync, writeFileSync } from "node:fs";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("خطأ: متغيّر البيئة GEMINI_API_KEY غير موجود. أضِفه كـ Secret في إعدادات المستودع.");
  process.exit(1);
}

const MODEL = "gemini-flash-latest";
const DATA_FILE = "data.json";

// إعدادات إعادة المحاولة عند ازدحام Gemini (503) أو تجاوز الحصة (429)
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 5000; // 5 ثوانٍ، تتضاعف مع كل محاولة (5s, 10s, 20s, 40s)

const SEARCH_QUERIES = [
  "مشاريع عقارية جديدة دبي 2026",
  "مشاريع عقارية جديدة أبوظبي 2026",
  "Dubai off-plan projects handover update 2026",
  "Abu Dhabi off-plan projects handover update 2026",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function duckDuckGoSearch(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) {
    console.warn(`DuckDuckGo رد بحالة غير ناجحة (${res.status}) للاستعلام: ${query}`);
    return [];
  }
  const html = await res.text();

  // بنية DuckDuckGo HTML قد تتغيّر بمرور الوقت. نحاول عدة أنماط بالترتيب.
  const results = [];

  // النمط الأساسي (الحالي وقت كتابة هذا السكربت)
  const pattern1 =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  // نمط احتياطي أوسع: يلتقط أي رابط نتيجة + أقرب نص وصفي بعده
  const pattern2 =
    /<a[^>]*class="[^"]*result__url[^"]*"[^>]*href="([^"]+)"[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  const strip = (s) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

  let m;
  while ((m = pattern1.exec(html)) && results.length < 5) {
    results.push({ title: strip(m[2]), snippet: strip(m[3]), url: m[1] });
  }

  if (results.length === 0) {
    while ((m = pattern2.exec(html)) && results.length < 5) {
      results.push({ title: "", snippet: strip(m[2]), url: m[1] });
    }
  }

  if (results.length === 0) {
    console.warn(`لم يُعثر على نتائج قابلة للاستخراج من DuckDuckGo للاستعلام: ${query} (قد تكون بنية الصفحة تغيّرت)`);
  }

  return results;
}

async function gatherLiveSearchContext() {
  const chunks = [];
  for (const q of SEARCH_QUERIES) {
    try {
      const results = await duckDuckGoSearch(q);
      for (const r of results) {
        chunks.push(`- ${r.title}: ${r.snippet}`);
      }
    } catch (e) {
      console.warn(`تعذّر البحث عن "${q}":`, e.message);
    }
  }
  return chunks.join("\n");
}

function loadExistingProjects() {
  try {
    const raw = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    if (Array.isArray(raw.projects) && raw.projects.length) return raw.projects;
  } catch (e) {
    console.warn("تعذّر قراءة data.json الحالي، سيبدأ من قائمة فارغة:", e.message);
  }
  return [];
}

function buildPrompt(existingProjects, searchContext) {
  return `فيما يلي نتائج بحث حية من الويب عن مشاريع التطوير العقاري في دبي وأبوظبي (استخدمها كمصدر معلومات حديث):
${searchContext || "(لا توجد نتائج بحث متاحة هذه المرة)"}

بناءً على نتائج البحث أعلاه، وعلى معرفتك العامة، حدّث قائمة مشاريع التطوير العقاري السكني/التجاري قيد الإنشاء في دبي وأبوظبي (الإمارات) — تحديثات مواعيد التسليم، مشاريع جديدة أُعلنت، ومشاريع سُلّمت فعليًا (احذفها من القائمة).

لديك حاليًا هذه القائمة كنقطة انطلاق (JSON):
${JSON.stringify(existingProjects)}

أعد كتابة القائمة كاملة محدّثة. حافظ على نفس بنية كل عنصر تمامًا (نفس أسماء الحقول بالضبط: id, name, developer, type, segment, emirate, area, lat, lng, handover, priceFrom, devClass, units, valueAED, source).
- type يجب أن يكون واحدًا من: apartment, villa, commercial.
- emirate يجب أن يكون: dubai أو abudhabi.
- handover بصيغة "YYYY-Qن".
أجب حصرًا بمصفوفة JSON صالحة للمشاريع (بدون أي نص تمهيدي، بدون Markdown، بدون علامات backticks) — فقط: [ {...}, {...} ]`;
}

async function callGeminiOnce(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`Gemini HTTP ${res.status}: ${errText}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text || "").filter(Boolean).join("\n");
  if (!text) throw new Error("رد Gemini لا يحتوي على نص");
  return text;
}

// يعيد المحاولة عند 503 (ازدحام) أو 429 (تجاوز حصة) أو أخطاء شبكة عابرة
async function callGeminiWithRetry(prompt) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callGeminiOnce(prompt);
    } catch (e) {
      lastErr = e;
      const retryable = e.status === 503 || e.status === 429 || !e.status;
      if (!retryable || attempt === MAX_RETRIES) {
        throw e;
      }
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `محاولة ${attempt}/${MAX_RETRIES} فشلت (${e.message}). إعادة المحاولة بعد ${delay / 1000} ثانية...`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

function extractJsonArray(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("لم يُعثر على مصفوفة JSON في رد النموذج");
  const projects = JSON.parse(clean.slice(start, end + 1));
  if (!Array.isArray(projects) || !projects.length) throw new Error("مصفوفة المشاريع فارغة");
  return projects;
}

async function main() {
  const existing = loadExistingProjects();
  console.log(`جاري التحديث عبر Gemini (${MODEL})... عدد المشاريع الحالية: ${existing.length}`);

  console.log("جاري البحث الحي (DuckDuckGo)...");
  const searchContext = await gatherLiveSearchContext();
  console.log(`تم جمع سياق البحث (${searchContext.length} حرف).`);

  const prompt = buildPrompt(existing, searchContext);
  const text = await callGeminiWithRetry(prompt);
  const projects = extractJsonArray(text);

  const payload = {
    projects,
    generated_at: new Date().toISOString(),
    source_note: `محدّث تلقائيًا عبر GitHub Actions + بحث DuckDuckGo حي + Gemini (${MODEL}).`,
  };

  writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`تم التحديث بنجاح. عدد المشاريع الجديد: ${projects.length}`);
}

main().catch((err) => {
  console.error("فشل التحديث:", err);
  process.exit(1);
});
