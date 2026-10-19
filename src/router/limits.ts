/**
 * Token buckets for public traffic (roadmap §2.4). Checked before an event is
 * routed, so a rejected request never reaches the model. In-memory only: a
 * restart refills every bucket, which is acceptable for abuse throttling.
 */

interface Bucket { tokens: number; updatedAt: number }

export class TokenBucket {
  private buckets = new Map<string, Bucket>()
  constructor(private capacity: number, private windowMs: number) {}

  private refill(key: string, now: number) {
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now }
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.updatedAt) * this.capacity / this.windowMs)
    bucket.updatedAt = now
    this.buckets.set(key, bucket)
    return bucket
  }

  /** Seconds until one token is available; 0 when a request may pass now. */
  wait(key: string, now = Date.now()) {
    const bucket = this.refill(key, now)
    return bucket.tokens >= 1 ? 0 : Math.ceil((1 - bucket.tokens) * this.windowMs / this.capacity / 1000)
  }

  take(key: string, now = Date.now()) { this.refill(key, now).tokens -= 1 }

  /** Drops full buckets so the map does not grow with every visitor ever seen. */
  prune(now = Date.now()) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.tokens + (now - bucket.updatedAt) * this.capacity / this.windowMs >= this.capacity) this.buckets.delete(key)
    }
  }
}

/**
 * Several buckets that must all allow a request. Tokens are taken only when
 * every bucket passes, so a request rejected by the hourly limit does not also
 * drain the per-minute one.
 */
export function checkLimits(checks: Array<[TokenBucket, string]>, now = Date.now()) {
  const retryAfter = Math.max(0, ...checks.map(([bucket, key]) => bucket.wait(key, now)))
  if (!retryAfter) for (const [bucket, key] of checks) bucket.take(key, now)
  return retryAfter
}
