// packages/daily/src/buffer.ts — the daily-manifest buffer policy (plan §1.2, mirroring the
// certificate buffer, platform §7.7): ">=90 days of manifests committed at all times; CI alerts
// below 30, hard-fails below 7." A missing day is a build-time problem, never a 6am incident.

export type BufferLevel = "ok" | "alert" | "fail";

export function classifyBuffer(count: number): BufferLevel {
  if (count < 7) return "fail";
  if (count < 30) return "alert";
  return "ok";
}
