# WhileAI

AI sohbet botlarında yanıt beklerken geçen süreyi sorgu (turn) bazında ölçen,
beklerken sekmeden kaçıp kaçmadığını tespit eden ve her şeyi lokal bir
dashboard'da gösteren Manifest V3 tarayıcı eklentisi.

Spec: `../DWELL_SPEC.md` · Gizlilik: `PRIVACY.md` · İzin gerekçeleri: `PERMISSIONS.md`

## Kurulum (geliştirme)

```bash
npm install
npm test              # 49 birim testi
npm run build:dev     # dist/ — localhost test izinleri DAHİL
npm run build         # dist/ — temiz üretim paketi
npm run zip           # dist/chrome.zip + dist/edge.zip
```

## Adım adım test

### 1. Birim testleri

```bash
npm test
```

TurnTracker state machine (üst üste turn, abort, sinyal ayrışması, saat
kayması), VisibilityTracker, metrikler, storage (IndexedDB + import/export),
adapter fixture'ları ve config doğrulaması.

### 2. Lokal harness ile uçtan uca test (hesap gerekmez)

```bash
npm run build:dev
npm run harness       # http://localhost:4173 — sahte ChatGPT
```

1. Chrome → `chrome://extensions` → sağ üstten **Geliştirici modu** aç
2. **Paketlenmemiş öğe yükle** → `whileai/dist` klasörünü seç
3. `http://localhost:4173` aç, **Send**'e bas
4. Beklerken eklenti ikonuna tıkla → **canlı sayaç** akmalı
5. Yanıt bitince popup'ta bugün özeti dolmalı (1 turn, ~5s)
6. Yeni bir Send at, beklerken **başka sekmeye geç**, sonra dön →
   dashboard'da "waiting spent elsewhere" > 0 olmalı
7. Send at, **Stop**'a bas → turn `aborted` sayılmalı (özete girmez)
8. **Research (multi-request)** butonuna bas → 3 ayrı istek + aralardaki
   boşluklara rağmen dashboard'da **tek** yanıt olarak ~20sn görünmeli
9. Research başlat, ortasında **sayfayı yenile** → yanıt kaybolmamalı;
   üretim sürerken sayfa açılınca turn kaldığı yerden devam eder (resume)
10. TTFT/Total alanlarından süreleri değiştir (ör. Total=130000 → research modu)

**Sorun görürsen:** Dashboard → Data → **Download debug log**. Her sinyal
(ağ/buton/DOM), turn açılış-kapanışları ve orphan süpürmeleri zaman damgalı
kaydedilir; dosyayı analiz için paylaş.

### 3. Dashboard'ı dolu görmek (demo veri)

```bash
node scripts/seed-demo-data.mjs   # whileai-demo.json üretir
```

Dashboard → **Import JSON** → `whileai-demo.json`. 30 günlük ~400 gerçekçi turn.
(Mağaza ekran görüntüleri de bu veriyle alınır.)

### 4. Gerçek sitelerde doğrulama

`chatgpt.com` ve `claude.ai`'de birer soru sor; popup ve dashboard'ı kontrol et.

**Kronometre protokolü (spec §8.4):** iki hafta boyunca her gün 5 turn'ü elde
kronometreyle ölç, kaydedilen `totalWaitMs` ile karşılaştır. Sapma %5'i
geçiyorsa yayınlama.

### 5. Kabul kriterleri (spec §10)

`chrome://extensions` → WhileAI → **service worker** konsolunda hata olmamalı.
Sekme arka planda `hiddenMs` birikmeli, ardışık iki hızlı mesaj karışmamalı,
5dk+ yanıtlar doğru ölçülmeli.

## Mimari (kısa)

- **MAIN world** (`main-world-*.js`): `fetch` sarmalanır, SSE gövdesi `tee()`
  ile gözlemlenir, sadece byte sayılır. `postMessage` ile bildirir.
- **ISOLATED content script**: üç sinyali (network / stop butonu / DOM class)
  `TurnTracker` state machine'inde birleştirir; `VisibilityTracker` bekleme
  sırasındaki görünürlüğü ölçer.
- **Service worker**: sadece yazma, orphan süpürme, uzak selector config
  yenileme. Zaman ölçümü asla burada yapılmaz.
- **Depolama**: ham turn'ler IndexedDB'de, günlük özet + ayarlar
  `chrome.storage.local`'da.

Mesaj içeriği hiçbir zaman okunmaz, saklanmaz, gönderilmez. Sunucu yok.
