// The incident pool: everything the game can deal you.
import { pack as core } from "../data/core.js";
import { pack as k8s } from "../data/pack-k8s.js";
import { pack as db } from "../data/pack-db.js";
import { pack as net } from "../data/pack-net.js";
import { pack as cid } from "../data/pack-cid.js";
import { pack as obs } from "../data/pack-obs.js";

export const POOL = [].concat(core, k8s, db, net, cid, obs).filter(
  (i) => i && typeof i.id === "string" && Array.isArray(i.steps) && i.steps.length
);

export const POOL_STATS = {
  incidents: POOL.length,
  steps: POOL.reduce((n, i) => n + i.steps.length, 0),
  choices: POOL.reduce((n, i) => n + i.steps.reduce((m, s) => m + s.choices.length, 0), 0)
};
