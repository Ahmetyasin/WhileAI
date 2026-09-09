// Generates a realistic demo dataset as a WhileAI JSON export
// (spec §12.3: needed for screenshots and development).
// Usage: node scripts/seed-demo-data.mjs → whileai-demo.json
// Then: dashboard → Import JSON.
import { writeFileSync } from 'node:fs';

const DAYS = 30;

/** Plausible model names per platform, so the "by platform" table reads real. */
const MODELS = {
  chatgpt: ['GPT-5', 'GPT-5 Thinking'],
  claude: ['Opus 5', 'Sonnet 5'],
  perplexity: ['Sonar', 'Sonar Reasoning'],
  gemini: ['Gemini 3 Pro', 'Gemini 3 Flash'],
  deepseek: ['DeepSeek-V4', 'DeepSeek-R2'],
};
const now = Date.now();
const turns = [];

function rand(min, max) {
  return min + Math.random() * (max - min);
}
function pick(arr, weights) {
  const r = Math.random() * weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < arr.length; i++) {
    acc += weights[i];
    if (r <= acc) return arr[i];
  }
  return arr[0];
}

for (let d = 0; d < DAYS; d++) {
  const dayStart = now - d * 86_400_000;
  const turnCount = Math.round(rand(4, 28) * (d % 7 >= 5 ? 0.4 : 1)); // quieter weekends
  for (let i = 0; i < turnCount; i++) {
    // All five, because a screenshot of a five-AI product that shows two
    // undersells the thing it is meant to demonstrate. Weights are a plausible
    // mix rather than a flat split — nobody uses all five equally.
    const platform = pick(
      ['chatgpt', 'claude', 'perplexity', 'gemini', 'deepseek'],
      [0.32, 0.28, 0.16, 0.14, 0.10],
    );
    const mode = pick(['standard', 'thinking', 'research'], [0.7, 0.25, 0.05]);
    const totalWaitMs = Math.round(
      mode === 'standard' ? rand(2000, 15_000)
      : mode === 'thinking' ? rand(15_000, 90_000)
      : rand(150_000, 900_000),
    );
    // longer waits → more escaping (the product thesis)
    const escapeBias = Math.min(0.9, totalWaitMs / 200_000 + 0.08);
    const hiddenMs = Math.round(totalWaitMs * rand(0, escapeBias));
    const escapeCount = hiddenMs > 2000 ? Math.max(1, Math.round(rand(0, 3))) : 0;
    const ttftMs = Math.round(rand(300, Math.min(5000, totalWaitMs * 0.4)));
    const status = pick(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'aborted', 'invalid'], [20, 20, 20, 20, 15, 15, 3, 2]);
    const hour = Math.round(rand(8, 23));

    turns.push({
      id: crypto.randomUUID(),
      schemaVersion: 1,
      platform,
      model: MODELS[platform] ? pick(MODELS[platform], MODELS[platform].map(() => 1)) : null,
      mode,
      startedAt: new Date(dayStart).setHours(hour, Math.round(rand(0, 59)), 0, 0),
      totalWaitMs,
      ttftMs,
      streamMs: totalWaitMs - ttftMs,
      visibleMs: totalWaitMs - hiddenMs,
      hiddenMs,
      focusMs: Math.round((totalWaitMs - hiddenMs) * rand(0.7, 1)),
      escapeCount,
      bytes: Math.round(rand(500, 30_000)),
      status,
      confidence: pick(['high', 'low'], [9, 1]),
      signals: ['network', 'button', 'dom'],
      adapterVersion: '1.0.0',
    });
  }
}

const envelope = {
  product: 'whileai',
  schemaVersion: 1,
  exportedAt: now,
  turns,
};
writeFileSync('whileai-demo.json', JSON.stringify(envelope, null, 1));
console.log(`Wrote whileai-demo.json with ${turns.length} turns over ${DAYS} days.`);
