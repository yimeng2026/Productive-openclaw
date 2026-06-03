import express from "express";
import { Channel } from "../types";

const router: express.Router = express.Router();

// In-memory store (placeholder)
const channels: Channel[] = [];

router.get("/", (_req, res) => {
  res.json({ channels });
});

router.post("/", (req, res) => {
  const { name, type = "group", participants = [] } = req.body;
  const channel: Channel = {
    id: `ch_${Date.now()}`,
    name: name || "unnamed",
    type,
    participants,
    createdAt: Date.now(),
  };
  channels.push(channel);
  res.status(201).json(channel);
});

router.get("/:id", (req, res) => {
  const channel = channels.find((c) => c.id === req.params.id);
  if (!channel) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }
  res.json(channel);
});

export default router;
