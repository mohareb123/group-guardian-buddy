# خطة شاملة: تحسين البث + إصلاح البحث + إصلاح تسجيل الدخول

## المشاكل الحالية

1. **تسجيل الدخول**: الداشبورد تطلب تسجيل دخول لكن لم يتم تفعيل auto-confirm للإيميل، فالمستخدم يسجل حساب ولا يستطيع الدخول لأن الإيميل غير مؤكد.
2. **البث محدود**: يرسل نص فقط، لا يدعم صور/فيديو/ملفات/استفتاءات/ملصقات، ولا يرسل لمستخدمي البوت بشكل فردي.
3. **البحث لا يعمل فعلياً**: يستخدم AI فقط لتوليد "نتائج وهمية" بدلاً من بحث حقيقي - الذكاء الاصطناعي لا يستطيع البحث في الإنترنت فعلياً، فالروابط والنتائج غير حقيقية.

---

## الخطة

### 1. إصلاح تسجيل الدخول

- تفعيل `auto-confirm` للإيميل عبر `configure_auth` حتى يتمكن المستخدم من الدخول مباشرة بعد التسجيل.

### 2. تطوير نظام البث في الداشبورد

**الواجهة (BroadcastPanel.tsx):**

- إضافة اختيار نوع الإشعار: نص / صورة / فيديو / صوت / ملف / استفتاء / ملصق
- إضافة رفع ملفات مباشرة (صور، فيديوهات،صوت، مستندات) عبر `<input type="file">`
- إضافة خيار الإرسال لـ: المجموعات فقط / مستخدمي البوت فقط / الكل
- إضافة إنشاء استفتاء (سؤال + خيارات)

**البنية التحتية:**

- إنشاء Storage Bucket لرفع ملفات البث
- تحديث `telegram-admin` Edge Function لدعم:
  - `sendPhoto` - إرسال صور
  - `sendVideo` - إرسال فيديو
  - `sendDocument` - إرسال ملفات
  - sendvoice- إرسال موسيقي او صوت
  - `sendPoll` - إرسال استفتاء
  - `sendSticker` - إرسال ملصقات
  - إرسال فردي لكل مستخدمي البوت (من جدول `telegram_users`)
- الملف يُرفع للـ Storage أولاً، ثم يُرسل الرابط العام للتيليجرام

### 3. إصلاح نظام البحث

المشكلة الحالية: البحث يستخدم AI فقط الذي يختلق نتائج وروابط غير حقيقية.

**الحل:**

- استخدام `websearch` API الحقيقي داخل Edge Function عبر Lovable AI Gateway مع `web_search_options` (الموديل يدعم ذلك)
- تعديل `searchBooks` لاستخدام Google Books API المجاني (`https://www.googleapis.com/books/v1/volumes?q=...`)
- تعديل `searchYouTube` لاستخدام بحث ويب حقيقي مع فلتر `site:youtube.com`
- تعديل `searchWeb` لاستخدام بحث ويب حقيقي مع عرض المصادر

---

## التفاصيل التقنية

### ملفات تُعدّل:

1. `**src/components/dashboard/BroadcastPanel.tsx**` - إعادة بناء كامل بواجهة متعددة الأنواع
2. `**supabase/functions/telegram-admin/index.ts**` - إضافة actions جديدة للوسائط المتعددة
3. `**supabase/functions/telegram-poll/index.ts**` - إصلاح دوال البحث الثلاث
4. **SQL Migration** - إنشاء Storage Bucket للبث

### ملفات تُنشأ:

- لا ملفات جديدة (التعديل على الموجود)

### تدفق رفع وإرسال الملفات:

```text
Dashboard → Upload to Storage → Get public URL → Edge Function → Telegram API (sendPhoto/sendVideo/sendDocument)
```

### تدفق البحث المُصلح:

```text
User /searchbook → Google Books API → Format results
User /searchyt → AI with web search → YouTube results  
User /searchweb → AI with web search → Web results with sources
```