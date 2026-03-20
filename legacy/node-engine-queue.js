function createNodeEngineQueue({
  store,
  runner,
  maxConcurrency = 1,
  onError = () => {},
}) {
  const activeRuns = new Map();
  let started = false;
  let scheduling = false;
  let lastRecovery = {
    at: null,
    recoveredRunIds: [],
  };

  function getActiveRunIds() {
    return Array.from(activeRuns.keys());
  }

  function getState() {
    const queuedRuns = typeof store?.listRunsByStatus === "function"
      ? store.listRunsByStatus(["queued"], 500)
      : [];

    return {
      started,
      maxConcurrency,
      activeCount: activeRuns.size,
      activeRunIds: getActiveRunIds(),
      queuedCount: queuedRuns.length,
      queuedRunIds: queuedRuns.map((run) => run.id),
      lastRecovery,
    };
  }

  async function pumpQueue() {
    if (scheduling) return;
    scheduling = true;

    try {
      while (activeRuns.size < maxConcurrency) {
        const nextRun = store.listRunsByStatus(["queued"], 1)[0];
        if (!nextRun) break;
        if (activeRuns.has(nextRun.id)) break;
        runQueued(nextRun.id);
      }
    } finally {
      scheduling = false;
    }
  }

  function scheduleSoon() {
    queueMicrotask(() => {
      pumpQueue().catch((error) => onError(error));
    });
  }

  function runQueued(runId) {
    const work = (async () => {
      try {
        await runner.executeRun(runId, {
          shouldCancel() {
            try {
              return Boolean(store.getRun(runId).cancelRequestedAt);
            } catch {
              return false;
            }
          },
        });
      } catch (error) {
        onError(error);
      } finally {
        activeRuns.delete(runId);
        scheduleSoon();
      }
    })();

    activeRuns.set(runId, work);
    return work;
  }

  function start() {
    if (started) return getState();
    started = true;

    const recoveredRuns = typeof store?.recoverRunnableRuns === "function"
      ? store.recoverRunnableRuns()
      : [];

    lastRecovery = {
      at: new Date().toISOString(),
      recoveredRunIds: recoveredRuns.map((run) => run.id),
    };

    scheduleSoon();
    return getState();
  }

  function enqueueGraph(graphId, { actor = "admin" } = {}) {
    const run = runner.prepareRun(graphId, { actor });
    scheduleSoon();
    return run;
  }

  function cancelRun(runId) {
    const run = store.requestRunCancel(runId);
    if (run.status === "cancelled") scheduleSoon();
    return run;
  }

  return {
    start,
    enqueueGraph,
    cancelRun,
    getState,
  };
}

module.exports = {
  createNodeEngineQueue,
};
