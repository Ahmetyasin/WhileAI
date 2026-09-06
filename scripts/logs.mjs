/**
 * Read back live-test logs.
 *
 *   npm run logs              # summarise the most recent run
 *   npm run logs -- --all     # list every run on disk
 *   npm run logs -- <file>    # summarise one run
 *   npm run logs -- --raw     # dump the raw JSONL of the latest run
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRun } from './loglib.mjs';

const DIR = new URL('../logs/', import.meta.url).pathname;
const args = process.argv.slice(2);

if (!existsSync(DIR)) {
  console.log('\n  No logs yet — run `npm run live:check` first.\n');
  process.exit(0);
}

const runs = readdirSync(DIR)
  .filter((f) => f.endsWith('.jsonl') && f !== 'latest.jsonl')
  .sort();

if (!runs.length) {
  console.log('\n  No runs recorded yet.\n');
  process.exit(0);
}

if (args.includes('--all')) {
  console.log('');
  for (const f of runs) {
    const ev = readRun(join(DIR, f));
    const done = ev.find((e) => e.event === 'run_finished');
    const fails = ev.filter((e) => e.level === 'fail').length;
    const delivered = ev.filter((e) => e.event === 'delivered').length;
    console.log(`  ${f.padEnd(46)} ${delivered} delivered, ${fails} failed` +
      (done ? ` (${(done.durationMs / 1000).toFixed(1)}s)` : ' — incomplete'));
  }
  console.log('');
  process.exit(0);
}

const file = args.find((a) => a.endsWith('.jsonl')) ?? join(DIR, runs[runs.length - 1]);

if (args.includes('--raw')) {
  console.log(readFileSync(file, 'utf8'));
  process.exit(0);
}

const ev = readRun(file);
const start = ev.find((e) => e.event === 'run_started');
const end = ev.find((e) => e.event === 'run_finished');

console.log(`\n  ${file.split('/').pop()}`);
console.log(`  started ${start?.ts ?? '?'}${end ? ` · ${(end.durationMs / 1000).toFixed(1)}s` : ' · incomplete'}\n`);

for (const e of ev) {
  if (e.event === 'inspected') {
    console.log(`  [${e.provider}] ${e.title}`);
    console.log(`      webdriver=${e.webdriver} wall=${e.wall} signedOut=${e.signedOut}`);
    console.log(`      composer: ${e.composer ?? 'NO MATCH'}`);
    console.log(`      send:     ${e.send ?? 'NO MATCH'}`);
    if (e.editableCount > 1) {
      console.log(`      ${e.editableCount} editable regions:`);
      for (const x of e.editables ?? []) {
        console.log(`        <${x.tag}${x.id ? ' id=' + x.id : ''}${x.cls ? ' class="' + x.cls + '"' : ''}>`);
      }
    }
  } else if (e.event === 'send_result') {
    console.log(`      ladder: ${(e.tried ?? []).join(', ')}`);
  } else if (e.msg && e.level !== 'info') {
    console.log(`      ${e.level.toUpperCase()}: ${e.msg}`);
  }
}

if (end?.results) {
  console.log('\n  result:');
  for (const r of end.results) console.log(`    ${r.id.padEnd(11)} ${r.verdict}`);
}
console.log('');
