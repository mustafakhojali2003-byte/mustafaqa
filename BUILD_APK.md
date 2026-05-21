# 📱 كيفية بناء APK لـ MUSTAFA.QA

## الطريقة 1: PWABuilder (الأسهل - 5 دقائق)
1. افتح: https://pwabuilder.com
2. أدخل: https://mustafaqa.vercel.app
3. اضغط Start → Android → Generate Package
4. حمّل APK مباشرة
5. ثبّته على الهاتف أو وزّعه

## الطريقة 2: Capacitor + Android Studio

### المتطلبات:
- Android Studio: https://developer.android.com/studio
- Java JDK 17+
- Node.js 18+

### الخطوات:
```bash
# 1. Clone المشروع
git clone https://github.com/mustafakhojali2003-byte/mustafaqa
cd mustafaqa

# 2. تثبيت الحزم
npm install

# 3. بناء التطبيق
npm run build

# 4. إضافة Android
npx cap add android

# 5. مزامنة الملفات
npx cap sync android

# 6. فتح في Android Studio
npx cap open android
```

### في Android Studio:
1. انتظر مزامنة Gradle
2. اضغط **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
3. الملف في: `android/app/build/outputs/apk/debug/app-debug.apk`

## الطريقة 3: Bubblewrap (APK خفيف - TWA)
```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest=https://mustafaqa.vercel.app/manifest.json
bubblewrap build
```

## ملاحظة:
التطبيق يعمل من URL مباشرة → أي تحديث في الكود يظهر تلقائياً
بدون الحاجة لرفع APK جديد في كل مرة!
