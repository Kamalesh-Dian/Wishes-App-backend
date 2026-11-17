# Wishes AI — Backend API & Automation Engine

Enterprise-grade backend service powering automated corporate greetings and AI visual generation. Built on **Express 5**, **TypeScript**, **MongoDB (Mongoose 9)**, **Firebase Admin**, and **Pino**.

---

## 🏗 Architecture Overview

- **Express 5 REST API:** Strict route modularity (`*.routes.ts`), secure headers via `helmet()`, CORS origin whitelisting, and tiered rate limiting with `express-rate-limit`.
- **Authentication:** All protected endpoints verify Firebase ID tokens (`Authorization: Bearer <token>`) via `firebase-admin`. User identity is strictly resolved from `req.user.uid`.
- **Token Security:** Microsoft OAuth access tokens are encrypted at rest using AES-256-GCM (`backend/src/utils/encryption.ts`).
- **Autonomous Scheduler:** Node-cron task running every 5 minutes with atomic event claiming (`findOneAndUpdate` loop) to prevent race conditions across server processes.
- **SSRF Hardening:** Dedicated secure image proxy (`backend/src/services/imageProcessor.ts`) enforcing HTTPS-only, blocking private/loopback/link-local IP ranges, validating DNS A/AAAA records, and capping streaming downloads to 10MB.
- **Structured Logging:** Powered by `pino` with automatic redaction of bearer tokens, passwords, API keys, and base64 payloads.

---

## 🚀 Prerequisites & Setup

### Requirements
- **Node.js:** v20.x or higher
- **MongoDB:** v6.0 or higher (local instance or MongoDB Atlas)
- **Firebase Project:** With Authentication enabled and a Service Account JSON downloaded
- **Cloudinary Account:** For persistent storage of generated cards and user avatars
- **SMTP Provider:** (e.g. Gmail App Password or SendGrid) for automated greeting emails

### Installation

```bash
cd backend
npm install
```

### Firebase Service Account Setup
Download your service account private key from the Firebase Console (`Project Settings > Service Accounts > Generate new private key`) and place it in `backend/firebase-service-account.json` (ensure this file is gitignored).

---

## 🔑 Environment Variables

Copy `.env.example` to `.env` and configure the following variables:

| Variable | Description | Required | Default |
| :--- | :--- | :---: | :--- |
| `PORT` | HTTP port the server listens on | No | `5000` |
| `FRONTEND_URL` | Allowed origin for CORS (comma-separated for multiple) | Yes | `http://localhost:5173` |
| `MONGO_URI` | MongoDB connection string | Yes | — |
| `ENCRYPTION_KEY` | 32-character secret key for AES-256-GCM token encryption | Yes | (Generates ephemeral key with warning) |
| `ADMIN_UIDS` | Comma-separated Firebase UIDs authorized for admin routes | Yes | — |
| `DEFAULT_TZ` | Default timezone for scheduling daily greetings | No | `Asia/Kolkata` |
| `LOG_LEVEL` | Logging level (`debug`, `info`, `warn`, `error`, `fatal`) | No | `info` |
| `GEMINI_API_KEY` | Google Gemini API key for image and greeting synthesis | Yes | — |
| `HF_TOKEN` | Hugging Face user access token for FLUX diffusion fallback | Optional | — |
| `FLUX_API_URL` | URL to self-hosted FLUX.3 Klein diffusion endpoint | Optional | — |
| `DAILY_GENERATION_LIMIT` | Per-user rate cap for AI image generation requests | No | `20` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud identifier | Yes | — |
| `CLOUDINARY_API_KEY` | Cloudinary API access key | Yes | — |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret | Yes | — |
| `MAIL_HOST` | SMTP server host (e.g. `smtp.gmail.com`) | Yes | — |
| `MAIL_PORT` | SMTP server port (`587` for STARTTLS, `465` for SSL) | Yes | `587` |
| `MAIL_USER` | SMTP username / sender email address | Yes | — |
| `MAIL_PASSWORD` | SMTP password or Google App Password | Yes | — |
| `MAIL_FROM` | RFC 5322 From display string, e.g. `"Wishes AI <greetings@company.com>"` | Yes | — |
| `MS_CLIENT_ID` | Azure App Registration Client ID for OneDrive sync | Optional | — |
| `MS_TENANT_ID` | Azure App Registration Tenant ID (`common` or UUID) | Optional | `common` |
| `MS_CLIENT_SECRET` | Azure App Registration Client Secret | Optional | — |

---

## 🏃 Running the Application

### Development Mode
Runs with hot-reloading via `ts-node-dev`:
```bash
npm run dev
```

### Production Build
Compiles TypeScript to JavaScript in `dist/`:
```bash
npm run build
npm start
```

### Running Tests
Executes the comprehensive automated test suite (55 unit and integration tests across 12 suites) with Vitest:
```bash
npm test
```

---

## ⏱ Scheduler & Automation Behavior

The automation scheduler is managed by `backend/src/cron/automation.cron.ts` and `backend/src/services/automation/scheduler.service.ts`:

1. **Cycle Frequency:** The cron job triggers every 5 minutes (`*/5 * * * *`).
2. **Concurrency Lock:** An in-process `isRunning` flag immediately returns if a previous job cycle is still executing.
3. **Stuck Event Recovery:** Before processing, any events left in `generating` or `sending` state for longer than 15 minutes (caused by crashes or timeouts) are automatically reset back to `pending`.
4. **OneDrive Auto-Sync:** Connected OneDrive Excel sheets with `syncEnabled: true` are re-synced via Microsoft Graph prior to query execution.
5. **Atomic Claim Loop:** Events matching today's month and day are claimed one-by-one using an atomic `Event.findOneAndUpdate({ _id, status: "pending" }, { status: "generating", claimedAt: new Date() })`. This prevents duplicate emails even if multiple scheduler instances query concurrently.
6. **Timezone & Leap Year Handling:** The current date is calculated in `DEFAULT_TZ` (or per-user timezone). In non-leap years on February 28th, events scheduled for February 29th are automatically included so leap-day birthdays are never missed.
7. **Exponential Backoff & Max Retries:** Failed events are retried with exponential backoff (attempt 1: 5-minute cooldown; attempt 2: 15-minute cooldown). When attempts reach 3, the event is permanently marked `failed`, logging a critical alert with operator context.

---

## 📡 API Overview

All protected endpoints require the HTTP header:
```http
Authorization: Bearer <Firebase_ID_Token>
```

### 1. Events API (`/api/events`)
- `GET /api/events?source=excel|onedrive` — List user's events sorted by date.
- `POST /api/events/import` — Upload and sync events from an `.xlsx` workbook (multipart/form-data, max 5MB, max 1000 rows).
- `POST /api/events/json` — Import raw JSON array of event items.
- `PUT /api/events/:eventId` — Update event details (scoped strictly to authenticated user).
- `DELETE /api/events/:eventId` — Delete a single event (scoped to user).
- `POST /api/events/:eventId/save-wish` — Save generated card asset to the event.

### 2. AI Generation API (`/api/generate`)
- `POST /api/generate` — Generate custom greeting artwork.
  - Body: `{ occasion, theme, people, decorations, customMessage, aiEngine, uploadedImage, additionalInformation }`
  - Validated by Zod; rate-limited to 20 requests per 15 minutes per IP + per-user daily quota.

### 3. OneDrive API (`/api/onedrive`)
- `GET /api/onedrive/status` — Get connection state, token expiration status (`needsReconnect`), and last sync timestamp.
- `POST /api/onedrive/import` — Download and import an Excel workbook from Microsoft Graph.
- `POST /api/onedrive/sync` — Trigger immediate synchronization of connected OneDrive spreadsheet.
- `POST /api/onedrive/preview` — Preview first 15 rows of a selected OneDrive spreadsheet.

### 4. Upload API (`/api/upload`)
- `POST /api/upload` — Upload image asset to Cloudinary (restricted to JPEG/PNG/WebP, max 5MB).

### 5. Automation Trigger (`/api/automation`)
- `POST /api/automation/run` — Manually trigger an automation cycle (Restricted to `ADMIN_UIDS`).
- `POST /api/automation/generate` — Trigger single event automated generation (Authenticated).

### 6. History API (`/api/history`)
- `GET /api/history` — Get recent 20 generations for the authenticated user.
- `DELETE /api/history/:id` — Delete a wish from history.
- `DELETE /api/history` — Batch delete wishes (`{ ids: [...] }`).
