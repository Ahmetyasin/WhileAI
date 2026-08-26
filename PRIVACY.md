# WhileAI Privacy Policy

_Last updated: 2026-08-25_

> WhileAI does not read your messages. It only records when a response started
> and ended, and whether the tab was visible at the time. All data stays in
> your browser. There is no server.

## What WhileAI records

For each AI chat turn, WhileAI stores locally:

- Timestamps: when you submitted, when the first token arrived, when the response finished
- Whether the tab was visible/focused during the wait, and how many times you switched away
- The platform (e.g. "chatgpt", "claude"), the model name shown in the UI, and the response size in bytes
- A status flag (ok / aborted / invalid / orphaned / ambiguous)

## What WhileAI never records

- Your prompts or the AI's responses — no message content of any kind
- Conversation IDs, URLs, or page titles
- Your identity, account information, or anything that could identify you

## Where data lives

Everything is stored in your browser's local extension storage (IndexedDB and
`chrome.storage.local`). Nothing is transmitted anywhere. WhileAI has no backend,
no analytics, no telemetry, and no error-reporting service.

The only network request WhileAI makes is a periodic fetch of a static JSON file
containing updated CSS selectors (so measurements keep working when chat UIs
change). This request sends no user data.

## Your control

- Export all data as JSON or CSV at any time (Dashboard → Data)
- Delete all data with one click (Dashboard → Delete all data)
- Raw records are automatically pruned after your configured retention period (default 180 days)

## Contact

Questions: open an issue on the project repository.
