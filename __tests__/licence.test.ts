import { beforeEach, describe, expect, it } from 'vitest';
import { clearChromeStorage } from './setup';
import {
  activateLicence,
  getStoredLicence,
  getUsedCount,
  recordBroadcastUsed,
  verifyToken,
} from '../src/core/licence';

/**
 * Everything the extension stores can be edited by the user, so the only
 * thing worth checking is the SIGNATURE. These tests exist to make sure an
 * unsigned or tampered token never reads as valid — a forged licence would
 * cost a sale, and worse, would do so silently.
 */
function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeKeyPair(): Promise<{ pub: string; sign: (msg: string) => Promise<string> }> {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return {
    pub: b64url(raw),
    sign: async (msg: string) => {
      const sig = await crypto.subtle.sign(
        'Ed25519',
        kp.privateKey,
        new TextEncoder().encode(msg),
      );
      return b64url(new Uint8Array(sig));
    },
  };
}

function payloadPart(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

beforeEach(() => {
  clearChromeStorage();
});

describe('verifyToken', () => {
  it('accepts a token this key really signed', async () => {
    const { pub, sign } = await makeKeyPair();
    const p = payloadPart({ sub: 'order-1', iat: 1_700_000_000 });
    const token = `${p}.${await sign(p)}`;
    const out = await verifyToken(token, pub);
    expect(out?.sub).toBe('order-1');
  });

  it('rejects a token whose payload was edited after signing', async () => {
    // The obvious attack: take a real licence and extend its expiry.
    const { pub, sign } = await makeKeyPair();
    const real = payloadPart({ sub: 'order-1', iat: 1_700_000_000, exp: 1_700_000_100 });
    const sig = await sign(real);
    const tampered = payloadPart({ sub: 'order-1', iat: 1_700_000_000, exp: 9_999_999_999 });
    expect(await verifyToken(`${tampered}.${sig}`, pub)).toBeNull();
  });

  it('rejects a token signed by a DIFFERENT key', async () => {
    const mine = await makeKeyPair();
    const theirs = await makeKeyPair();
    const p = payloadPart({ sub: 'order-1', iat: 1 });
    expect(await verifyToken(`${p}.${await theirs.sign(p)}`, mine.pub)).toBeNull();
  });

  it('rejects a made-up token', async () => {
    const { pub } = await makeKeyPair();
    expect(await verifyToken('not-a-real-token', pub)).toBeNull();
    expect(await verifyToken('aaaa.bbbb', pub)).toBeNull();
    expect(await verifyToken('', pub)).toBeNull();
  });

  it('rejects everything when no public key is configured', async () => {
    // An unset key must fail CLOSED: shipping without the key must not hand
    // out free premium.
    const { sign } = await makeKeyPair();
    const p = payloadPart({ sub: 'x', iat: 1 });
    expect(await verifyToken(`${p}.${await sign(p)}`, '')).toBeNull();
  });

  it('rejects a validly signed token that is missing required fields', async () => {
    const { pub, sign } = await makeKeyPair();
    const p = payloadPart({ nothing: true });
    expect(await verifyToken(`${p}.${await sign(p)}`, pub)).toBeNull();
  });
});

describe('activateLicence', () => {
  it('refuses to store a token it cannot verify', async () => {
    expect(await activateLicence('rubbish')).toBe(false);
    expect(await getStoredLicence()).toBeNull();
  });
});

describe('usage counting', () => {
  it('starts at zero and counts up', async () => {
    expect(await getUsedCount()).toBe(0);
    await recordBroadcastUsed();
    await recordBroadcastUsed();
    expect(await getUsedCount()).toBe(2);
  });

  it('treats a corrupted counter as zero rather than locking the user out', async () => {
    // Erring in the user's favour: a broken count should not read as "you
    // have used a million broadcasts".
    (globalThis.chrome as unknown as { storage: { local: { set: (o: unknown) => Promise<void> } } })
      .storage.local.set({ whileaiUsage: 'not a number' });
    expect(await getUsedCount()).toBe(0);
  });
});
