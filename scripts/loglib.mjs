/**
 * Structured session log for live provider testing.
 *
 * Every live test costs the user real account quota (HANDOFF §8), so each run
 * is recorded to disk: what was tried, what the page reported, what failed and
 * why. Written as JSONL so a run is appendable and greppable, with a readable
 * console mirror.
 *
 * Prompt text is recorded only as a length + hash by default (CLAUDE.md §26
 * keeps prompt text out of logs); pass --log-prompts to include it when you
 * are debugging insertion itself.
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const LOG_DIR = new URL('../logs/', import.meta.url).pathname;
const KEEP_PROMPTS = process.argv.includes('--log-prompts');

function stamp() {
  return new Date().toISOString();
}

export function hashPrompt(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/** Redact prompt text unless explicitly opted in. */
export function promptField(text) {
  return KEEP_PROMPTS
    ? { prompt: text, promptHash: hashPrompt(text) }
    : { promptChars: text.length, promptHash: hashPrompt(text) };
}

const LEVEL_TAG = { info: '   ', ok: ' ok', warn: ' ! ', fail: 'ERR', step: ' > ' };

export class SessionLog {
  /** @param {string} kind short name for this run, e.g. 'probe' or 'broadcast' */
  constructor(kind) {
    mkdirSync(LOG_DIR, { recursive: true });
    this.kind = kind;
    this.startedAt = Date.now();
    this.runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}`;
    this.file = join(LOG_DIR, `${this.runId}.jsonl`);
    this.latest = join(LOG_DIR, 'latest.jsonl');
    this.events = [];
    this.write('run_started', { kind, node: process.version, argv: process.argv.slice(2) });
  }

  write(event, data = {}, level = 'info') {
    const rec = { ts: stamp(), runId: this.runId, event, level, ...data };
    this.events.push(rec);
    const line = JSON.stringify(rec) + '\n';
    try {
      appendFileSync(this.file, line);
      appendFileSync(this.latest, line);
    } catch (e) {
      // A logging failure must never take down a live run the user paid for.
      process.stderr.write(`[log] could not write: ${e.message}\n`);
    }
    return rec;
  }

  /** Log + print. `msg` is for humans, `data` for the file. */
  say(level, msg, event, data = {}) {
    this.write(event, { msg, ...data }, level);
    console.log(`  ${LEVEL_TAG[level] ?? '   '}  ${msg}`);
  }

  info(msg, event = 'info', data) { this.say('info', msg, event, data); }
  ok(msg, event = 'ok', data) { this.say('ok', msg, event, data); }
  warn(msg, event = 'warn', data) { this.say('warn', msg, event, data); }
  fail(msg, event = 'fail', data) { this.say('fail', msg, event, data); }
  step(msg, event = 'step', data) { this.say('step', msg, event, data); }

  finish(summary = {}) {
    this.write('run_finished', { durationMs: Date.now() - this.startedAt, ...summary });
    console.log(`\n  log: logs/${this.runId}.jsonl\n`);
    return this.file;
  }
}

/** Re-read a run for reporting. */
export function readRun(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
