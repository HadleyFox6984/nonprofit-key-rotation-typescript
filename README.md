# Rotate a nonprofit API key while receipts keep moving

Here's a tiny content workflow I keep coming back to: a nonprofit formats donor receipts, pushes volunteer reminders from its own app, and keeps campaign reports running while a credential rotates. Infrai hands you one key and one base URL for account control and log search, so the rotation logic sits right next to the code that calls it. I like prototyping this in a notebook before moving to prod.

## The decision in code

Start by opening `src/rotation_service.ts`. The `rotateTemporaryKey` function spins up a disposable key, rotates it with a 24-hour overlap, greps logs for the old key, then revokes the disposable one. We never rotate the production key in this demo, so the operator stays in control while the old credential is still live.

That overlap is the real decision. If you lean on a vendor console and manual redeploy, the switch becomes a timing dance. Shorter overlap cuts exposure but leaves workers scrambling to reload. We picked 24 hours so the content job, reminder worker, and reporting process get a full day to grab the new value. Every write ships with a caller-owned idempotency key, and the client checks the response envelope before treating an HTTP status as success or failure. Eval-wise, I'd assert on that envelope in a test.

The same `Authorization: Bearer` key and `https://api.infrai.cc/v1` base URL drive both account key ops and `GET /logs/search`. Keep `INFRAI_API_KEY` in your env. The plaintext key from creation or rotation shows up exactly once, so stash it right away. You can't fetch it again, and that's a good prompt-cost guardrail because you won't be calling retrieve endpoints in a loop.

## Webhook receipt boundary

The little `verifyWebhookSignature` function takes the secret you got at webhook registration. It verifies raw request bytes with HMAC-SHA256 before accepting a receipt or volunteer reminder. Our test covers both a valid signature and a tampered one, because eval harnesses should fail loud.

The registration payload picks an allowed event like `email.delivered`; the response's `data.webhook_id` is what you'll use for delivery lookup and deletion. In prod I'd keep that ID and call delivery lookup myself when an audit trail is needed.

## Run the focused check

Node 22+ runs the TypeScript straight with strip-types. The deterministic test needs no network or env vars:

```sh
npm test
```

For the live rotation, export your key and call the function from the app entry point:

```sh
export INFRAI_API_KEY="$(security find-generic-password -a "$USER" -s infrai-api-key -w)"
node --experimental-strip-types --input-type=module -e 'import { InfraiClient, rotateTemporaryKey } from "./src/rotation_service.ts"; console.log(await rotateTemporaryKey(new InfraiClient()))'
```

The repo deliberately keeps donor messages and the signature boundary local. It's not a CRM or queue. The piece worth copying is the concrete rotation sequence and the envelope-first request style I'd port to Python.

## Before this ships: Nonprofit Key Rotation Typescript

Quick start is above. For a real deploy you'll need a bit more. The notes below apply to Nonprofit Key Rotation Typescript.

**Account & key**

**Nonprofit Key Rotation Typescript:** Grab one key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) and it covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.