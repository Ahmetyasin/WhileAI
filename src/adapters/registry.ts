import type { SelectorConfig } from '../core/types';
import { getPlatformConfig } from '../core/config';
import { GenericAdapter } from './baseAdapter';
import type { PlatformAdapter } from './types';

const HOST_MAP: Record<string, { id: string; hosts: string[] }> = {
  'chatgpt.com': { id: 'chatgpt', hosts: ['chatgpt.com'] },
  'claude.ai': { id: 'claude', hosts: ['claude.ai'] },
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
