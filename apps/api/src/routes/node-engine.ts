import { Router, type Request, type Response, type NextFunction } from "express";
import {
  asApiData,
  createId,
  type AuthSession,
  type Permission,
} from "@kxkm/core";
import {
  createNodeEngineOverview,
  createNodeGraph,
  createNodeRun,
  type ModelRegistryRecord,
  type NodeGraphRecord,
  type NodeRunRecord,
} from "@kxkm/node-engine";
import { validate, createGraphSchema, updateGraphSchema, runGraphSchema } from "../schemas.js";

interface SessionRequest extends Request {
  session?: AuthSession;
}

type GraphRepo = {
  list(): Promise<NodeGraphRecord[]>;
  findById(id: string): Promise<NodeGraphRecord | null>;
  create(graph: NodeGraphRecord): Promise<NodeGraphRecord>;
  update(id: string, patch: Partial<NodeGraphRecord>): Promise<NodeGraphRecord | null>;
};

type RunRepo = {
  list(): Promise<NodeRunRecord[]>;
  findById(id: string): Promise<NodeRunRecord | null>;
  create(run: NodeRunRecord): Promise<NodeRunRecord>;
  updateStatus(id: string, status: NodeRunRecord["status"]): Promise<void>;
  requestCancel(id: string): Promise<void>;
  deleteOlderThan(date: string): Promise<number>;
};

interface NodeEngineRouteDeps {
  graphRepo: GraphRepo;
  runRepo: RunRepo;
  modelRegistry: ModelRegistryRecord[];
  requirePermission: (permission: Permission) => (req: SessionRequest, res: Response, next: NextFunction) => void;
  readRouteParam: (value: string | string[] | undefined) => string;
  enqueueRunTransition: (runId: string, runRepo: RunRepo) => void;
}

export function createNodeEngineRoutes(deps: NodeEngineRouteDeps): Router {
  const {
    graphRepo,
    runRepo,
    modelRegistry,
    requirePermission,
    readRouteParam,
    enqueueRunTransition,
  } = deps;

  const router = Router();

  router.get("/api/admin/node-engine/overview", requirePermission("node_engine:read"), async (_req, res) => {
    const allRuns = await runRepo.list();
    const allGraphs = await graphRepo.list();
    const overview = createNodeEngineOverview({
      graphs: allGraphs.length,
      models: modelRegistry.length,
      queuedRuns: allRuns.filter((run) => run.status === "queued").length,
      runningRuns: allRuns.filter((run) => run.status === "running").length,
    });
    res.json(asApiData(overview));
  });

  router.get("/api/admin/node-engine/graphs", requirePermission("node_engine:read"), async (_req, res) => {
    const list = await graphRepo.list();
    res.json(asApiData(list));
  });

  router.post("/api/admin/node-engine/graphs", requirePermission("node_engine:operate"), validate(createGraphSchema), async (req, res) => {
    const body = req.body as { name: string; description?: string };
    const graph = createNodeGraph(body.name, body.description || "");
    const created = await graphRepo.create(graph);
    res.status(201).json(asApiData(created));
  });

  router.put("/api/admin/node-engine/graphs/:id", requirePermission("node_engine:operate"), validate(updateGraphSchema), async (req, res) => {
    const graphId = readRouteParam(req.params.id);
    const graph = await graphRepo.findById(graphId);
    if (!graph) {
      res.status(404).json({ ok: false, error: "graph_not_found" });
      return;
    }
    const body = req.body as { name?: string; description?: string };
    const updated = await graphRepo.update(graphId, {
      name: body.name || graph.name,
      description: body.description || graph.description,
    });
    res.json(asApiData(updated));
  });

  router.post("/api/admin/node-engine/graphs/:id/run", requirePermission("node_engine:operate"), validate(runGraphSchema), async (req, res) => {
    const graphId = readRouteParam(req.params.id);
    const graph = await graphRepo.findById(graphId);
    if (!graph) {
      res.status(404).json({ ok: false, error: "graph_not_found" });
      return;
    }

    const body = req.body as { hold?: boolean };
    const run = createNodeRun(graphId, "queued");
    const created = await runRepo.create(run);
    if (!body.hold) {
      enqueueRunTransition(created.id, runRepo);
    }
    res.status(201).json(asApiData(created));
  });

  router.get("/api/admin/node-engine/runs/:id", requirePermission("node_engine:read"), async (req, res) => {
    const runId = readRouteParam(req.params.id);
    const run = await runRepo.findById(runId);
    if (!run) {
      res.status(404).json({ ok: false, error: "run_not_found" });
      return;
    }
    res.json(asApiData(run));
  });

  router.post("/api/admin/node-engine/runs/:id/cancel", requirePermission("node_engine:operate"), async (req, res) => {
    const runId = readRouteParam(req.params.id);
    const run = await runRepo.findById(runId);
    if (!run) {
      res.status(404).json({ ok: false, error: "run_not_found" });
      return;
    }
    await runRepo.updateStatus(runId, "cancelled");
    res.json(asApiData({ ...run, status: "cancelled" }));
  });

  router.post("/api/v2/node-engine/runs/:id/cancel", requirePermission("node_engine:operate"), async (req, res) => {
    const runId = readRouteParam(req.params.id);
    const run = await runRepo.findById(runId);
    if (!run) {
      res.status(404).json({ ok: false, error: "run_not_found" });
      return;
    }
    await runRepo.requestCancel(runId);
    res.json({ ok: true });
  });

  router.get("/api/admin/node-engine/artifacts/:runId", requirePermission("node_engine:read"), (req, res) => {
    const runId = readRouteParam(req.params.runId);
    res.json(asApiData({
      runId,
      artifacts: [
        { id: createId("artifact"), label: "overview.json", storage: "filesystem" },
      ],
    }));
  });

  router.get("/api/admin/node-engine/models", requirePermission("node_engine:read"), (_req, res) => {
    res.json(asApiData(modelRegistry));
  });

  return router;
}
