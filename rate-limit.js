/**
 * Simple in-memory sliding-window rate limiter.
 * Used by WebSocket and HTTP handlers to throttle per-IP or per-user.
 */

function createRateLimiter({
  windowMs = 60_000,
  maxRequests = 60,
} = {}) {
  const buckets = new Map(); // key → { count, resetAt }

  function _getBucket(key) {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    return bucket;
  }

  /** Returns true if the request is allowed, false if rate-limited. */
  function allow(key) {
    const bucket = _getBucket(key);
    bucket.count++;
    return bucket.count <= maxRequests;
  }

  /** Periodic cleanup of expired buckets. Call on an interval. */
  function sweep() {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }

  return { allow, sweep };
}

module.exports = { createRateLimiter };
