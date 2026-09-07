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
 * Ed25519 public key (base64url, raw 32 bytes) matching the signing key.
 *
 * Empty until release, and an empty key fails EVERY check — the safe
 * direction, since shipping without it must not hand out free premium.
 *
 * Only needed for self-signed licences. With a merchant of record that issues
 * its own keys (Polar, Lemon Squeezy), leave this empty and use
 * VENDOR_VALIDATE_URL below instead; the two paths are independent.
 */
export const LICENCE_PUBLIC_KEY = '';

/**
 * Merchant-of-record key validation endpoint.
 *
 * Polar's customer-portal validate endpoint needs no auth and is safe to call
 * from a client, which is why it can replace a signing server entirely. Empty
 * until the product exists.
 *
 * A network check is used ONCE, at activation. It is never on the path of a
 * prompt: the result is cached and the extension keeps working offline, which
 * is both faster and consistent with the promise that nothing phones home
 * during normal use.
 */
export const VENDOR_VALIDATE_URL = '';

/**
 * How long a vendor-validated licence is trusted before re-checking.
 *
 * Long on purpose. A shorter window would mean more checks, and every check
 * is a chance to wrongly lock out someone who paid because their network was
 * down — see the grace handling in entitlement.ts.
 */
export const VENDOR_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

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

/**
 * Validate a key with the merchant of record.
 *
 * Separate from signature verification because the two models are different:
 * a signed token proves itself offline, while a vendor key is a random string
 * that only the vendor can vouch for. Whichever is configured is used.
 */
async function validateWithVendor(
  key: string,
  url: string = VENDOR_VALIDATE_URL,
): Promise<{ ok: boolean; expiresAt?: number; email?: string } | null> {
  if (url === '') return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as {
      status?: string;
      expires_at?: string | null;
      customer?: { email?: string };
    };
    const ok = body.status === 'granted';
    const expiresAt =
      typeof body.expires_at === 'string' ? Date.parse(body.expires_at) : undefined;
    return {
      ok,
      ...(expiresAt !== undefined && Number.isFinite(expiresAt) ? { expiresAt } : {}),
      ...(body.customer?.email !== undefined ? { email: body.customer.email } : {}),
    };
  } catch {
    // A network failure is not a verdict. Returning null lets the caller fall
    // through to the offline path rather than telling a paying user their key
    // is bad because their wifi dropped.
    return null;
  }
}

/** Verify and store a key the user pasted in. Returns whether it took. */
export async function activateLicence(token: string): Promise<boolean> {
  const trimmed = token.trim();
  if (trimmed === '') return false;

  // Vendor path first when configured: those keys carry no signature.
  const vendor = await validateWithVendor(trimmed);
  if (vendor !== null) {
    if (!vendor.ok) return false;
    await ext.storage.local.set({
      [LICENCE_KEY]: {
        token: trimmed,
        verifiedAt: Date.now(),
        valid: true,
        ...(vendor.expiresAt !== undefined ? { expiresAt: vendor.expiresAt } : {}),
        ...(vendor.email !== undefined ? { issuedTo: vendor.email } : {}),
      } satisfies StoredLicence,
    });
    return true;
  }

  const payload = await verifyToken(trimmed);
  if (payload === null) return false;
  const licence: StoredLicence = {
    token: trimmed,
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
