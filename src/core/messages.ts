/**
 * Broadcast message protocol (CLAUDE.md §3.1).
 *
 * Validation is hand-written in the house style (see validateConfig) rather
 * than zod: these messages cross a privilege boundary — a hostile or
 * compromised page can call chrome.runtime.sendMessage — so every field is
 * checked and the sender is verified before anything is acted on.
 *
 * One-shot sendMessage only. Long-lived Ports are forbidden: they die with the
 * service worker (§3.1).
 */
import type { ErrorCode, ProviderId } from './broadcastTypes';
import { ERROR_CODES, isProviderId } from './broadcastTypes';

export const PROTOCOL_VERSION = 1;

interface Envelope {
  v: typeof PROTOCOL_VERSION;
  providerId: ProviderId;
  promptId?: string;
  tabId?: number;
  ts: number;
}

// Content script -> service worker
export type Observation = Envelope &
  (
    | { type: 'READY' }
    | { type: 'NOT_LOGGED_IN' }
    | { type: 'CHALLENGE_DETECTED' }
    | { type: 'PROMPT_CAPTURED'; text: string; hash: string }
    | { type: 'INSERTED' }
    | { type: 'SUBMITTED' }
    | { type: 'GENERATING' }
    | { type: 'DONE' }
    | { type: 'ERROR'; code: ErrorCode; detail?: string }
    | { type: 'STATE'; composerReady: boolean; generating: boolean; lastUserHash: string | null }
  );

// Service worker -> content script
export type Command =
  | (Envelope & { type: 'PING' })
  | (Envelope & { type: 'GET_STATE'; hash?: string })
  | (Envelope & { type: 'NEW_CHAT' })
  | (Envelope & { type: 'INSERT_AND_SUBMIT'; promptId: string; text: string })
  | (Envelope & { type: 'CANCEL' })
  // Re-arm the completion watcher after a navigation replaced the content
  // script mid-run (§5.4). Without it the answer arrives unobserved.
  | (Envelope & { type: 'WATCH'; promptId: string })
  | (Envelope & { type: 'SET_SOURCE_MODE'; isSource: boolean });

export type BroadcastMessage = Observation | Command;

const OBSERVATION_TYPES = [
  'READY', 'NOT_LOGGED_IN', 'CHALLENGE_DETECTED', 'PROMPT_CAPTURED', 'INSERTED',
  'SUBMITTED', 'GENERATING', 'DONE', 'ERROR', 'STATE',
] as const;

const COMMAND_TYPES = [
  'PING', 'GET_STATE', 'NEW_CHAT', 'INSERT_AND_SUBMIT', 'CANCEL', 'SET_SOURCE_MODE', 'WATCH',
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function envelopeOk(m: Record<string, unknown>): boolean {
  if (m.v !== PROTOCOL_VERSION) return false;
  if (!isProviderId(m.providerId)) return false;
  if (typeof m.ts !== 'number' || !Number.isFinite(m.ts)) return false;
  if (m.promptId !== undefined && typeof m.promptId !== 'string') return false;
  if (m.tabId !== undefined && typeof m.tabId !== 'number') return false;
  return true;
}

/** Returns the message only if every field of its variant is well formed. */
export function parseObservation(raw: unknown): Observation | null {
  if (!isRecord(raw) || !envelopeOk(raw)) return null;
  const type = raw.type;
  if (typeof type !== 'string' || !(OBSERVATION_TYPES as readonly string[]).includes(type)) {
    return null;
  }
  switch (type) {
    case 'PROMPT_CAPTURED':
      if (typeof raw.text !== 'string' || typeof raw.hash !== 'string') return null;
      break;
    case 'ERROR':
      if (typeof raw.code !== 'string' || !(ERROR_CODES as readonly string[]).includes(raw.code)) {
        return null;
      }
      if (raw.detail !== undefined && typeof raw.detail !== 'string') return null;
      break;
    case 'STATE':
      if (typeof raw.composerReady !== 'boolean' || typeof raw.generating !== 'boolean') return null;
      if (raw.lastUserHash !== null && typeof raw.lastUserHash !== 'string') return null;
      break;
  }
  return raw as unknown as Observation;
}

export function parseCommand(raw: unknown): Command | null {
  if (!isRecord(raw) || !envelopeOk(raw)) return null;
  const type = raw.type;
  if (typeof type !== 'string' || !(COMMAND_TYPES as readonly string[]).includes(type)) return null;
  switch (type) {
    case 'INSERT_AND_SUBMIT':
      if (typeof raw.promptId !== 'string' || typeof raw.text !== 'string') return null;
      break;
    case 'SET_SOURCE_MODE':
      if (typeof raw.isSource !== 'boolean') return null;
      break;
    case 'WATCH':
      if (typeof raw.promptId !== 'string') return null;
      break;
    case 'GET_STATE':
      if (raw.hash !== undefined && typeof raw.hash !== 'string') return null;
      break;
  }
  return raw as unknown as Command;
}

/**
 * Only messages from this extension's own pages/content scripts are trusted.
 * A web page can reach the service worker via externally_connectable-style
 * paths, so the sender id is checked before any command is honoured.
 */
export function isTrustedSender(sender: { id?: string } | undefined, selfId: string): boolean {
  return sender?.id === selfId;
}

export function observation<T extends Observation['type']>(
  type: T,
  providerId: ProviderId,
  rest: Omit<Extract<Observation, { type: T }>, 'v' | 'ts' | 'type' | 'providerId'>,
): Observation {
  return { v: PROTOCOL_VERSION, ts: Date.now(), type, providerId, ...rest } as Observation;
}

export function command<T extends Command['type']>(
  type: T,
  providerId: ProviderId,
  rest: Omit<Extract<Command, { type: T }>, 'v' | 'ts' | 'type' | 'providerId'>,
): Command {
  return { v: PROTOCOL_VERSION, ts: Date.now(), type, providerId, ...rest } as Command;
}
