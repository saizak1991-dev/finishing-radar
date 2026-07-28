# رادار التشطيبات — نسخة مستقلة تعمل ذاتيًا

هذا المشروع مستقل تمامًا عن أي واجهة محادثة. البيانات تُحدَّث تلقائيًا في الخلفية عبر GitHub Actions
كل 12 ساعة، والموقع نفسه صفحة ثابتة تُستضاف مجانًا على GitHub Pages.

## هيكل الملفات
```
index.html                        ← الواجهة (تقرأ data.json فقط، لا تستدعي أي API)
data.json                         ← البيانات الحالية (يُحدَّثها البوت تلقائيًا)
update-data.mjs                   ← سكربت Node.js يستدعي Gemini API ويكتب data.json
.github/workflows/update-data.yml ← الجدولة التلقائية (كل 12 ساعة + إمكانية تشغيل يدوي)
```

## خطوات النشر (مرة واحدة فقط)

1. **أنشئ حساب Google AI Studio** واحصل على مفتاح Gemini API مجاني:
   https://aistudio.google.com/apikey

2. **أنشئ مستودع جديد على GitHub** (Public أو Private، كلاهما يعمل مع Pages).

3. **ارفع كل ملفات هذا المجلد** إلى المستودع (بما فيها مجلد `.github` المخفي).

4. **أضف المفتاح كـ Secret**:
   - داخل المستودع: `Settings → Secrets and variables → Actions → New repository secret`
   - الاسم: `GEMINI_API_KEY`
   - القيمة: المفتاح الذي حصلت عليه من الخطوة 1

5. **فعّل GitHub Pages**:
   - `Settings → Pages → Source: Deploy from a branch`
   - اختر الفرع `main` والمجلد `/ (root)`
   - بعد دقيقة سيظهر رابط الموقع (مثل `https://username.github.io/repo-name/`)

6. **شغّل التحديث أول مرة يدويًا** (اختياري، بدل انتظار أول جدولة):
   - `Actions → تحديث بيانات الرادار → Run workflow`

بعدها الموقع سيعمل ويتحدّث نفسه تلقائيًا كل 12 ساعة، دون أي تدخل منك ودون أي اعتماد على
Claude أو أي أداة محادثة — فقط GitHub Actions + Gemini API بمفتاحك الخاص.

## تعديل جدولة التحديث
افتح `.github/workflows/update-data.yml` وعدّل سطر `cron`. أمثلة:
- كل 6 ساعات: `"0 */6 * * *"`
- مرة يوميًا الساعة 3 فجرًا UTC: `"0 3 * * *"`

## ملاحظة
`update-data.mjs` يستخدم نموذج `gemini-2.5-flash` مع أداة `googleSearch` للحصول على بيانات
حديثة من الويب. إن أردت استخدام نموذج آخر من Gemini، غيّر قيمة `MODEL` في أعلى الملف.
