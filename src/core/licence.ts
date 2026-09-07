/**
 * Licence storage and verification.
 *
 * The extension runs entirely on the user's machine, so anything it stores
 * can be edited by anyone willing to open devtools. A boolean "premium: true"
 * in storage is therefore worth nothing. What IS worth something is a token
 * the server signed: the extension can verify the signature with a public
 * key it ships, and cannot forge one without the private key, which never
 * leaves the server.
 *
 * This is deliberately not airtight. A determined user can patch the
 * extension itself — no client-side check survives that, and pretending
 * otherwise wastes effort better spent on the product. The goal is that
 * paying is easier than not paying, not that cheating is impossible.
 */
import { ext } from './browser';

const LICENCE_KEY = 'whileaiLicence';
const USAGE_KEY = 'whileaiUsage';

/**
 * Ed25519 public key (base64, raw 32 bytes) matching the server's signing
 * key. Replaced at release time; a placeholder here fails every check, which
 * is the safe direction — an unset key must not grant access.
 */
export const LICENCE_PUBLIC_KEY = '';

export interface StoredLicence {
  /** The signed token, exactly as the server issued it. */
  token: string;
  /** Cached verification result, so every prompt does not re-verify. */
  verifiedAt: number;
  valid: boolean;
  expiresAt?: number;
  /** Email or id the licence was issued to, for the UI to show. */
  issuedTo?: string;
}

/**
 * A licence token is `<payload-base64url>.<signature-base64url>`, where the
 * payload is JSON. Self-contained on purpose: verification needs no network,
 * so a user who is offline, or whose licence server is down, keeps working.
 */
export interface LicencePayload {
  /** Stable id for the purchase; lets support match a report to a payment. */
  sub: string;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. Absent for a lifetime licence. */
  exp?: number;
  email?: string;
}

function fromBase64Url(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Return the buffer itself: WebCrypto's types insist on ArrayBuffer rather
  // than a view whose buffer could in principle be shared.
  return bytes.buffer;
}

/**
 * Verify a token's signature and decode it.
 *
 * Returns null for anything it cannot prove: a bad signature, a malformed
 * token, or a missing public key. Callers treat null as "not licensed".
 */
export async function verifyToken(
  token: string,
  publicKeyB64: string = LICENCE_PUBLIC_KEY,
): Promise<LicencePayload | null> {
  if (publicKeyB64 === '' || !token.includes('.')) return null;
  try {
    const [payloadPart, signaturePart] = token.split('.');
    if (payloadPart === undefined || signaturePart === undefined) return null;
    const key = await crypto.subtle.importKey(
      'raw',
      fromBase64Url(publicKeyB64),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'Ed25519',
      key,
      fromBase64Url(signaturePart),
      new TextEncoder().encode(payloadPart),
    );
    if (!ok) return null;
    const json = new TextDecoder().decode(fromBase64Url(payloadPart));
    const payload = JSON.parse(json) as LicencePayload;
    if (typeof payload.sub !== 'string' || typeof payload.iat !== 'number') return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getStoredLicence(): Promise<StoredLicence | null> {
  try {
    const res = await ext.storage.local.get(LICENCE_KEY);
    const v = res[LICENCE_KEY] as StoredLicence | undefined;
    return v && typeof v.token === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Verify and store a token the user pasted in. Returns whether it took. */
export async function activateLicence(token: string): Promise<boolean> {
  const payload = await verifyToken(token.trim());
  if (payload === null) return false;
  const licence: StoredLicence = {
    token: token.trim(),
    verifiedAt: Date.now(),
    valid: true,
    ...(payload.exp !== undefined ? { expiresAt: payload.exp * 1000 } : {}),
    ...(payload.email !== undefined ? { issuedTo: payload.email } : {}),
  };
  await ext.storage.local.set({ [LICENCE_KEY]: licence });
  return true;
}

export async function clearLicence(): Promise<void> {
  try {
    await ext.storage.local.remove(LICENCE_KEY);
  } catch {
    // nothing to do; the caller cannot act on it either
  }
}

/** How many broadcasts have been spent. */
export async function getUsedCount(): Promise<number> {
  try {
    const res = await ext.storage.local.get(USAGE_KEY);
    const n = res[USAGE_KEY] as unknown;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function recordBroadcastUsed(): Promise<void> {
  try {
    const next = (await getUsedCount()) + 1;
    await ext.storage.local.set({ [USAGE_KEY]: next });
  } catch {
    // Failing to count is better than failing to send: the user keeps working
    // and we under-count, which errs in their favour rather than ours.
  }
}
