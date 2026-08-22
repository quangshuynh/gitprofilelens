const crypto = require("node:crypto");

const SESSION_COOKIE = "gpl_session";
const STATE_COOKIE = "gpl_oauth_state";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const STATE_DURATION_SECONDS = 10 * 60;

function requireSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Session encryption is not configured.");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function seal(value) {
  const key = requireSessionSecret();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function unseal(value) {
  try {
    const [ivValue, tagValue, encryptedValue, extra] = String(value || "").split(".");
    if (!ivValue || !tagValue || !encryptedValue || extra) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      requireSessionSecret(),
      Buffer.from(ivValue, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}

function parseCookies(request) {
  const cookies = {};
  const header = request.headers?.cookie || "";
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

function cookieOptions(maxAge) {
  const secure = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : null,
    `Max-Age=${maxAge}`,
  ].filter(Boolean).join("; ");
}

function createCookie(name, value, maxAge) {
  return `${name}=${value}; ${cookieOptions(maxAge)}`;
}

function clearCookie(name) {
  return `${name}=; ${cookieOptions(0)}`;
}

function createOAuthState() {
  return crypto.randomBytes(32).toString("base64url");
}

function stateMatches(expected, received) {
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(String(expected));
  const receivedBuffer = Buffer.from(String(received));
  return expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function setPrivateResponseHeaders(response) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Vary", "Cookie");
}

module.exports = {
  SESSION_COOKIE,
  STATE_COOKIE,
  SESSION_DURATION_SECONDS,
  STATE_DURATION_SECONDS,
  seal,
  unseal,
  parseCookies,
  createCookie,
  clearCookie,
  createOAuthState,
  stateMatches,
  setPrivateResponseHeaders,
};
