# Changelog

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
