/**
 * The tool kit (the `kit` action): small conversions a programmer does by hand, on the text in the panel, all in the page.
 *
 * - `json`: the text as indented JSON, or where it fails to parse;
 * - `b64` / `unb64`: UTF-8 text to Base64 and back (standard or URL-safe, padding optional);
 * - `jwt`: a JSON Web Token's header and payload, with `exp`, `iat` and `nbf` as dates (the signature is not checked);
 * - `time`: seconds or milliseconds since the epoch to a date, a date to both, nothing to now;
 * - `url` / `unurl`: percent-encoding;
 * - `sha256`: the text's SHA-256 in hex;
 * - `uuid`: a new random UUID (the text is not read).
 *
 * `runTool` resolves to `{ ok, out }`; a failure's `out` names what was wrong, in English as the engines word it.
 */
export const KIT_TOOLS = ['json', 'b64', 'unb64', 'jwt', 'time', 'url', 'unurl', 'sha256', 'uuid'];

const utf8 = new TextEncoder(), fromUtf8 = new TextDecoder('utf-8', { fatal: true });

function toBase64(text) {
  let bin = '';
  for (const b of utf8.encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(text) {
  const s = text.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('not Base64');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return fromUtf8.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const iso = (ms) => new Date(ms).toISOString();
const local = (ms) => new Date(ms).toString();

function time(text) {
  const s = text.trim();
  if (!s) { const now = Date.now(); return `${Math.floor(now / 1000)}\n${now}\n${iso(now)}\n${local(now)}`; }
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    // ten digits or fewer read as seconds, more as milliseconds
    const n = Number(s), ms = s.replace(/^-|\..*$/g, '').length > 11 ? n : n * 1000;
    if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) throw new Error('out of range');
    return `${iso(ms)}\n${local(ms)}`;
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error('not a date or a number');
  return `${Math.floor(ms / 1000)}\n${ms}\n${iso(ms)}`;
}

function jwt(text) {
  const parts = text.trim().split('.');
  if (parts.length !== 3) throw new Error('a JWT has three parts separated by dots');
  const header = JSON.parse(fromBase64(parts[0])), payload = JSON.parse(fromBase64(parts[1]));
  const dates = ['exp', 'iat', 'nbf'].filter((k) => typeof payload[k] === 'number').map((k) => `${k}: ${iso(payload[k] * 1000)}`);
  return [JSON.stringify(header, null, 2), JSON.stringify(payload, null, 2), ...(dates.length ? [dates.join('\n')] : [])].join('\n\n');
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', utf8.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const TOOLS = {
  json: (s) => JSON.stringify(JSON.parse(s), null, 2),
  b64: toBase64,
  unb64: fromBase64,
  jwt,
  time,
  url: (s) => encodeURIComponent(s),
  unurl: (s) => decodeURIComponent(s.replace(/\+/g, ' ')),
  sha256,
  uuid: () => crypto.randomUUID(),
};

export async function runTool(id, text) {
  try {
    return { ok: true, out: String(await TOOLS[id](String(text ?? ''))) };
  } catch (err) {
    return { ok: false, out: err?.message ?? String(err) };
  }
}
