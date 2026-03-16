export function formatOverviewLine(overview) {
    return [
        `workers=${overview.queue.activeWorkers}/${overview.queue.desiredWorkers}`,
        `queued=${overview.queue.queuedRuns}`,
        `running=${overview.queue.runningRuns}`,
        `graphs=${overview.registry.graphs}`,
        `models=${overview.registry.models}`,
    ].join(" ");
}
//# sourceMappingURL=index.js.map