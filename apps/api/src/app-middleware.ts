import { recordLatency, getMetrics } from "./perf.js";
import express, { type Request, type Response, type NextFunction } from "express";
import net from "node:net";
import { extractSessionId, hasPermission } from "@kxkm/auth";
import type { AuthSession, Permission } from "@kxkm/core";
import { getPersonaMemoryTelemetry } from "./persona-memory-telemetry.js";

export interface SessionRequest extends Request {
  session?: AuthSession;
}

export function createSessionMiddleware(sessionRepo: { findById(id: string): Promise<AuthSession | null> }): express.RequestHandler {
  return (req: SessionRequest, _res: Response, next: NextFunction) => {
    const sessionId = extractSessionId(req as unknown as { cookies?: Record<string, string>; headers?: Record<string, string> });
    if (!sessionId) {
      next();
      return;
    }
    sessionRepo.findById(sessionId)
      .then((session) => {
        if (session) req.session = session;
        next();
      })
      .catch(next);
  };
}

export function createRequireSession(): express.RequestHandler {
  return (req: SessionRequest, res: Response, next: NextFunction) => {
    if (!req.session) {
      res.status(401).json({ ok: false, error: "session_required" });
      return;
    }
    next();
  };
}

export function createRequirePermission(permission: Permission): express.RequestHandler {
  return (req: SessionRequest, res: Response, next: NextFunction) => {
    if (!req.session) {
      res.status(401).json({ ok: false, error: "session_required" });
      return;
    }
    if (!hasPermission(req.session.role, permission)) {
      res.status(403).json({ ok: false, error: "permission_denied" });
      return;
    }
    next();
  };
}

interface ParsedSubnet {
  version: number;
  mask: bigint;
  network: bigint;
}

function normalizeIp(value: string): string {
  let ip = value.trim();
  const zoneIndex = ip.indexOf("%");
  if (zoneIndex >= 0) ip = ip.slice(0, zoneIndex);
  if (ip.startsWith("::ffff:") && net.isIP(ip.slice(7)) === 4) {
    return ip.slice(7);
  }
  return ip;
}

function ipv4ToBigInt(ip: string): bigint {
  return ip.split(".").reduce((r, o) => (r << 8n) + BigInt(Number.parseInt(o, 10)), 0n);
}

function ipv6ToBigInt(ip: string): bigint {
  const parts = ip.split("::");
  const head = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const tail = parts[1] ? parts[1].split(":").filter(Boolean) : [];
  const missing = 8 - (head.length + tail.length);
  const groups = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  return groups.reduce((r, g) => (r << 16n) + BigInt(Number.parseInt(g || "0", 16)), 0n);
}

function parseSubnet(entry: string): ParsedSubnet | null {
  const raw = entry.trim();
  if (!raw) return null;
  const [addressPart, prefixPart] = raw.split("/");
  const address = normalizeIp(addressPart);
  const version = net.isIP(address);
  if (!version) return null;

  const totalBits = version === 4 ? 32 : 128;
  const prefix = prefixPart === undefined ? totalBits : Number.parseInt(prefixPart, 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > totalBits) return null;

  const bits = BigInt(totalBits);
  const hostBits = BigInt(totalBits - prefix);
  const allOnes = (1n << bits) - 1n;
  const mask = prefix === 0 ? 0n : (allOnes << hostBits) & allOnes;
  const value = version === 4 ? ipv4ToBigInt(address) : ipv6ToBigInt(address);

  return { version, mask, network: value & mask };
}

function isIpInSubnet(ip: string, subnet: ParsedSubnet): boolean {
  const normalized = normalizeIp(ip);
  const version = net.isIP(normalized);
  if (!version || version !== subnet.version) return false;
  const value = version === 4 ? ipv4ToBigInt(normalized) : ipv6ToBigInt(normalized);
  return (value & subnet.mask) === subnet.network;
}

export function createAdminSubnetMiddleware(adminSubnet: string | undefined): express.RequestHandler | null {
  if (!adminSubnet) {
    return null;
  }
  const subnet = parseSubnet(adminSubnet);
  if (!subnet) {
    return null;
  }
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = normalizeIp(req.ip || req.socket?.remoteAddress || "");
    if (!isIpInSubnet(ip, subnet)) {
      res.status(403).json({ ok: false, error: "subnet_denied" });
      return;
    }
    next();
  };
}

export function createPerfTracker() {
  const perfStats = {
    requestCount: 0,
    totalLatencyMs: 0,
    maxLatencyMs: 0,
    statusCodes: new Map<number, number>(),
    startedAt: Date.now(),
  };

  const middleware: express.RequestHandler = (_req: Request, res: Response, next: NextFunction) => {
    const start = performance.now();
    res.on("finish", () => {
      const latency = performance.now() - start;
      perfStats.requestCount++;
      perfStats.totalLatencyMs += latency;
      if (latency > perfStats.maxLatencyMs) perfStats.maxLatencyMs = latency;
      recordLatency("http", latency);
      perfStats.statusCodes.set(res.statusCode, (perfStats.statusCodes.get(res.statusCode) || 0) + 1);
    });
    next();
  };

  const route: express.RequestHandler = (_req: Request, res: Response) => {
    const uptimeMs = Date.now() - perfStats.startedAt;
    const avgLatency = perfStats.requestCount > 0 ? perfStats.totalLatencyMs / perfStats.requestCount : 0;
    const mem = process.memoryUsage();
    res.json({
      ok: true,
      data: {
        uptime_ms: uptimeMs,
        uptime_human: `${Math.floor(uptimeMs / 3600000)}h${Math.floor((uptimeMs % 3600000) / 60000)}m`,
        requests: perfStats.requestCount,
        avg_latency_ms: Math.round(avgLatency * 100) / 100,
        max_latency_ms: Math.round(perfStats.maxLatencyMs * 100) / 100,
        percentiles: getMetrics(),
        persona_memory: getPersonaMemoryTelemetry(),
        status_codes: Object.fromEntries(perfStats.statusCodes),
        memory: {
          rss_mb: Math.round(mem.rss / 1048576),
          heap_used_mb: Math.round(mem.heapUsed / 1048576),
          heap_total_mb: Math.round(mem.heapTotal / 1048576),
          external_mb: Math.round(mem.external / 1048576),
        },
      },
    });
  };

  return { middleware, route };
}
