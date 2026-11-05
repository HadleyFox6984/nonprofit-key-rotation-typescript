import { createHmac } from "node:crypto";
import { receiptMessage, verifyWebhookSignature } from "./rotation_service.ts";

const raw = JSON.stringify({ event: "email.delivered", campaign: "spring-appeal" });
const secret = "webhook-secret";
const signature = createHmac("sha256", secret).update(raw).digest("hex");

if (receiptMessage({ donorName: "Mina", amountUsd: 25, campaign: "spring-appeal" }) !== "Receipt for Mina: $25.00 to spring-appeal") {
  throw new Error("receipt decision changed");
}
if (!verifyWebhookSignature(raw, signature, secret)) throw new Error("webhook signature was not accepted");
if (verifyWebhookSignature(raw, signature.slice(0, -1), secret)) throw new Error("invalid signature was accepted");
console.log("receipt formatting and webhook verification passed");
