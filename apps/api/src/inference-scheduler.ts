import { execFileSync } from "node:child_process";
import os from "node:os";
import logger from "./logger.js";

// ---------------------------------------------------------------------------
// Inference Scheduler — CPU/GPU task management with VRAM budget
// ---------------------------------------------------------------------------

export type TaskDevice = "gpu" | "cpu";
export type TaskPriority = "high" | "normal" | "low";

export interface InferenceTask<T = unknown> {
  id: string;
  device: TaskDevice;
  priority: TaskPriority;
  label: string;
  vramMB?: number; // estimated VRAM needed (GPU tasks only)
  execute: () => Promise<T>;
}

interface QueueEntry<T = unknown> {
  task: InferenceTask<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
}

// VRAM budgets per service type (MB)
export const VRAM_BUDGETS: Record<string, number> = {
  ollama: 6000,
  comfyui: 8000,
  musicgen: 5000,
  default: 2000,
};

const MAX_VRAM_MB = parseInt(process.env.MAX_VRAM_MB || "22000", 10); // 22GB safe on 24GB
const MAX_CPU_WORKERS = parseInt(process.env.MAX_CPU_WORKERS || String(Math.max(2, os.cpus().length - 2)), 10);
const MAX_GPU_CONCURRENT = 1; // Only 1 GPU-heavy task at a time
const QUEUE_MAX_SIZE = 50;

class InferenceScheduler {
  private gpuQueue: QueueEntry[] = [];
  private cpuQueue: QueueEntry[] = [];
  private activeGpuVRAM = 0;
  private activeGpuTasks = 0;
  private activeCpuTasks = 0;
  private totalSubmitted = 0;
  private totalCompleted = 0;
  private totalRejected = 0;
  private totalTimeouts = 0;

  /** Submit a task for execution with backpressure */
  async submit<T>(task: InferenceTask<T>): Promise<T> {
    // Admission control
    if (!this.admissionCheck(task)) {
      this.totalRejected++;
      throw new Error(`Task ${task.label} rejected: system overloaded`);
    }

    this.totalSubmitted++;

    if (task.device === "cpu") {
      return this.submitCpu(task);
    }
    return this.submitGpu(task);
  }

  private submitCpu<T>(task: InferenceTask<T>): Promise<T> {
    if (this.activeCpuTasks < MAX_CPU_WORKERS) {
      return this.executeCpu(task);
    }

    // Queue it
    if (this.cpuQueue.length >= QUEUE_MAX_SIZE) {
      this.totalRejected++;
      return Promise.reject(new Error(`CPU queue full (${QUEUE_MAX_SIZE})`));
    }

    return new Promise<T>((resolve, reject) => {
      this.cpuQueue.push({ task: task as InferenceTask, resolve: resolve as (v: unknown) => void, reject, enqueuedAt: Date.now() });
      this.sortQueue(this.cpuQueue);
    });
  }

  private submitGpu<T>(task: InferenceTask<T>): Promise<T> {
    const neededVRAM = task.vramMB || VRAM_BUDGETS.default;

    if (this.activeGpuTasks < MAX_GPU_CONCURRENT && this.activeGpuVRAM + neededVRAM <= MAX_VRAM_MB) {
      return this.executeGpu(task);
    }

    // Queue it
    if (this.gpuQueue.length >= QUEUE_MAX_SIZE) {
      this.totalRejected++;
      return Promise.reject(new Error(`GPU queue full (${QUEUE_MAX_SIZE})`));
    }

    return new Promise<T>((resolve, reject) => {
      this.gpuQueue.push({ task: task as InferenceTask, resolve: resolve as (v: unknown) => void, reject, enqueuedAt: Date.now() });
      this.sortQueue(this.gpuQueue);
    });
  }

  private async executeCpu<T>(task: InferenceTask<T>): Promise<T> {
    this.activeCpuTasks++;
    logger.debug({ label: task.label, activeCpu: this.activeCpuTasks }, "[scheduler] CPU task start");

    try {
      const result = await task.execute();
      this.totalCompleted++;
      return result;
    } finally {
      this.activeCpuTasks--;
      this.drainCpuQueue();
    }
  }

  private async executeGpu<T>(task: InferenceTask<T>): Promise<T> {
    const vram = task.vramMB || VRAM_BUDGETS.default;
    this.activeGpuTasks++;
    this.activeGpuVRAM += vram;
    logger.debug({ label: task.label, vram, activeGpuVRAM: this.activeGpuVRAM, activeGpuTasks: this.activeGpuTasks }, "[scheduler] GPU task start");

    try {
      const result = await task.execute();
      this.totalCompleted++;
      return result;
    } finally {
      this.activeGpuTasks--;
      this.activeGpuVRAM -= vram;
      this.drainGpuQueue();
    }
  }

  private drainCpuQueue() {
    while (this.cpuQueue.length > 0 && this.activeCpuTasks < MAX_CPU_WORKERS) {
      const entry = this.cpuQueue.shift()!;
      this.executeCpu(entry.task).then(entry.resolve, entry.reject);
    }
  }

  private drainGpuQueue() {
    while (this.gpuQueue.length > 0 && this.activeGpuTasks < MAX_GPU_CONCURRENT) {
      const next = this.gpuQueue[0];
      const neededVRAM = next.task.vramMB || VRAM_BUDGETS.default;
      if (this.activeGpuVRAM + neededVRAM > MAX_VRAM_MB) break;
      this.gpuQueue.shift();
      this.executeGpu(next.task).then(next.resolve, next.reject);
    }
  }

  private sortQueue(queue: QueueEntry[]) {
    const priorityOrder: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };
    queue.sort((a, b) => priorityOrder[a.task.priority] - priorityOrder[b.task.priority]);
  }

  private admissionCheck(task: InferenceTask): boolean {
    if (task.device === "gpu") {
      if (this.gpuQueue.length >= QUEUE_MAX_SIZE) return false;
      // Check VRAM if we can query it
      const vramFree = getVRAMFreeMB();
      if (vramFree !== null && vramFree < 1500) {
        logger.warn({ vramFree }, "[scheduler] VRAM too low, rejecting GPU task");
        return false;
      }
    } else {
      if (this.cpuQueue.length >= QUEUE_MAX_SIZE) return false;
      const ramFree = os.freemem() / (1024 * 1024);
      if (ramFree < 500) {
        logger.warn({ ramFree }, "[scheduler] RAM too low, rejecting CPU task");
        return false;
      }
    }
    return true;
  }

  /** Get current scheduler metrics */
  getMetrics() {
    return {
      gpuQueue: this.gpuQueue.length,
      cpuQueue: this.cpuQueue.length,
      activeGpuTasks: this.activeGpuTasks,
      activeCpuTasks: this.activeCpuTasks,
      activeGpuVRAM: this.activeGpuVRAM,
      maxVRAM: MAX_VRAM_MB,
      maxCpuWorkers: MAX_CPU_WORKERS,
      totalSubmitted: this.totalSubmitted,
      totalCompleted: this.totalCompleted,
      totalRejected: this.totalRejected,
      totalTimeouts: this.totalTimeouts,
      vramFree: getVRAMFreeMB(),
      ramFree: Math.round(os.freemem() / (1024 * 1024)),
    };
  }
}

/** Query nvidia-smi for free VRAM in MB. Returns null if unavailable. */
function getVRAMFreeMB(): number | null {
  try {
    const output = execFileSync("nvidia-smi", [
      "--query-gpu=memory.free",
      "--format=csv,noheader,nounits",
    ], { timeout: 3000, encoding: "utf8" });
    const free = parseInt(output.trim().split("\n")[0], 10);
    return isNaN(free) ? null : free;
  } catch {
    return null;
  }
}

/** Query nvidia-smi for GPU utilization %. Returns null if unavailable. */
export function getGPUUtilization(): number | null {
  try {
    const output = execFileSync("nvidia-smi", [
      "--query-gpu=utilization.gpu",
      "--format=csv,noheader,nounits",
    ], { timeout: 3000, encoding: "utf8" });
    const util = parseInt(output.trim().split("\n")[0], 10);
    return isNaN(util) ? null : util;
  } catch {
    return null;
  }
}

// Singleton
export const scheduler = new InferenceScheduler();
