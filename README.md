# whileAI

**Ask every AI at once, and see what waiting actually costs you.**

[**Add to Chrome — free**](https://chromewebstore.google.com/detail/jkemgnopkjenepaohooaghojmoabplmp)
 · [Site](https://ahmetyasin.github.io/WhileAI/)
 · [Releases](https://github.com/Ahmetyasin/WhileAI/releases)

Free. Every feature, no account, no limits.

A Chrome extension that does two things:

- **Broadcast** — type a prompt in ChatGPT, Claude, Perplexity, Gemini or
  DeepSeek, and the same prompt goes to the others you picked, in your own
  tabs, in your own signed-in sessions. No API keys, no accounts, no re-typing.
- **Measure** — it times every answer and shows where your waiting goes: which
  AI is slowest, how often you tab away mid-answer, what it adds up to over a
  week. Exportable, and free forever.

### Privacy

Your prompts and timings stay in your browser. There is no account, no
analytics and no telemetry. whileAI never reads the AI's replies — it watches
only whether an answer is still arriving, so it can time it. It never sees
your password: you sign in yourself.

Full detail: [PRIVACY.md](PRIVACY.md) · [PERMISSIONS.md](PERMISSIONS.md)

### How it behaves

It works only inside sessions you have already signed into, types at human
pace, and sends one prompt at a time per AI. It does not bypass anything: no
CAPTCHA solving, no working around a usage limit, no hidden sessions, no
pretending to be a different browser. When a site shows a verification check
or says you have hit a limit, whileAI stops and tells you.

Not affiliated with OpenAI, Anthropic, Perplexity, Google or DeepSeek.

---

## Geliştirici notları (Turkish, development only)

İki işi olan bir Manifest V3 tarayıcı eklentisi:

1. **Ölçer** — AI sohbet botlarında yanıt beklerken geçen süreyi sorgu (turn)
   bazında ölçer, beklerken sekmeden kaçıp kaçmadığını tespit eder, hepsini
   lokal bir dashboard'da gösterir.
2. **Yayınlar (broadcast, 0.5.0)** — Tek yere yazdığın promptu, zaten giriş
   yapmış olduğun diğer AI sitelerine kendi sekmelerinde gönderir; kuyruğu
   yönetir, her sağlayıcının durumunu eklenti popup'ında gösterir.

Proje belgesi: `CLAUDE.md` · Gizlilik: `PRIVACY.md` · İzin gerekçeleri: `PERMISSIONS.md`

## Kurulum (geliştirme)

```bash
npm install
npm test              # 160 birim testi
npm run build:dev     # dist/ — localhost test izinleri DAHİL
npm run build         # dist/ — temiz üretim paketi
npm run zip           # dist/chrome.zip + dist/edge.zip
```

## Desteklenen platformlar

| Platform | Host | Durum |
|---|---|---|
| ChatGPT | chatgpt.com | **Canlı doğrulandı 2026-09-06** — ölçüm + broadcast |
| Claude | claude.ai | **Canlı doğrulandı 2026-09-06** — ölçüm + broadcast |
| Perplexity | www.perplexity.ai | **Canlı doğrulandı 2026-09-06** — ölçüm + broadcast |
| Gemini | gemini.google.com | **Canlı doğrulandı 2026-09-06** — ölçüm + broadcast |
| DeepSeek | chat.deepseek.com | **Canlı doğrulandı 2026-09-06** — ölçüm + broadcast (XHR akışı) |

Gemini ve DeepSeek izinleri **opsiyoneldir** (sağlayıcıyı açınca istenir).
Adapter sağlık kontrolü kırıldığında sessiz kalmaz: panelde "needs an update"
rozeti çıkar.

## Canlı test durumu (2026-09-06)

Gerçek, giriş yapılmış hesaplarda, kullanıcının kendi Chrome'unda test edildi:

| Provider | Selector | Metin girişi (dry run) | Tek prompt gönderimi |
|---|---|---|---|
| ChatGPT | PASS | ✓ gönderilebilir | ✓ ulaştı |
| Claude | PASS | ✓ gönderilebilir | ✓ 6.0 sn |
| Gemini | PASS | ✓ gönderilebilir | ✓ 42.0 sn |
| Perplexity | PASS | ✓ gönderilebilir | ✓ ulaştı |
| DeepSeek | PASS | ✓ gönderilebilir | ✓ 133.9 sn |

Beş sağlayıcı da iki farklı sırada denendi; composer'da artık metin kalmadı.

**Cloudflare notu:** 2026-09-05'te Claude ve Perplexity'de görülen "Just a
moment..." duvarları **otomasyonla açılmış tarayıcıya** özeldi
(`navigator.webdriver === true`). Kullanıcının kendi Chrome'unda duvar
çıkmıyor. Parmak izi **taklit edilmedi** (§5.18); duvar çıktığında eklenti
durur ve bildirir, sessizce tekrar denemez (§5.17).

## Selector'ler bozulursa ne olur (mağaza onayı beklemeden düzeltme)

Selector'ler **kod değil veri**: `config/selectors.json` uzaktan çekilir ve
doğrulanır. Bir adapter üst üste iki kez başarısız olursa config **hemen**
yeniden çekilir (günlük döngü beklenmez); düzelirse kullanıcı fark etmez,
düzelmezse dashboard'da "needs an update" görünür. Ayrıntı:
`docs/REMOTE-UPDATES.md`.

## Broadcast (yayın) nasıl çalışır

Yan panelden (side panel) sağlayıcıları aç, kutuya promptu yaz, **Send to all**.
Eklenti her sağlayıcı için bir sekme açar (veya kendi açtığı sekmeyi yeniden
kullanır), promptu composer'a yazar, gönder'e basar ve durumu panelde gösterir.

- **Sağlayıcı başına tek uçuş:** bir sağlayıcıda cevap bitmeden sıradaki prompt
  ona gitmez. Sağlayıcılar birbirini beklemez (`lockstep` açık değilse).
- **İnsan temposu:** aynı sağlayıcıya ardışık gönderimler arasında en az 3 sn.
- **Giriş / doğrulama:** oturum kapalıysa veya Cloudflare çıkarsa durur, bildirir
  ve **aşmaya çalışmaz**. Giriş yapınca kaldığı yerden devam eder.
- **Gönderemezse susmaz:** hata durumunda panelde **Copy** ile promptu elle
  yapıştırabilirsin.
- **Kaynak sekme:** "Use the current tab as source" ile bir sekmeyi kaynak
  seçersen, orada sorduğun her şey diğer sağlayıcılara da gider.

Prompt metni yalnız kuyruk yaşarken saklanır, bittikten sonra silinir
(`keepHistory` kapalıyken). Cevap metni hiçbir zaman okunmaz.

## Sekme mi pencere mi?

- **"Left the tab"** = sekmeyi değiştirdin veya pencereyi küçülttün
  (`visibilityState !== 'visible'`). Sayaç: `escapeCount`, süre: `hiddenMs`.
- **"Tab open but browser in the background"** = sekme önde ama başka bir
  uygulamaya geçtin (`window.blur`). Bu bir "kaçış" sayılmaz, ayrı gösterilir.

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

### 3. Playwright ile uçtan uca (hesapsız)

```bash
npm run build:dev
npm run harness      # ayrı terminalde
npm run e2e          # gerçek Chrome + mock sağlayıcılar
```

`tests/e2e/broadcast.spec.ts` sahte sağlayıcı sayfalarına karşı çalışır, hesap
istemez. **Not:** Chrome 152 otomasyonla başlatıldığında `--load-extension`'ı
yok sayıyor; eklentiyi bir kez elle `chrome://extensions` → *Load unpacked* ile
`.pw-profile` profiline yüklemek gerekiyor. Yüklenmemişse ilgili testler
hata vermek yerine açıklamayla **skip** olur.

Gerçek sitelerde selector sağlığı (hesap gerekir, prompt **göndermez**, yalnız
okur):

```bash
npm run e2e:login    # tarayıcı açılır, sağlayıcılara elle giriş yap (bir kez)
npm run e2e:health
```

### 4. Dashboard'ı dolu görmek (demo veri)

```bash
node scripts/seed-demo-data.mjs   # whileai-demo.json üretir
```

Dashboard → **Import JSON** → `whileai-demo.json`. 30 günlük ~400 gerçekçi turn.
(Mağaza ekran görüntüleri de bu veriyle alınır.)

### 5. Gerçek sitelerde doğrulama

`chatgpt.com` ve `claude.ai`'de birer soru sor; popup ve dashboard'ı kontrol et.

**Kronometre protokolü (spec §8.4):** iki hafta boyunca her gün 5 turn'ü elde
kronometreyle ölç, kaydedilen `totalWaitMs` ile karşılaştır. Sapma %5'i
geçiyorsa yayınlama.

### 6. Kabul kriterleri (spec §10)

`chrome://extensions` → WhileAI → **service worker** konsolunda hata olmamalı.
Sekme arka planda `hiddenMs` birikmeli, ardışık iki hızlı mesaj karışmamalı,
5dk+ yanıtlar doğru ölçülmeli.

## Mimari (kısa)

- **MAIN world** (`main-world-*.js`): `fetch` sarmalanır, SSE gövdesi `tee()`
  ile gözlemlenir, sadece byte sayılır. `postMessage` ile bildirir.
- **ISOLATED content script**: üç sinyali (network / stop butonu / DOM class)
  `TurnTracker` state machine'inde birleştirir; `VisibilityTracker` bekleme
  sırasındaki görünürlüğü ölçer.
- **Service worker**: yazma, orphan süpürme, uzak selector config yenileme ve
  broadcast orkestrasyonu. Zaman ölçümü asla burada yapılmaz.
- **Broadcast**: saf reducer (`core/queue.ts`, hiç `chrome.*` yok, saat dışarıdan
  verilir) neyin nereye gideceğine karar verir; `core/orchestrator.ts` komutları
  uygular. Content script (`content/broadcast.ts`) aptaldır: gözlemler ve komut
  uygular, karar vermez. Service worker her an ölebildiği için durum daima
  storage'dadır ve uyanışta uçuştaki gönderimler sayfayla karşılaştırılır
  (aynı prompt iki kez gitmez).
- **Depolama**: ham turn'ler IndexedDB'de, günlük özet + ayarlar
  `chrome.storage.local`'da.

Mesaj içeriği hiçbir zaman okunmaz, saklanmaz, gönderilmez. Sunucu yok.
