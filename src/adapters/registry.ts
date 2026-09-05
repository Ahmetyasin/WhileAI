import type { SelectorConfig } from '../core/types';
import { getPlatformConfig } from '../core/config';
import { GenericAdapter } from './baseAdapter';
import { GenericBroadcastAdapter } from './broadcastAdapter';
import type { BroadcastAdapter } from './broadcastTypes';
import { isProviderId } from '../core/broadcastTypes';
import type { PlatformAdapter } from './types';

const HOST_MAP: Record<string, { id: string; hosts: string[] }> = {
  'chatgpt.com': { id: 'chatgpt', hosts: ['chatgpt.com'] },
  'claude.ai': { id: 'claude', hosts: ['claude.ai'] },
  'www.perplexity.ai': { id: 'perplexity', hosts: ['www.perplexity.ai'] },
  'perplexity.ai': { id: 'perplexity', hosts: ['perplexity.ai'] },
  'gemini.google.com': { id: 'gemini', hosts: ['gemini.google.com'] },
  'chat.deepseek.com': { id: 'deepseek', hosts: ['chat.deepseek.com'] },
  // Dev-only: the local test harness mimics the ChatGPT DOM. This entry is
  // inert in production builds because the manifest never matches localhost.
  'localhost': { id: 'chatgpt', hosts: ['localhost'] },
  '127.0.0.1': { id: 'chatgpt', hosts: ['127.0.0.1'] },
};

export function adapterForHost(hostname: string, config: SelectorConfig): PlatformAdapter | null {
  const entry = HOST_MAP[hostname];
  if (!entry) return null;
  const platformConfig = getPlatformConfig(config, entry.id);
  if (!platformConfig) return null;
  return new GenericAdapter(entry.id, entry.hosts, platformConfig);
}

/**
 * Broadcast adapter for a host, or null when the site is not a supported
 * provider. Wraps the observation adapter rather than replacing it (§4).
 */
export function broadcastAdapterForHost(
  hostname: string,
  config: SelectorConfig,
): BroadcastAdapter | null {
  const entry = HOST_MAP[hostname];
  if (!entry || !isProviderId(entry.id)) return null;
  const platform = adapterForHost(hostname, config);
  if (!platform) return null;
  return new GenericBroadcastAdapter(entry.id, platform);
}
