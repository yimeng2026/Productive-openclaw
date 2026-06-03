import { Router } from "express";
import crypto from "crypto";
import { asyncWrapper } from "../utils/asyncWrapper";

const router: Router = Router();

interface Swarm {
  id: string;
  name: string;
  description: string;
  status: "healthy" | "degraded" | "unhealthy";
  health_score: number;
  agent_count: number;
  active_tasks: number;
  total_tasks: number;
  createdAt: string;
  updatedAt: string;
}

const swarms = new Map<string, Swarm>();
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

/* GET /swarm — list all swarms */
router.get("/", asyncWrapper(async (_req, res) => {
  res.json({
    success: true,
    data: Array.from(swarms.values()),
  });
}));

/* POST /swarm — create a swarm */
router.post("/", asyncWrapper(async (req, res) => {
  const { name, description } = req.body;
  if (!name || typeof name !== "string") {
    return res.status(400).json({ success: false, error: "name required" });
  }
  const t = now();
  const swarm: Swarm = {
    id: uid(),
    name,
    description: description || "",
    status: "healthy",
    health_score: 85,
    agent_count: 0,
    active_tasks: 0,
    total_tasks: 0,
    createdAt: t,
    updatedAt: t,
  };
  swarms.set(swarm.id, swarm);
  res.status(201).json({ success: true, data: swarm });
}));

/* GET /swarm/:id — get a swarm */
router.get("/:id", asyncWrapper(async (req, res) => {
  const swarm = swarms.get(req.params.id);
  if (!swarm) {
    return res.status(404).json({ success: false, error: "NF" });
  }
  res.json({ success: true, data: swarm });
}));

/* DELETE /swarm/:id — delete a swarm */
router.delete("/:id", asyncWrapper(async (req, res) => {
  const { id } = req.params;
  if (!swarms.has(id)) {
    return res.status(404).json({ success: false, error: "NF" });
  }
  swarms.delete(id);
  res.json({ success: true, data: { id, deleted: true } });
}));

export default router;
