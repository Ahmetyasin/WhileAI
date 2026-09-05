# WhileAI Privacy Policy

_Last updated: 2026-09-05_

> WhileAI never reads the AI's answers, and everything stays in your browser.
> There is no server, no analytics, no telemetry.
>
> One thing changed in 0.5.0: if you use the **broadcast** feature, WhileAI
> necessarily handles the prompt you asked it to send. That is explained in
> full below.

## The measuring half

For each AI chat turn, WhileAI stores locally:

- Timestamps: when you submitted, when the first token arrived, when the response finished
- Whether the tab was visible/focused during the wait, and how many times you switched away
- The platform (e.g. "chatgpt", "claude"), the model name shown in the UI, and the response size in bytes
- A status flag (ok / aborted / invalid / orphaned / ambiguous)

It never records your prompts, the AI's responses, conversation IDs, URLs or
page titles. Response streams are observed only to count bytes; the bytes are
never decoded.

## The broadcast half

Broadcasting means "take this prompt and send it to the AI sites I'm signed in
to". WhileAI cannot do that without holding the prompt, so:

- **Your prompt text is stored** in `chrome.storage.local` while the prompt is
  queued and being delivered. It stays on your machine.
- **It is deleted** once every provider has finished with it, unless you turn
  on "keep history" (off by default).
- **A hash of the prompt** is used to recognise a prompt that has already been
  delivered, so a browser restart mid-send cannot deliver it twice.
- **The AI's answers are still never read or stored.** WhileAI watches only
  whether the page is still generating, so it knows when the wait is over.

Prompts are sent to the AI providers **by your own browser, from your own
signed-in session**, exactly as if you had pasted them yourself. WhileAI has no
server and never transmits your prompt anywhere else.

## What WhileAI never does

- Never reads or stores the AI's responses
- Never sees, stores, or transmits your passwords or login details — you sign
  in yourself, in your own browser
- Never solves or bypasses CAPTCHAs or verification checks; when a provider
  shows one, WhileAI stops and tells you
- Never sends anything to a server of ours, because there isn't one

## Where data lives

Your browser's local extension storage (IndexedDB, `chrome.storage.local`, and
`chrome.storage.session` for tab ids that are discarded when you close the
browser).

The only network request WhileAI makes is a periodic fetch of a static JSON
file containing updated CSS selectors, so it keeps working when chat UIs
change. That request sends no user data.

## Your control

- Export all data as JSON or CSV at any time (Dashboard → Data)
- Delete all data with one click (Dashboard → Delete all data)
- Clear the prompt queue at any time from the side panel
- Raw records are automatically pruned after your retention period (default 180 days)
- Every provider is off until you switch it on, and switching it on is what
  grants WhileAI access to that site

## Contact

Questions: open an issue on the project repository.
