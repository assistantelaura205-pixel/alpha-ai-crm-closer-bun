// Placeholder — l'agent CRM Closer va ajouter le code complet du service Bun
// (basé sur bun-server-v4.tsx + tous les fixes documentés).
//
// Voir BRIEF_AGENT_SKOOL_REPO_BUN.md pour le détail.

import { Hono } from "hono@4";

const app = new Hono();

app.get("/", (c) => c.text("alpha-ai-crm-closer-bun — placeholder (le vrai code arrive)"));

app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

export default app;
