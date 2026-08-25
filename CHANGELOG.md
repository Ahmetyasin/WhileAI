# Changelog

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
