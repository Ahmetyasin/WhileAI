# whileAI — CLAUDE.md

> Chrome eklentisi: kullanıcı bir AI sohbet sitesine (kaynak) prompt yazar, eklenti aynı promptu kullanıcının **kendi oturumu açık** diğer AI sitelerine (hedefler) ayrı sekmelerde gönderir, cevapları yan yana karşılaştırma imkânı verir, prompt kuyruğu yönetir ve AI cevabı beklerken geçen süreyi ölçer.
>
> Bu dosya projenin tek referansıdır ve **repo içinde versiyonlanır**
> (`whileai/CLAUDE.md`). Üst klasördeki `WhileAI/CLAUDE.md` yalnızca bunu
> içe aktaran bir işaretçidir — düzenleme hep BU dosyada yapılır.
> Karar değişirse önce bu dosya güncellenir, sonra kod.

---

## 0. DEVİR — yeni oturum buradan başlar

> **Bu bölüm her iş biriminden sonra güncellenir** (kural: §0.2). Yeni oturum
> eski sohbet kayıtlarını okumaz, testleri baştan koşmaz, "nerede kalmıştık"
> diye araştırma yapmaz: §0.1'deki tek kontrolü yapar ve **Sıradaki adım**'dan
> başlar.

**Son güncelleme:** 2026-09-12 — bakım turu (sağlık, mağaza) + belge düzeni ve devir protokolü

### Durum

| | |
|---|---|
| Mağaza | **Yayında, public** — https://chromewebstore.google.com/detail/jkemgnopkjenepaohooaghojmoabplmp |
| Sürüm | **0.8.2** (`src/manifest.json` + `package.json` — ikisi de). Mağazada "Updated: September 10, 2026". Bekleyen inceleme **yok** |
| Kullanıcı | **1** (2026-09-12, mağaza sayfası), 0 değerlendirme |
| Mağaza adı | `WhileAI — Ask Every AI, Track Your Wait` (pakette; değişmesi yeni inceleme demek) |
| Site | https://ahmetyasin.github.io/WhileAI/ (repo kökündeki `index.html`, build yok) |
| Fiyat | **Ücretsiz.** Ödeme kapısı kodda var ama kapalı (`core/entitlement.ts`, `FREE_BROADCASTS = Infinity`) |
| Trader | **Non-trader** beyan edildi — AMA mağaza sayfası "Developer" altında **posta adresini ve e-postayı yine de gösteriyor** (2026-09-12, Türkiye'den bakıldı, sayfada görünür olduğu doğrulandı; EEA görünümü test edilmedi). "Non-trader = yayınlanmaz" varsayımı yanlıştı |
| Selector sağlığı | 2026-09-12: 5/5 `ok` — ama bu ancak DeepSeek düzeltmesinden **sonra**. Selector config **v17 canlı** (push edildi ve raw URL'den doğrulandı; kurulumlar 6 saat içinde alır, yeni kurulum anında). Pakette gömülü kopya da v17, yani sıradaki mağaza sürümüyle beraber gider |
| Canlı doğrulama | 2026-09-12: **Gemini tam yoldan geçti** (gönderim → ilk token 0.3s → bitiş 5.6s). **DeepSeek** gönderdi ve cevapladı; ayrıntı aşağıda |
| Testler | 385 test / 24 dosya yeşil, typecheck yeşil (2026-09-12) |
| Son GitHub release | `v0.8.2`, `chrome.zip` ekli |

### Son oturumda yapılanlar (2026-09-12)
- Selector sağlık kontrolü: beş sağlayıcı da `ok`. Uzaktaki `selectors.json`
  (raw.githubusercontent) repodakiyle birebir aynı, sürüm 16.
- Mağaza durumu kontrol edildi (tablo yukarıda). Adres/e-posta bulgusu
  `docs/STORE-LISTING.md`'ye de yazıldı.
- Klasör düzeni: bu dosya repo'ya taşındı (`docs/CLAUDE.md` kopyası ve elle
  `cp` senkronu kaldırıldı); üst klasörde işaretçi kaldı. Devir protokolü
  (§0.1, §0.2) eklendi; kullanıcı her iş biriminden sonra otomatik
  commit + push'a kalıcı onay verdi (§0.2 madde 8).
- Yanlış belge iddiaları düzeltildi: var olmayan `lastVerified` alanı,
  `config.ts`'deki eskimiş "NOT yet verified" yorumu, non-trader iddiası,
  eski `HANDOFF.md` atıfları.
- **Canlı test (gerçek kota harcandı, kullanıcı onayıyla).** Gemini kusursuz.
  DeepSeek'te iki gerçek hata çıktı:
  1. **9 Eylül'deki sızıntının yarısı hâlâ açıkmış.** "Kullanıcı sırasının
     sanal liste anahtarı negatiftir" kuralı yalnız **taze** mesaj için
     doğru; sohbet sunucudan yüklenince aynı mesaj pozitif anahtarla geliyor.
     O anda devreye giren `.ds-message:not(:has(.ds-markdown))` yedeği
     DeepSeek'in kendi "Found 8 web pages" bildirimini yakalıyor.
     0.8.2 yapılandırmasında `getLastUserMessageText()` gerçekten
     "Found 8 web pages" döndürdü (önce KIRMIZI test yazılıp kanıtlandı).
     `CAPTURE_SETTLE_MS` 350 ms olduğu için yapısal koruma da yakalamıyordu.
     Düzeltme: kullanıcı sırası artık **içerdiği** şeyle tanınıyor
     (`.ds-collapsible-text`), yoklukla değil. Config v16 → **v17**.
  2. **`textarea#chat-input` ölmüş**; composer artık `textarea[name="search"]`.
     Eski sağlık kontrolü bunu göremiyordu çünkü "listeden biri tutuyorsa ok"
     diyordu. Artık **hangi** selector'ün tuttuğuna bakıyor: yalnız yedek
     tutuyorsa `degraded` diyor, cevap selector'lerini de kontrol ediyor.
- Ayrıca doğrulandı: **arka plandaki (gizli) sekmede DeepSeek sohbet
  geçmişini hiç çizmiyor** — sayfa boyanana kadar sanal liste boş. Eklenti bunu
  doğru ele alıyor (`judge()` yalnız gated/quota/other'da hata verir, "hiç
  çizilmedi" SUBMITTED sayılır; bitiş tespiti zaten XHR sinyalinden gelir),
  ama `scripts/live.mjs` bunu 5 dakika bekleyip yanlışlıkla ERROR sayıyor.

### Yarım kalan
- `scripts/live.mjs`: gizli sekmede "gönderildi ama doğrulanamadı" durumunu
  ERROR yerine kendi adıyla raporlamalı ve 5 dakika beklememeli.
- Mağaza sayfasındaki adres: panelde silindi, sayfa saatler sonra kontrol
  edilecek (aşağıda Sıradaki adım 1).

### Sıradaki adım (öncelik sırasıyla)
1. **Mağazadaki adres.** 2026-09-12: kullanıcı Developer Dashboard →
   Settings → Account → **Address** alanını sildi ve kaydetti (alan artık
   boş: "Enter address"). Mağaza sayfası kaydetmeden 10 dk sonra hâlâ eski
   adresi gösteriyordu. Birkaç saat sonra gizli sekmede tekrar bak;
   kalkmadıysa: liste-yalnız yeniden gönderim, grup yayıncıya taşıma ya da
   Google desteği. Adresin yanındaki e-posta **ayrı bir alandan** geliyor
   olabilir, o da kontrol edilecek. Sonuç buraya yazılır.
2. `scripts/live.mjs`'i gizli sekme için düzelt (bkz. Yarım kalan).
3. **Günlük:** `npm run health:watch` (debug tarayıcı açık olmalı, §14).
5. **Kaldırma oranı** (`docs/LEARNING-FROM-USERS.md`): 1 kullanıcıyla (büyük
   ihtimalle geliştiricinin kendisi) 7./28. gün oranı bilgi taşımıyor. Önce
   kurulum gelmeli; kanal kararı kullanıcıda.

---

## 0.1. Oturum başı protokolü (hızlı — dakikalar değil saniyeler)

1. §0'ı oku. **Eski sohbet kayıtlarını (`~/.claude/projects/*.jsonl`) okuma**;
   gereken her şey burada olmalı. Değilse bu bir belge hatasıdır → düzelt.
2. Tek komut: `git -C whileai status --short && git -C whileai log --oneline -3`
   (ya da repo içindeysen `-C whileai` olmadan).
   - Temiz → §0 günceldir, doğrudan **Sıradaki adım**'a geç.
   - Kirli ve §0 "Yarım kalan"da açıklanmış → beklenen, devam et.
   - Kirli ve açıklanmamış → önceki oturum yarıda kesildi: `git diff`'e bak,
     §0'ı ona göre düzelt, sonra devam et.
3. Testleri **yalnızca kod değiştireceksen** koş; son yeşil çalıştırma §0'da.
4. Kullanıcıya bir iki cümle: "Kaldığımız yer X, şimdi Y'yi yapıyorum" — ve başla.

## 0.2. Belgeleri güncel tutma kuralı (ZORUNLU)

Kullanıcının açık isteği (2026-09-12): her yeni sohbet, bir öncekinin **son
hâlinden** beklemeden devam edebilmeli. Sohbet geçmişi bir sonraki oturuma
taşınmaz; taşınan tek şey dosyalardır. Bu yüzden:

1. **Her anlamlı iş biriminden sonra §0'ı güncelle** — ne yapıldı, ne yarım,
   sıradaki adım. Oturumun sonunu bekleme: oturum her an kesilebilir.
2. Kod, karar veya davranış değişirse ilgili bölüm (ve `docs/` altındaki
   ilgili dosya) **aynı değişiklikte** güncellenir. Belgesi güncellenmemiş iş
   "bitti" sayılmaz.
3. Yanlış çıkan bir iddia görürsen **hemen** düzelt; "sonra" yok.
4. Kalıcı bilgi **bu dosyaya** yazılır, Claude'un hafızasına değil: proje
   klasörü taşınınca hafıza sıfırlanıyor (üç kez oldu: `Desktop/WhileAI` →
   `ownprojects` → `myprojects`). Bu dosya repo'yla birlikte taşınır.
5. §0 kısa kalır: "Son oturumda yapılanlar" yalnız **son** oturumu anlatır;
   bir öncekini §16 karar günlüğüne tek satır olarak taşı.
6. **Repo public.** Kişisel veri (adres, telefon, e-posta), token, şifre bu
   dosyaya ve `docs/`'a yazılmaz.
7. Oturum biterken son kontrol: §0 güncel mi, `## 16` güncel mi, `git status`
   temiz mi, `main` = `origin/main` mi.
8. **Commit + push — kullanıcının kalıcı onayı (2026-09-12).** Her iş birimi,
   §0 güncellemesiyle birlikte **aynı commit'te** commit edilir ve hemen
   `origin/main`'e push edilir; ayrıca sorulmaz. Conventional mesaj
   (`fix: …`, `docs: …`). Kod değiştiyse push'tan önce
   `npm run typecheck && npm test` yeşil olmalı. İstisnalar — bunlar **yine
   sorulur**:
   - `config/selectors.json` değişikliği: push'u altı saat içinde **tüm
     kurulumlara canlı gider** (§5.37), yani bir yayındır.
   - Force push, geçmişi yeniden yazma, tag/release silme ya da oluşturma,
     mağazaya paket yükleme.

## 0.3. Çalışma kuralları

1. Bir şeyi değiştirmeden önce `## 5 Kritik nüanslar` bölümünü kontrol et; çoğu hata orada önceden yazılı.
2. Aşağıdakiler için **durup kullanıcıya sor**: yeni bir Chrome izni eklemek, prompt metnini kalıcı saklamak, AI cevap metnini okumak/saklamak, dış servise istek atmak, provider listesi dışına çıkmak, **gerçek prompt göndermek** (kota harcar).
3. "Bitti" demeden önce: `npm run typecheck && npm run test` yeşil; ilgili manuel test listesi (`## 13`) elle geçilmiş; §0 ve `## 16` güncellenmiş.
4. Bir selector'ü değiştiriyorsan siteyi gerçekten aç, DevTools ile doğrula, `src/core/config.ts`'de o platformun yanındaki **"Verified live YYYY-MM-DD"** yorumunu güncelle (`lastVerified` diye bir alan YOK). Selector'lar **iki kopyada** durur — bkz. §5.37.
5. **Canlı test:** tek pencere. Önce `curl -s 127.0.0.1:9334/json/version` — cevap veriyorsa **bağlan, yeni tarayıcı açma**. Şifre/2FA asla istenmez ve girilmez; doğrulama duvarı aşılmaz (§5.36).
6. **Doğrula, varsayma.** Bu projede en pahalı hatalar "yazdım, olmuştur"
   varsayımından çıktı: yeşil bir test hatayı yakaladığını ispatlamaz (eski
   kodu geri koyup KIRMIZI gör), yazılmış bir dosya doğru içeriği taşımaz
   (geri oku), gönderilmiş bir prompt ulaşmış demek değildir (hedef sekmeye
   bak), üretilmiş bir zip güncel `dist/`'ten gelmiş olmayabilir (içindeki
   manifest sürümünü oku).
7. **Kullanıcıya dürüst raporla.** Neyin doğrulandığını ve neyin
   doğrulanmadığını ayır. Yapılmamış bir şeyi "yaptım" deme; bir tavsiyeyi
   ölçemiyorsan (ör. mağaza arama sıralaması) bunu söyle, tahmini kesinlik
   gibi sunma.

---

## 1. Ürün

**Tek cümle:** "Tek yere yaz, hepsine sor." Kullanıcı Claude'a (veya seçtiği kaynağa) yazar; ChatGPT, Gemini, DeepSeek vb. aynı soruyu kullanıcının kendi hesabından, kendi sekmelerinde otomatik alır.

**Kullanıcı hikâyesi (MVP):**
1. Kullanıcı options'tan hedef provider'ları seçer (ör. ChatGPT, Gemini). Zaten o sitelere login'dir.
2. claude.ai'de promptu yazıp gönderir.
3. Eklenti promptu yakalar, bir "Compare" penceresi açar (yoksa), her hedef için sekme açar/yeniden kullanır, promptu yapıştırır, gönderir.
4. Side panel'de her provider'ın durumu görünür: yazılıyor → gönderildi → üretiyor → bitti (süre).
5. Kullanıcı ikinci promptu yazarsa kuyruğa girer; bir provider'da öncekisi bitince otomatik gider.
6. Dashboard: bugün / bu hafta / toplam bekleme süresi, provider bazında ortalama cevap süresi.

**Kapsam dışı (MVP'de yapma):**
- Backend, hesap sistemi, senkronizasyon, telemetri.
- AI cevaplarını okuyup tek ekranda birleştirme (Compare View) — Faz 6+, ayrı karar.
- Login yapmak, şifre saklamak, CAPTCHA/Cloudflare aşmak. **Asla.**
- Mobil, Firefox (Edge Chromium olduğu için bedavaya çalışır).
- Ödeme/Pro. Sadece `features.ts` içinde flag bırak.

**Çalışma adı:** whileAI. Mağaza adı karara bağlandı, bkz. `## 16`.

---

## 2. Teknoloji kararları (kesin)

> **Bu tablo 2026-09-09'da gerçeğe göre düzeltildi.** Önceki hâli hiç
> kurulmamış bir projeyi anlatıyordu (WXT / Preact / zod / idb / pnpm);
> gerekçeler `## 16` karar günlüğünde, 2026-09-05 girdisinde.

| Konu | Karar | Neden |
|---|---|---|
| Manifest | **MV3** | Zorunlu (MV2 kabul edilmiyor) |
| Dil | **TypeScript strict** | Adapter'lar ve state machine tip güvenliği ister |
| Build | **esbuild** (`scripts/build.mjs`) | WXT yok. `npm run build` / `build:dev` / `zip` |
| UI | **Vanilla TS + CSS** (`src/ui/`) | Preact yok. Dashboard ve popup elle çiziliyor |
| Durum | Kendi reducer'ı (`core/queue.ts`) | State machine saf fonksiyon, jsdom'suz test edilir |
| Şema | **Elle yazılmış doğrulayıcılar** | zod yok. `validateConfig`, `parseBroadcastMessage` |
| Depolama | `chrome.storage.local` + `chrome.storage.session` + **IndexedDB (elle)** | idb yok; `core/storage.ts` |
| Test | **Vitest** (`__tests__/`), **Playwright** (`tests/e2e/`) | `tests/unit/` YOK — bkz. `## 13` |
| Paket | **npm** | pnpm yok; `package-lock.json` |

Veritabanı sunucusu **gerekmez**. Her şey kullanıcının tarayıcısında kalır. Bu aynı zamanda gizlilik vaadidir.

## 3. Mimari

```
┌──────────────────────────────────────────────────────────────┐
│  Service Worker (background)  — ORCHESTRATOR                 │
│  • tek gerçek: storage'daki state                            │
│  • reducer'ı çalıştırır, komut üretir, tab yönetir            │
│  • alarms, notifications, tabs, scripting, webNavigation      │
└───────┬───────────────────────┬──────────────────────┬────────┘
        │ messages              │ messages             │ storage
┌───────▼────────┐    ┌─────────▼──────────┐   ┌───────▼────────┐
│ Content script │    │ Content script     │   │ Popup + Dash.  │
│ SOURCE adapter │    │ TARGET adapter(s)  │   │ + Options UI   │
│ (herhangi biri)│    │ (chatgpt, gemini…) │   │ (vanilla TS)   │
│ • prompt yakala│    │ • insert, submit   │   │ • sağlayıcılar │
│ • bildir       │    │ • generating/done  │   │ • dashboard    │
└────────────────┘    │   gözlemle, bildir │   │ • ayarlar      │
                      └────────────────────┘   └────────────────┘
```

**İlke:** Content script'ler **aptaldır**. Sadece gözlemler ve komut uygular; karar vermez. Tüm karar mantığı `core/queue.ts` (saf reducer) + `core/orchestrator.ts` (yan etkiler) içindedir. Böylece state machine jsdom olmadan %100 unit test edilir.

### 3.1 Mesaj protokolü (`core/messages.ts`; zod YOK, elle doğrulayıcı `parseBroadcastMessage`)

Content script → SW (**gözlemler**):
`READY`, `NOT_LOGGED_IN`, `CHALLENGE_DETECTED`, `PROMPT_CAPTURED {text, hash}`, `INSERTED`, `SUBMITTED`, `GENERATING`, `DONE`, `ERROR {code, detail}`

SW → Content script (**komutlar**):
`PING`, `GET_STATE`, `NEW_CHAT`, `INSERT_AND_SUBMIT {promptId, text}`, `CANCEL`

Her mesaj `{ v: 1, type, promptId?, providerId, tabId?, ts }` taşır. Tek atımlık `chrome.runtime.sendMessage` + `chrome.tabs.sendMessage`; uzun ömürlü `Port` **kullanma** (SW uyuyunca kopar).

### 3.2 Durum makinesi (`core/queue.ts`)

```ts
type RunState =
  | 'queued' | 'opening_tab' | 'waiting_ready' | 'inserting' | 'submitted'
  | 'generating' | 'done'
  | 'needs_login' | 'blocked_challenge' | 'timeout' | 'error' | 'cancelled';

interface PromptItem { id: string; text: string; hash: string; createdAt: number;
  sourceProviderId: ProviderId; mode: 'continue' | 'new_chat'; runs: Record<ProviderId, ProviderRun>; }

interface ProviderRun { providerId: ProviderId; state: RunState; tabId?: number;
  attempts: number; enqueuedAt: number; submittedAt?: number; firstTokenAt?: number;
  completedAt?: number; error?: string; }
```

Kurallar:
- **Provider başına tek uçuş** (lane). Aynı provider'da bir run terminal duruma (`done|timeout|error|cancelled|needs_login|blocked_challenge`) gelmeden sıradaki prompt o provider'a gitmez.
- Terminal durumların her biri bir `WaitEvent` üretir (`## 8`).
- `lockstep` ayarı (default kapalı): açıkken bir prompt tüm provider'larda bitmeden sıradaki başlamaz.
- Reducer saf: `(state, event) => { state, commands[] }`. Komutları orchestrator uygular.

---

## 4. Provider adapter sözleşmesi (`adapters/types.ts`)

> **Aşağıdaki arayüz ORİJİNAL SPEC'tir; kod ondan saptı.** Gerçekte adapter
> config güdümlüdür: selector'lar `src/core/config.ts` (`EMBEDDED_CONFIG`) +
> `config/selectors.json` içinde veri olarak durur; davranış
> `src/adapters/baseAdapter.ts` (gözlem) ve `broadcastAdapter.ts` (gönderme,
> composition ile sarar) içindedir. `lastVerified` / `version` alanları YOK —
> doğrulama tarihi, config.ts'de her platformun yanındaki "Verified live
> YYYY-MM-DD" yorumudur. Selector değiştirmeden önce §5.37'yi oku.

```ts
export interface ProviderAdapter {
  id: ProviderId;                 // 'chatgpt' | 'claude' | 'gemini' | 'deepseek' | 'grok' | 'perplexity' | ...
  displayName: string;
  matches: string[];              // host permission pattern'leri, ör. 'https://chatgpt.com/*'
  baseUrl: string;                // yeni sohbet için gidilecek URL
  version: string;                // adapter versiyonu, selector değişince artır
  lastVerified: string;           // 'YYYY-MM-DD' — selector'ların gerçek sitede en son doğrulandığı gün

  // Gözlem (hepsi DOM'a bakar, hiçbiri yan etki yapmaz)
  isLoginPage(): boolean;
  isChallengePage(): boolean;     // Cloudflare / "unusual activity" / CAPTCHA
  isComposerReady(): boolean;
  isGenerating(): boolean;
  getLastUserMessageText(): string | null;   // kaynak modunda prompt yakalamak için
  getConversationUrl(): string;

  // Eylem
  insertText(text: string): Promise<boolean>;  // editor state'in gerçekten değiştiğini doğrular
  submit(): Promise<boolean>;                   // send butonuna basar; Enter sentezleme SON çare
  newChat(): Promise<void>;

  // Sağlık
  healthCheck(): { ok: boolean; missing: string[] };  // kritik selector'ler bulunuyor mu
}
```

**Başlangıç ipuçları (tarihsel; güncel selector'lar `src/core/config.ts`'de):**

| Provider | Composer | Send | Stop/generating | User mesaj node |
|---|---|---|---|---|
| ChatGPT `chatgpt.com` | `#prompt-textarea` (ProseMirror contenteditable) | `button[data-testid="send-button"]` | `button[data-testid="stop-button"]` | `[data-message-author-role="user"]` |
| Claude `claude.ai` | `div.ProseMirror[contenteditable="true"]` | `button[aria-label*="Send"]` | `button[aria-label*="Stop"]` | `[data-testid="user-message"]` |
| Gemini `gemini.google.com` | `rich-textarea .ql-editor` (Quill) | `button[aria-label*="Send"]` | `button[aria-label*="Stop"]` | `user-query` |
| DeepSeek `chat.deepseek.com` | `textarea#chat-input` | role=button, ikon; doğrula | doğrula | doğrula |

Bu selector'lar **aylık kırılır**. Her adapter için: birincil selector → 2 fallback (aria/role/contenteditable heuristics) → `healthCheck` fail = UI'da kırmızı "ChatGPT adapter güncelleme istiyor" rozeti. Sessiz başarısızlık **yasak**.

---

## 5. Kritik nüanslar (bilinmezse proje çöker)

### Service worker & yaşam döngüsü
1. **SW her an ölebilir** (30 sn boşta). Bellekte tutulan her şey kaybolur. Kural: state daima storage'da; SW uyanınca `hydrate()` ile storage'dan yeniden kurar. `setTimeout` > 30 sn yerine `chrome.alarms` (min periyot 30 sn / `periodInMinutes: 0.5`).
2. Uçuş halindeki `providerId → tabId` haritası `chrome.storage.session`'da (SW restart'ı atlatır, tarayıcı kapanınca temizlenir). Uyanışta her tabId `chrome.tabs.get` ile doğrulanır; yoksa run `error` değil `opening_tab`'a geri döner.
3. **Idempotency:** SW `submitted` yazamadan ölürse aynı prompt iki kez gidebilir. Çözüm: `INSERT_AND_SUBMIT` öncesi `state='inserting'` yaz; uyanışta `inserting|submitted` durumdaki run için content script'e `GET_STATE` sor; adapter `getLastUserMessageText()` hash'i promptla eşleşiyorsa tekrar gönderme.

### Content script
4. `run_at: document_idle`. Siteler SPA: sohbet değişince sayfa yenilenmez. `chrome.webNavigation.onHistoryStateUpdated` ile SW haber verir, content script `reinit()` yapar. Çift enjeksiyon koruması: `if (window.__whileai) return;`.
5. **Tab discard / Memory Saver:** arka plan sekmesi discard edilirse content script ölür. `chrome.tabs.onUpdated` ile yakala; komut göndermeden önce `PING`, cevap yoksa `chrome.scripting.executeScript` ile yeniden enjekte et.
6. **Arka plan sekme throttling:** gizli sekmelerde timer'lar 1 dk'ya kadar kısılır. Polling **yok**; `MutationObserver` kullan. Compare penceresi görünür (minimize değil) tutulmalı; kullanıcıya bunu söyle.
7. İzole dünya (ISOLATED) yeter; `world: 'MAIN'` gerekmez. Sayfanın React state'ine dokunma, DOM'a ve olaylara dokun.

### Metin girme (en çok kırılan yer)
8. **ProseMirror / Quill / React-controlled textarea'ya `.value=` veya `innerText=` yazmak çalışmaz** (framework state güncellenmez, send butonu pasif kalır). Strateji sırası, her adımda "send butonu aktif oldu mu?" doğrula:
   1. `el.focus(); document.execCommand('insertText', false, text)`
   2. `paste` olayı: `new ClipboardEvent('paste', { clipboardData: dt })` (DataTransfer ile `text/plain`)
   3. Textarea için native setter: `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,text); el.dispatchEvent(new InputEvent('input',{bubbles:true}))`
   4. Hiçbiri olmadıysa `ERROR{code:'INSERT_FAILED'}` — kullanıcıya göster, sessiz kalma.
9. Çok satırlı prompt: `insertText` satır sonlarını çoğu editörde korur; ProseMirror'da `\n` → paragraf. Test fixture'ında çok satırlı + kod bloklu prompt olsun.
10. **Submit = send butonuna tıkla**, `Enter` keydown sentezleme yalnızca fallback (bazı editörlerde Enter satır ekler, IME sorunları çıkar). Butonun `disabled` kalkmasını bekle (max 3 sn).

### Bitiş tespiti
11. Tek sinyale güvenme. `isGenerating()` = stop butonu var **veya** `aria-busy`/streaming sınıfı var. `DONE` = `isGenerating()` false **ve** son cevap node'unun metin uzunluğu 1.5 sn boyunca sabit (debounce). Ek koruma: provider başına `maxWaitMs` (default 5 dk; "uzun mod" 30 dk — Deep Research/thinking için) → `timeout`.
12. `firstTokenAt`: cevap node'u ilk kez göründüğünde. Dashboard'da "ilk token süresi" ayrı metrik.

### Kaynak yakalama
13. Promptu **keydown/click ile değil DOM'dan** yakala: yeni user mesaj node'u belirince metnini al (`getLastUserMessageText`). Keydown/click sadece erken sinyal. Dedupe: `sha256(text)` + 10 sn pencere; aynı hash tekrarsa yoksay (regenerate, edit, sayfa yenileme).
14. Kullanıcı aynı sitede birden çok sekme açmış olabilir. Kaynak modu **tek sekmede** aktif: side panel'den "bu sekme kaynak" seçilir, storage'da `sourceTabId`. Diğer sekmelerdeki aynı adapter sadece hedef olabilir.
15. Kaynak sitenin kendisi hedef listesinde olmaz (ChatGPT kaynaksa ChatGPT'ye tekrar gönderilmez).

### Login, engel, hata
16. `isLoginPage()` = URL kalıbı (`/login`, `auth.openai.com`, `accounts.google.com`) **veya** 8 sn içinde composer yok. → `needs_login`, `chrome.notifications` ("Gemini'de oturum kapalı, giriş yap"), sekmeyi öne getir. Composer belirince run otomatik `queued`'a döner ve devam eder.
17. **Challenge (Cloudflare, CAPTCHA, "unusual activity", rate limit banner)** → `blocked_challenge`, bildirim, dur. **Aşmayı deneme, bekleyip tekrar deneme yok.** Kullanıcı çözer, "Devam" der.
18. **İnsan temposu.** Bu eklenti kullanıcının yerine yapıştır-gönder yapar; bot gibi davranmaz: aynı provider'a ardışık gönderimler arası min 3 sn, provider başına tek uçuş, toplu/gizli sekme yok, headless yok, cevap kazıma yok. "Bot algılanmama" hedefi bunun dışında bir teknik içermez — gizleme/spoof (user-agent, fingerprint vb.) **yapılmaz**.
19. Hata mesajları kullanıcı dilinde ve eylem içerir: "ChatGPT'ye yapıştıramadım (adapter eski olabilir). Elle yapıştırmak için promptu kopyala." + Kopyala butonu.

### Sekme/pencere yönetimi
20. Bir **Compare penceresi** (`chrome.windows.create`), içinde provider başına bir sekme; tab group ile renk. Pencere/sekme id'leri `storage.session`'da; her komut öncesi doğrula. Her prompt için yeni sekme **açma** — mevcut sekmeyi yeniden kullan.
21. `mode: 'continue'` (default) aynı sohbette devam; `'new_chat'` → `adapter.newChat()` = `baseUrl`'e git, `isComposerReady()` bekle.
22. Pencere düzeni (yan yana döşeme) Faz 5; `chrome.system.display` izni gerektirir → kullanıcıya sor.

### İzin & mağaza
23. `host_permissions` **yalnızca beş sağlayıcı domaini**, `<all_urls>` **yok**.
    Gerçek izin listesi (`src/manifest.json`, 2026-09-09'da doğrulandı):
    `storage`, `alarms`, `notifications`, `tabs`, `scripting`, `webNavigation`,
    `tabGroups`. **`sidePanel` YOK** — yan panel yerine popup kullanıldı.
    Gerekçeler `PERMISSIONS.md` (kök, `docs/permissions.md` değil) ve
    `docs/STORE-LISTING.md` içinde; mağaza formuna oradan yapıştırılıyor.
    Yeni izin eklemek `## 0.3` madde 2 gereği **kullanıcıya sorulur**.
24. MV3'te uzaktan kod yok; tüm JS bundle içinde. Gizlilik politikası URL'si zorunlu (statik sayfa yeter). "Single purpose" açıklaması: "Send one prompt to multiple AI chat services you are logged into and track waiting time."
25. Marka: "Works with ChatGPT, Claude, Gemini" tamam; logolarını kullanma; bağlılık iddia etme.

### Gizlilik & ToS
26. Prompt metni yalnızca kuyruk yaşamı boyunca `storage.local`'da; terminal olduktan sonra silinir. Geçmiş saklama **opt-in** ve default kapalı. Konsola prompt yazma. (`logger.ts` diye ayrı bir dosya YOK; debug logu `chrome.storage.local` içindeki `debugLog` anahtarında tutulur, `npm run logs` ile okunur.)
27. AI cevabını **okuma** yalnız bitiş tespiti için (uzunluk/sabitlik). Metni saklama/iletme yok. Compare View (Faz 6+) bu ilkeyi değiştirecekse ayrı karar.
28. Tüketici arayüzünü otomatikleştirmek provider ToS'lerinde gri alandır. Kullanıcı kendi hesabıyla, kendi tarayıcısında, kendi tempoda kullanır; eklenti bunu README ve mağaza açıklamasında dürüstçe söyler. Sorumluluk reddi README ve mağaza açıklamasında; ayrı bir `docs/tos.md` YOK.

### Canlı test tuzakları (hepsi gerçekten yaşandı, tekrar etmesin)

31. **`chrome.tabs.sendMessage` yalnızca ALICI YOKKEN reddeder.** Mesajı alıp
    `sendResponse` çağırmayan bir content script promise'i sonsuza kadar
    bekletir: hata yok, log yok, state değişmiyor — "hâlâ çalışıyor"dan
    ayırt edilemez. Bu kusur **üç ayrı yolda** çıktı (delivery, GET_STATE,
    popup `loginState`). Her çağrı kendi zaman aşımına sahip olmalı; sekmeyi
    yoklayan döngüler **duvar saatiyle** sınırlanır, iterasyon sayısıyla değil.
    "Cevap yok" (ölü) ile "cevabı çözemedik" (`ALIVE_UNPARSED`) ayrı şeylerdir.
32. **Bir AI'ın kendi arayüz metni prompt sanılabilir.** §5.13 "DOM'dan yakala"
    diyor ama hangi düğümün kullanıcıya ait olduğunu da kanıtlamak gerekiyor —
    bkz. `## 16`, 2026-09-09 girdisi ve `CAPTURE_SETTLE_MS`.
33. **Eklenti reload'u açık sekmeleri kapatır.** `chrome.runtime.reload()`
    sonrası dashboard/popup sekmeleri gider. IndexedDB verisi kalır ama
    ayarlar `broadcastSettings` sıfırlanmış olabilir — reload'dan sonra
    yeniden kur ve **doğrula**, varsayma.
34. **CDP ile canlı test:** `Extensions.loadUnpacked` **tarayıcı seviyesinde**
    bir komuttur; sayfa hedefine gönderilirse "Method not available" der.
    Sayfa içinden `location.href = ...` yazmak CDP oturumunu koparır —
    `Page.navigate` kullan.
35. **Sağlayıcı arayüzleri tanıtım görselini bozar.** ChatGPT kayıt sırasında
    kota uyarısı, "Try Plus free" reklamı ve anket gösterdi; Gemini arayüzü
    Türkçe açıldı (`?hl=en` ile İngilizce'ye alındı). Ekran görüntüsü almadan
    önce **ekranda ne olduğuna bak**.
36. **Cloudflare duvarı ("Just a moment...") test yönteminden gelir, üründen
    değil.** Otomasyonla açılan Chrome'da `navigator.webdriver === true` olur
    ve Claude/Perplexity bunu görüp duvar çeker. Normal açılmış Chrome'da
    (`npm run browser`, sadece debug portu) `false`'tur, duvar yok
    (2026-09-05'te kanıtlandı). Bayrağı gizlemek/spoof etmek **yasak** (§5.18):
    hesabı riske atar, mağaza reddettirir. Duvar görürsen sebebini söyle.
37. **Selector'lar iki elle tutulan kopyada durur:** `EMBEDDED_CONFIG`
    (`src/core/config.ts`, pakette gelir) ve `config/selectors.json` (GitHub
    raw'dan uzaktan çekilir). Build birinden diğerini üretmez. Uzak kopya
    yalnız `version` **büyükse** kazanır; yani sadece JSON'u düzeltmek, sürümü
    artırmadan hiçbir kurulumu değiştirmez. İkisini birlikte değiştir, ikisinde
    de `version`'ı artır; `__tests__/config.test.ts` kopyalar ayrışırsa kırmızı
    olur. Uzaktaki dosya push'tan sonra altı saat içinde kurulumlara ulaşır.

### Süre semantiği
29. `waitMs = completedAt − submittedAt` (provider başına). Paralel beklemeler üst üste biner; dashboard **iki** sayı gösterir: toplam provider-bekleme (sum) ve gerçek duvar saati beklemesi (aralıkların birleşimi). "Gün" yerel saat dilimi; hafta ISO (Pazartesi).
30. Zaman olayı yalnız terminal durumda yazılır. `timeout|error` da yazılır (`status` alanıyla), dashboard filtreler.

---

## 6. Depolama & veri modeli

> **ORİJİNAL SPEC — kod saptı.** Gerçek: `src/core/storage.ts` +
> `src/core/broadcastStorage.ts`; IndexedDB elle yazılmış, `waitEvents` store'u
> YOK — ölçümler mevcut `Turn` kayıtlarına yazılır (karar günlüğü 2026-09-05).
> Aşağıdaki şema niyeti anlatır, alan adları için koda bak.

```ts
// chrome.storage.local
settings: { version: 1; providers: Record<ProviderId,{enabled:boolean; maxWaitMs:number; longMode:boolean}>;
            sourceProviderId: ProviderId; mode:'continue'|'new_chat'; lockstep:boolean;
            keepHistory:boolean; notifications:boolean; }
queue:    { items: PromptItem[] }         // terminal olanlar temizlenir (keepHistory false ise)
adapters: Record<ProviderId,{ health:'ok'|'degraded'|'broken'; lastChecked:number }>

// chrome.storage.session
runtime:  { compareWindowId?:number; tabs: Record<ProviderId, number>; sourceTabId?:number; leaderLock?:string }

// IndexedDB 'whileai' → store 'waitEvents' (keyPath 'id', index 'day', 'providerId')
WaitEvent { id:string; promptId:string; providerId:ProviderId; submittedAt:number; firstTokenAt?:number;
            completedAt:number; durationMs:number; status:'done'|'timeout'|'error'; day:'YYYY-MM-DD'; }
```

- `storage.local` kotası 10 MB — prompt metni saklamadığın sürece sorun değil; olay logu IndexedDB'de.
- Tüm okuma/yazma `core/storage.ts` üzerinden, zod ile `parse`; şema `version` alanı ve `migrate()`.
- Export: dashboard'dan JSON/CSV (kullanıcı verisi kullanıcıya ait).

---

## 7. Kuyruk yönetimi

- FIFO. Yeni yakalanan prompt `items`'a eklenir; her aktif hedef provider için `run` oluşur.
- Provider lane'i boşsa run hemen `opening_tab`'a geçer; değilse `queued` bekler.
- UI'dan: sırayı değiştir, tek provider için iptal, promptu düzenle (yalnız `queued`), "hepsini temizle".
- Kullanıcı kaynağa yazmadan da side panel'deki kutudan prompt ekleyebilir (kaynak sekme gerekmez). Bu, adapter'ları kaynak olmadan test etmenin de yolu (Faz 0).
- Tekrar deneme: `error` için 1 otomatik retry (attempts ≤ 2), sonra kullanıcıya bırak. `needs_login`/`blocked_challenge` için otomatik retry **yok**.

---

## 8. Zaman takibi & dashboard

Metrikler (hepsi `core/metrics.ts`, saf fonksiyonlar, unit testli):
- Bugün / bu hafta / toplam: provider-bekleme (sum), duvar saati beklemesi (union), prompt sayısı.
- Provider başına: ortalama süre, medyan, ilk token ortalaması, timeout oranı.
- En uzun bekleme (hangi prompt, hangi provider).
- Basit grafik: son 7 gün günlük bekleme (SVG, kütüphane yok).
- Saklama süresi ayarı (default sonsuz; kullanıcı silebilir).

Dashboard'un ekran görüntüsü pazarlama malzemesidir; ilk günden **paylaşılabilir** görünsün (okunaklı, tek bakışta anlaşılır, dark/light).

---

## 9. Bildirim politikası

`chrome.notifications` yalnız şu durumlarda: `needs_login`, `blocked_challenge`, `error` (retry bitti), `timeout`, adapter `broken`. Başarıda bildirim yok (opsiyonel: "tüm provider'lar bitti" tek bildirim, ayar default kapalı). Bildirime tıklama → ilgili sekmeyi öne getir.

---

## 10. Repo yapısı (gerçek ağaç, 2026-09-09)

> Repo kökü `whileai/` klasörünün **içidir**. GitHub'da dosya yolu
> `PERMISSIONS.md`, `whileai/PERMISSIONS.md` değil — site linkleri bu yüzden
> bir kere 404 verdi.

```
WhileAI/                            ← sohbeti BU klasörde aç (git reposu değil)
├─ CLAUDE.md                        # işaretçi: `@whileai/CLAUDE.md` içe aktarır
├─ whileai-recordings/              # repo DIŞI ham kayıt kareleri (19MB)
└─ whileai/                         ← repo kökü (GitHub: Ahmetyasin/WhileAI, public)
├─ CLAUDE.md                        # ASIL proje belgesi (bu dosya)
├─ src/
│  ├─ manifest.json                 # sürüm burada; package.json ile aynı olmalı
│  ├─ background/                   # service worker: orchestrator, tabRegistry
│  ├─ content/  index.ts            # tracking (document_start)
│  │            broadcast.ts        # broadcast (document_idle)
│  │            captureGuard.ts deliveryVerdict.ts doneDetector.ts
│  ├─ adapters/ baseAdapter.ts broadcastAdapter.ts registry.ts
│  │            chatgpt/ claude/ perplexity/ gemini/ deepseek/
│  │            insertText.ts domHelpers.ts mainWorldCore.ts
│  ├─ core/     queue.ts orchestrator.ts storage.ts broadcastStorage.ts
│  │            messages.ts tabs.ts metrics.ts config.ts constants.ts
│  │            TurnTracker.ts VisibilityTracker.ts reclassify.ts
│  │            entitlement.ts licence.ts features.ts adapterHealth.ts
│  └─ ui/       dashboard/ popup/ theme.css
├─ __tests__/                       # Vitest (§13 — `tests/unit/` DEĞİL)
├─ tests/e2e/                       # Playwright
├─ config/selectors.json            # uzaktan güncellenen selector'lar
├─ scripts/    build.mjs            # esbuild
│              make-store-shots.mjs # 5 mağaza görseli
│              make-demo-gif5.mjs make-demo-mp4.mjs
│              watch-health.mjs live-health.mjs sync-selectors.mjs
│              seed-demo-data.mjs   # dashboard için sahte veri
├─ docs/       PUBLISHING.md STORE-LISTING.md PAYMENTS.md POLAR-SETUP.md
│              REMOTE-UPDATES.md LEARNING-FROM-USERS.md
│              MANUAL-TEST-STEPS.md TESTING-THE-EXTENSION.md
├─ store-assets/                    # 5 ekran görüntüsü + promo + demo.mp4
├─ img/                             # GitHub Pages görselleri
├─ index.html  privacy.html         # GitHub Pages sitesi (build adımı yok)
├─ release/chrome.zip               # `npm run zip` çıktısı
└─ PERMISSIONS.md  PRIVACY.md  CHANGELOG.md  README.md
```

**Repo dışındakiler:** `../whileai-recordings/` (demo GIF/MP4'ün ham kareleri
ve onları üreten scriptler — `.gitignore`'da) ve `~/.whileai-chrome`
(canlı test için giriş yapılmış Chrome profili).

## 11. Kodlama kuralları

- Saf mantık (`core/queue.ts`, `core/metrics.ts`) hiçbir `chrome.*` API'sine dokunmaz. Yan etkiler `orchestrator.ts` ve `tabs.ts`'de.
- Her `chrome.*` çağrısı `try/catch`; "No tab with id" gibi hatalar beklenen akıştır, crash değil.
- Adapter'lar `adapters/domHelpers.ts` (`waitFor`, `stableFor`) ve `adapters/insertText.ts` yardımcılarını kullanır; ortak taban `adapters/baseAdapter.ts`. (`base.ts` diye bir dosya YOK.)
- Mesaj tipleri `messages.ts`'de tek yerde; `switch` exhaustive (`never` kontrolü).
- Yorum dili İngilizce, commit'ler conventional (`feat(adapter): …`). UI metinleri **İngilizce ve doğrudan kaynakta** — `ui/i18n.ts` diye bir dosya YOK, TR çevirisi `## 16`'da açık karar.
- Kütüphane eklemeden önce sor: bundle < 300 KB hedef.

---

## 12. Fazlar & Definition of Done

> **Faz 0–5 tamamlandı. Eklenti 2026-09-09 itibarıyla mağazada yayında**
> (`jkemgnopkjenepaohooaghojmoabplmp`, 0.8.2), `unlisted` değil **public**.
> Aşağıdaki liste tarihsel kayıttır; sıradaki iş `## 16`'daki açık kararlar.

| Faz | Kapsam | Durum |
|---|---|---|
| 0 | İskelet + tek adapter | ✅ |
| 1 | Kaynak yakalama + hedefler | ✅ |
| 2 | Kuyruk, lane, retry | ✅ |
| 3 | Login / challenge / hata + bildirimler | ✅ |
| 4 | Dashboard, metrikler, export | ✅ |
| 5 | Beş sağlayıcı, health script, docs, mağaza | ✅ yayında |
| 6+ | Compare View, pencere döşeme, TR i18n | ayrı karar (`## 16`) |

**Şimdi ne yapılıyor:** bakım. Güncel sıradaki adım listesi **yalnız §0'da**
tutulur (iki liste iki hızda eskir). Bakımın genel reçetesi:
- Selector kırıldı → `config.ts` + `config/selectors.json` birlikte (§5.37),
  push → **mağaza incelemesi olmadan** altı saat içinde tüm kurulumlara
  ulaşır (`docs/REMOTE-UPDATES.md`).
- Kod değişikliği gerektiren hata → sürümü yükselt, `npm run zip`, yeni
  inceleme (`docs/PUBLISHING.md` → "Shipping an update").

## 13. Test stratejisi

**Unit (Vitest) — `__tests__/`, `tests/unit/` değil.** 24 dosya, 383 test.
`npm test`. Saf mantık (`queue`, `metrics`, `storage` migrate, adapter
yardımcıları) ve adapter selector'leri happy-dom üzerinde.

Regresyon testi yazarken: **testin gerçekten hatayı yakaladığını kanıtla.**
Eski kodu geri koy, testin KIRMIZI olduğunu gör, sonra düzeltmeyi geri al.
Yeşil bir test tek başına hiçbir şey ispatlamaz.

**E2E (Playwright, headed, kalıcı profil):** `npm run e2e`, `npm run e2e:health`.
Giriş gerektirir, CI'da çalışmaz.

**Canlı doğrulama (asıl hataların çıktığı yer).** Son üç ciddi hata unit
testlerden değil, CDP ile gerçek tarayıcıyı sürerek bulundu:
- `chrome.tabs.sendMessage` **yalnızca alıcı yokken** reddeder. Mesajı alıp
  hiç cevaplamayan bir content script promise'i sonsuza kadar bekletir —
  hata yok, log yok, "hâlâ çalışıyor"dan ayırt edilemez. Bu kusur **üç ayrı
  yolda** çıktı. Her `sendMessage` kendi zaman aşımına sahip olmalı.
- Bir AI'ın **kendi durum metni** kullanıcı promptu sanılabilir (bkz. `## 16`,
  2026-09-09).
- Eklenti reload'u dashboard sekmesini kapatır; IndexedDB durur ama sekme
  gider.

**Manuel liste:** `docs/MANUAL-TEST-STEPS.md`. SW öldürme, sekme kapatma, tab
discard, logout, uzun prompt, ardışık 5 prompt, izin geri alma.

## 14. Günlük komutlar

> Eski hâli `pnpm create wxt@latest` ile başlıyordu — proje çoktan kurulu,
> o bölüm anlamsızdı.

```bash
npm run typecheck && npm test     # "bitti" demeden önce, her seferinde
npm run build                     # dist/
npm run zip                       # release/chrome.zip (+ edge.zip)

npm run browser                   # giriş yapılmış Chrome, debug portu 9334
npm run health:watch              # selector'lar hâlâ tutuyor mu (günlük)
npm run live:check                # canlı sağlayıcı durumu
npm run logs                      # eklentinin debug logu
```

Canlı test **gerçek ücretli hesapları** kullanır; her prompt gerçek kota
harcar. Tarayıcıyı `npm run browser` ile aç, girişleri **elle** yap.

## 15. Gelecek gelir modeli (şimdi kodlanmaz, sadece kapı bırak)

`core/features.ts`: `maxProviders` (free 3), `queueDepth` (free 3), `historyDays`, `compareView`. Hepsi şimdilik sınırsız. Ödeme altyapısı yok. Hangi özelliğin ücretli olacağı Reddit/kullanıcı geri bildiriminden sonra.

---

## 16. Açık kararlar (Claude Code: karar verince buraya yaz, tarih koy)

- [x] **Mağaza adı (2026-09-09):** `WhileAI — Ask Every AI, Track Your Wait`
      (39/75 karakter). Mağazada canlı; `src/manifest.json` ile birebir aynı
      olmak zorunda. İsim **pakette** olduğu için değiştirmek yeni bir zip ve
      yeni bir inceleme demek — incelemesiz düzenlenebilen liste alanlarından
      biri DEĞİL. Arama sıralaması hakkında iddia yok: algoritma açıklanmıyor,
      ölçemediğimiz şeyi tavsiye olarak yazmıyoruz.
- [ ] Compare View (cevap metni okuma) yapılacak mı; yapılırsa gizlilik metni nasıl değişir.
- [x] **Varsayılan kaynak:** hiçbiri. Kaynak yakalama varsayılan kapalı;
      kullanıcı yan panelden bir sekmeyi açıkça kaynak seçer (2026-09-05).
      Gerekçe: sessizce bir sekmeyi dinlemek sürpriz gönderim üretir.
- [x] **Sağlayıcı sırası (2026-09-05):** ChatGPT, Claude, Perplexity (ölçüm +
      broadcast, canlı doğrulandı) → Gemini, DeepSeek (yalnız broadcast).
      Gemini/DeepSeek selector'ları sonradan canlı doğrulandı (Gemini
      09-05/09-06, DeepSeek 09-05/09-07/09-09 — `config.ts` yorumları).
      Grok/Mistral/Copilot ertelendi.
- [ ] TR arayüz ne zaman.
- [ ] Yan yana pencere döşeme için `system.display` izni alınsın mı.
- [ ] **Ücretlendirme açılacak mı.** Altyapı hazır ve test edilmiş
      (`core/entitlement.ts`, `core/licence.ts`, Polar hesabı kurulu,
      `docs/PAYMENTS.md` + `docs/POLAR-SETUP.md`) ama `FREE_BROADCASTS`
      sonsuz — yani kapı kapalı. 2026-09-08 araştırmasının sonucu: aynı işi
      yapan ücretsiz rakiplerin kurulum sayıları 28–2000 arası, yani daha
      ortada fiyatlanacak bir talep yok. Karar **kaldırma oranı verisi
      geldikten sonra**, öncesinde değil.
- [x] **Gemini/DeepSeek canlı doğrulaması (2026-09-12).** Gerçek promptla
      yapıldı. Gemini: gönderim, ilk token, bitiş tespiti, süre — hepsi doğru.
      DeepSeek: gönderim ve cevap doğru; iki selector hatası bulundu ve
      düzeltildi (config v17), ayrıntı §0 ve karar günlüğü. Kapandı.
- [ ] **Mağazada görünen adres/e-posta** (2026-09-12 bulgusu, §0). Kullanıcı
      Developer Dashboard'da bakacak; sonuç buraya.

> Sıradaki adımlar listesi **§0'da** tutulur, burada değil.

**Karar günlüğü:**
- 2026-09-03 — Backend/DB yok, her şey tarayıcıda. WXT + Preact + zod + idb. Content script'ler aptal, mantık `core/`'da.
- 2026-09-05 — **§10 ve §14 bu repo için geçersiz.** `whileai/` zaten çalışan bir
  v0.4.0 eklentisi (tracking yarısı, 74 test yeşil). Broadcast yarısı sıfırdan
  değil, onun üstüne inşa edilir. Bunun sonucu olarak:
  - **WXT yok, esbuild kalıyor.** `scripts/build.mjs` çalışıyor; WXT'ye geçmek
    7 entrypoint + manifest patch + release akışını sıfır kazançla yeniden
    yazmak demek. Broadcast'in ihtiyacı 2 yeni esbuild entry'si.
  - **Preact yok, vanilla TS.** Dashboard (406 satır) zaten vanilla TS ile
    çiziliyor; side panel ondan basit. Sadece küçük bir keyed-list yardımcısı
    yazılır (prompt kutusunun focus'unu kaybetmemek için).
  - **zod yok.** Repo'nun kendi stili (`validateConfig`) elle yazılmış, bağımlılık
    içermeyen doğrulayıcılar. Mesaj protokolü için `parseBroadcastMessage`
    aynı stilde yazılır + `sender.id` kontrolü. (§3.1'in zod şartı bu şekilde
    karşılanır; bundle hedefi §11 korunur.)
  - **idb yok, `waitEvents` store'u yok.** Mevcut `Turn` kaydı §6'daki
    `WaitEvent`'in üst kümesi. Broadcast run'ları mevcut `saveTurn` /
    `recordTurnInSummary` hattına yazılır → §12 Faz 4'ün (dashboard, 7 gün
    grafiği, export, retention) büyük kısmı bedavaya gelir.
  - **`ProviderId` = mevcut platform id'leri** (`chatgpt|claude|perplexity|…`),
    böylece broadcast ve tracking verisi dashboard'da aynı anahtarla birleşir.
  - **Selector'lar tek kaynaktan.** Broadcast kendi selector setini açmaz;
    `EMBEDDED_CONFIG` / `config/selectors.json` genişletilir (opsiyonel yeni
    alanlar: `userMessageSelectors`, `loginUrlPatterns`, `challengeSelectors`,
    `newChatUrl`). İki set selector iki ayrı hızda çürür.
  - **Tracking adapter'ı forklanmaz.** `PlatformAdapter` (saf gözlem) aynen
    kalır; `BroadcastAdapter` onu **composition** ile sarar. Tracking content
    script'i hiçbir zaman "gönder" yeteneği kazanmaz — bu bir güvenlik sınırı.
  - **İki ayrı content script.** `content.js` (tracking, `document_start`) ve
    `broadcast.js` (`document_idle`), ayrı window guard'ları, broadcast
    `features.broadcastEnabled` arkasında. Broadcast hatası tracking'i bozamaz.
  - `tabs` izni ekleniyor — `PERMISSIONS.md`'deki "tabs yok" iddiası dürüstçe
    güncellenmeli (mağaza incelemesi için kritik).
- 2026-09-09 — **Mağazada yayında** (`jkemgnopkjenepaohooaghojmoabplmp`), 0.8.2.
  Bu sürümde çıkan ve kayda değer olan hata: bir AI'ın **kendi durum metni**
  ("Read 12 web pages", "Searching for ...") kullanıcı promptu sanılıp diğer
  dörde yayınlanıyordu. DeepSeek bu bildirimleri kullanıcı mesajlarıyla aynı
  kapsayıcıda render ediyor, `captureFromAnyTab` açıkken her hedef kaynak
  hâline geliyor ve metin tekrar dolaşıyordu — tek prompt altı kuyruk girdisi
  üretti, ikisini kullanıcı hiç yazmamıştı.
  Çözüm iki katmanda: (a) `CAPTURE_SETTLE_MS` — yakalanan prompt bir an sonra
  hâlâ son kullanıcı mesajı olmalı; bu **yapısal** bir test, yasaklı kelime
  listesi değil, o yüzden her sağlayıcıda ve her dilde geçerli. (b) DeepSeek
  selector'ü anlamsal bir attribute'a daraltıldı; her derlemede değişen
  `.fbb737a4` hash'i atıldı. Ders: §5.13'ün "DOM'dan yakala" kuralı yetmiyor —
  **hangi** DOM düğümünün kullanıcıya ait olduğu da kanıtlanmalı.
- 2026-09-09 — Mağaza varlıkları `store-assets/`, üretici
  `scripts/make-store-shots.mjs`. Mağaza **en fazla 5** görsel alıyor. Ham
  kayıt kareleri repoda değil (19MB), repo'nun yanında `../whileai-recordings/`
  altında; `.gitignore` içinde. Tanıtım videosu alanı **YouTube URL'si**
  istiyor, dosya yüklenmiyor.
- 2026-09-11 — CLAUDE.md gövdesi repoya karşı düzeltildi (WXT/Preact/zod/idb/
  pnpm/`tests/unit/`/`sidePanel` iddiaları yanlıştı; var olmayan altı dosyaya
  atıf vardı).
- 2026-09-12 — **Belge düzeni ve devir protokolü.** Kullanıcı her yeni
  sohbette "nerede kalmıştık" beklemesini istemiyor. Kök sebep: durum ve
  sıradaki adım dosyada değil sohbet geçmişindeydi; ayrıca proje klasörü üç
  kez taşındığı için Claude hafızası her seferinde sıfırlandı. Karar:
  (0) her iş birimi commit + push edilir, kullanıcının kalıcı onayıyla
  (istisnalar §0.2 madde 8). (a) asıl CLAUDE.md repo köküne taşındı (versiyonlu, klasörle birlikte
  taşınır); üst klasörde yalnız `@whileai/CLAUDE.md` işaretçisi; elle `cp`
  senkronu kaldırıldı. (b) §0 = devir bölümü, her iş biriminden sonra
  güncellenir (§0.2). (c) Tek "sıradaki adım" listesi, §0'da. (d) Eski
  hafıza notlarındaki kalıcı bilgiler buraya alındı (§5.36, §5.37, §0.3.5).
  Aynı gün: mağaza sayfası non-trader beyanına rağmen posta adresi ve
  e-postayı gösteriyor — "non-trader = yayınlanmaz" varsayımı yanlıştı.
  Araştırma: adres büyük olasılıkla Developer Dashboard → **Account →
  "Physical address"** alanından geliyor; Google'ın belgesi bu alanı yalnız
  **satış yapan** öğeler için zorunlu tutuyor, yani ücretsiz bir eklentide
  boş bırakılabilir. Non-trader beyanı yalnız **trader doğrulama bloğunu**
  kapatıyor, bu alanı değil. ("Temizleyince listeden kalkar" resmî belgede
  yazmıyor; bunu geliştirici raporları söylüyor.)
- 2026-09-12 — **DeepSeek selector'ları: canlı testten çıkan iki hata.**
  (a) Kullanıcı sırası artık **içerdiği** şeyle tanınıyor
  (`.ds-message:has(.ds-collapsible-text)`), "markdown'ı yok" gibi bir
  yoklukla değil. Negatif-anahtar kuralı yalnız taze mesajda doğru; sohbet
  yüklenince anahtar pozitife dönüyor ve eski yedek DeepSeek'in kendi
  "Found 8 web pages" bildirimini kullanıcı promptu sanıyordu (önce KIRMIZI
  test yazılarak kanıtlandı). (b) `textarea#chat-input` ölmüş →
  `textarea[name="search"]`. Config v16 → v17.
  Ders: **sağlık kontrolü "biri tutuyor mu" değil "hangisi tutuyor" diye
  sormalı.** Yedeğin sessizce yükü taşıması kırılmanın kendisi kadar
  tehlikeli, çünkü alarm hiç çalmıyor. `watch-health.mjs` artık `degraded`
  raporluyor ve cevap selector'lerine de bakıyor.
