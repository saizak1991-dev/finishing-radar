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

const SEARCH_QUERIES = [
  "مشاريع عقارية جديدة دبي 2026",
  "مشاريع عقارية جديدة أبوظبي 2026",
  "Dubai off-plan projects handover update 2026",
  "Abu Dhabi off-plan projects handover update 2026",
];

async function duckDuckGoSearch(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; finishing-radar-bot/1.0)" },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const results = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && results.length < 5) {
    const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").trim();
    results.push({ title: strip(m[2]), snippet: strip(m[3]), url: m[1] });
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

async function callGemini(prompt) {
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
    throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text || "").filter(Boolean).join("\n");
  if (!text) throw new Error("رد Gemini لا يحتوي على نص");
  return text;
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
  const text = await callGemini(prompt);
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
