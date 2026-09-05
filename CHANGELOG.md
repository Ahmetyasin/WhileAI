# Changelog

## 0.5.0 — 2026-09-05

**Broadcast: tek yere yaz, hepsine sor.** Yan panele (side panel) yazdığın
prompt, giriş yapmış olduğun diğer AI sitelerine kendi sekmelerinde gider.

- Saf kuyruk reducer'ı (`core/queue.ts`): sağlayıcı başına tek uçuş, FIFO,
  lockstep, 3 sn insan temposu, prompt tekrarı (hash + 10 sn) engelleme,
  hata için **bir** otomatik retry, giriş/doğrulama için **hiç** retry yok,
  sağlayıcı başına timeout. `chrome.*` kullanmaz, saat dışarıdan verilir —
  tarayıcısız test edilir.
- Service worker ölümüne dayanıklı: durum storage'da, zamanlama `chrome.alarms`
  ile. Uyanışta uçuştaki her gönderim sayfadaki son kullanıcı mesajının
  hash'iyle karşılaştırılır, böylece **aynı prompt iki kez gönderilmez**.
- Metin girme (§5.8): execCommand → paste → native setter merdiveni. Her
  adımda hem metnin girdiği **hem de sitenin gönder butonunu etkinleştirdiği**
  doğrulanır — yalnızca DOM'a bakan bir sürüm, modeli boş kalan bir editörde
  "başarılı" diyordu.
- Giriş kapalı / Cloudflare / hata / timeout durumları panelde ve bildirimde
  görünür; **aşma denemesi yok**. Giriş yapılınca run kaldığı yerden devam eder.
- Gönderilemeyen prompt için panelde **Copy** — sessiz kalmaz.
- Kaynak sekme: bir sekmeyi kaynak seç, orada sorduğun her şey diğerlerine gider.
- Dashboard: broadcast beklemeleri de kaydedilir; paralel beklemeler için
  toplam **ve** gerçek duvar saati süresi ayrı gösterilir. Arka planda çalışan
  broadcast sekmeleri "sekmeden ayrıldın" istatistiğine karışmaz.
- Gemini + DeepSeek broadcast hedefi olarak eklendi (opsiyonel izin, selector'ler
  henüz canlı doğrulanmadı — sağlık kontrolü sessiz kalmaz).
- Yeni izinler: `tabs`, `scripting`, `sidePanel`, `webNavigation`. Gerekçeleri
  `PERMISSIONS.md`'de; "tabs kullanmıyoruz" iddiası dürüstçe düzeltildi.
- Gizlilik: prompt metni yalnız kuyruk yaşarken saklanır, bittikten sonra
  silinir (`keepHistory` kapalıyken). Cevap metni hâlâ hiç okunmaz.
- 74 → 146 birim testi; Playwright e2e (mock sağlayıcılarla, hesapsız).

## 0.4.0 — 2026-08-26

Field-report fixes (live counter never stopped, turns lost across tabs):

- **Storage writes are serialized.** Every open-turn update was a read-modify-
  write with no lock; two tabs (or a tab and the service worker) writing at
  once silently dropped each other's changes. That lost turns when two chats
  ran at once and resurrected records the completion had just removed, which
  is why the popup counter kept running. Closed turn ids are also tombstoned
  so an in-flight heartbeat cannot revive them.
- **A stuck "generating" marker can no longer hold a turn open forever.** An
  interrupted research run leaves its streaming element in the DOM; the turn
  is now retired after 60s without new stream activity, and its duration is
  recorded at the last real activity, not the stuck marker.
- **Abort detection widened**: Escape key and a coordinate hit-test on the
  stop button, in addition to a direct click.
- **Live counter only counts live turns**: heartbeats every 10s (was 30s), the
  popup ignores records with no recent heartbeat, and the sweep retires them
  after 90s (was 5 min). The popup now lists every waiting platform, not one.
- **No more invented modes.** "research"/"thinking" were guessed from wait
  length, which mislabeled slow ordinary answers and left real research runs
  blank. A mode is now recorded only when the platform itself shows an
  indicator; the dashboard reports measured durations instead.
- Dashboard: platform table shows responses / total / typical / longest / left
  the tab; new "longest waits" list; attention section separates leaving the
  tab from the browser being in the background.
- **DeepSeek removed** — no measurement in field testing; an unstable adapter
  does not ship. ChatGPT endpoint pattern widened (backend-api / backend-alt).

## 0.3.0 — 2026-08-26

- Renamed to WhileAI
- New platform: **Perplexity** (www.perplexity.ai) — selectors and the
  `/rest/sse/perplexity_ask` endpoint verified against the live site
- New platform: **DeepSeek** (chat.deepseek.com) — network-signal based
  (login-walled, pending field verification before store release)
- Supported-platform list added to the extension description and dashboard
- Test harness now logs every request to test-harness/harness.log

## 0.2.0 — 2026-08-26

Field-test fixes after first real-world use:

- Deep research (multi-request generations) now measures as ONE turn: end
  signals are ignored while the page still shows active generation, and
  repeat network submits join the open turn instead of marking it ambiguous
- Open turns survive page reloads: pagehide persists a snapshot, the reloaded
  content script resumes the turn on the original wall clock
- Turn end is timestamped at the end signal, not the confirmation timeout
  (removes a fixed +1.5s bias)
- Fast follow-up messages finalize the previous turn instead of marking it ambiguous
- Endpoint patterns anchored (no false triggers on /conversation/… subpaths)
- Adapter self-test accepts a composer as proof of life; the broken-measurement
  banner only fires when no turns were recorded despite recent activity
- Dashboard rewritten for clarity: plain-language cards, attention-switch
  section replaces "true cost", no editorializing
- Debug logging ring buffer (toggle + download in dashboard) for field analysis
- Remote selector config now points at the GitHub repo (config/selectors.json)

## 0.1.0 — 2026-08-25

Initial implementation per DWELL_SPEC.md:

- TurnTracker state machine with three-signal fusion (network / button / DOM)
- MAIN-world fetch interceptor (SSE observation via `tee()`, byte counting only)
- VisibilityTracker: visible / focus / escape measurement during waits
- ChatGPT and Claude adapters with embedded + remote selector config
- IndexedDB turn store with schema versioning, JSON/CSV export, JSON import
- Popup (today summary + live counter) and dashboard (7 sections, share card)
- Orphan sweep, retention pruning, adapter breakage detection
- Local test harness (mock ChatGPT with SSE) and demo data generator
- 49 unit tests; Chrome + Edge zip builds
