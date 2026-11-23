export function readCookie(header, name) {
  if (!header) return '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      try { return decodeURIComponent(rest.join('=')); } catch { return rest.join('='); }
    }
  }
  return '';
}

/** SHA-256 both sides and compare the digests so the loop does not leak the token length. */
export async function tokensEqual(presented, expected) {
  if (!presented || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(presented)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export function sessionCookie(token, secure) {
  const flags = ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=31536000'];
  if (secure) flags.push('Secure');
  return `pt_session=${encodeURIComponent(token)}; ${flags.join('; ')}`;
}

export function clearSessionCookie(secure) {
  const flags = ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) flags.push('Secure');
  return `pt_session=; ${flags.join('; ')}`;
}

/** Status payload for the sync pill. The Withings userid is not included. */
export function publicWithingsStatus(tokenRow, lastSync) {
  return { connected: !!tokenRow, last_sync: lastSync ?? null };
}
