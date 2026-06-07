# alpha-ai-crm-closer-bun

Service Railway pour le CRM Closer WhatsApp d'**ALPHA AI** (Maxence Delmas).

## Stack

- **Bun** + **Hono** (single-file service)
- **360dialog WABA** pour l'envoi / réception WhatsApp
- **Airtable** pour le storage (Leads + Messages)
- **VAPID / Web Push** pour les notifs iOS PWA

## Architecture

```
Skool Setter Bot (Python Flask, autre repo)
        ↓ POST /api/skool-relance
        ↓ POST /api/whatsapp-reply (callback for inbound replies)
this Bun service
        ↕ 360dialog WABA
        ↕ Airtable
WhatsApp prospect / Maxence iPhone (PWA)
```

## Endpoints clés

- `GET  /inbox` — l'inbox HTML (PWA-ready, avec service worker + manifest)
- `GET  /manifest.json` — PWA manifest
- `GET  /sw.js` — service worker pour les push notifs
- `POST /api/skool-relance` — appelé par le bot Skool quand un lead bascule WhatsApp queue
- `POST /api/webhook/d360` — webhook 360dialog (inbound WhatsApp)
- `POST /api/push-subscribe` — enregistre une subscription push pour Maxence
- `GET  /api/data` — récupère messages + leads depuis Airtable (paginé)
- `GET  /api/test-skool-bot` — smoke test du bridge Skool→Bun

## Env vars Railway

| Var | Description |
|-----|-------------|
| `SKOOL_SECRET` | Secret partagé avec le bot Skool (auth `X-Skool-Secret`) |
| `D360_API_KEY` | Clé API 360dialog WABA |
| `AIRTABLE_API_KEY` | Token Airtable |
| `AIRTABLE_BASE_ID` | `app32pzg9VDq1h6bb` |
| `VAPID_PUBLIC_KEY` | Public key pour Web Push |
| `VAPID_PRIVATE_KEY` | Private key pour Web Push (jamais commit) |
| `MAXENCE_PUSH_SUBSCRIPTION` | JSON de la subscription push de Maxence (set après 1er subscribe) |
| `LEGACY_AIRTABLE_WEBHOOK_URL` | Cascade vers l'ancien chemin Airtable (désactivé : `https://0.0.0.0/disabled-cascade`) |

## Déploiement

Connecté à Railway via GitHub (auto-deploy on push to `main`).

## Setup local

```bash
bun install
bun run dev
```
