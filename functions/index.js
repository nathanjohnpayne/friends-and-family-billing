const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();

const ALLOWED_ORIGINS = [
  "https://friends-and-family-billing.web.app",
  "https://friends-and-family-billing.firebaseapp.com",
];

function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Max-Age", "3600");
}

const { computeMemberSummary } = require("./billing");

exports.resolveShareToken = onRequest({ region: "us-central1" }, async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { token } = req.body || {};
  if (!token || typeof token !== "string" || token.length < 32) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }

  try {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const tokenDoc = await db.collection("shareTokens").doc(hash).get();

    if (!tokenDoc.exists) {
      res.status(404).json({ error: "This link is invalid or has been removed." });
      return;
    }

    const tokenData = tokenDoc.data();

    if (tokenData.revoked) {
      res.status(403).json({ error: "This link has been revoked by the account owner." });
      return;
    }

    if (tokenData.expiresAt) {
      const expiry = tokenData.expiresAt.toDate ? tokenData.expiresAt.toDate() : new Date(tokenData.expiresAt);
      if (expiry < new Date()) {
        res.status(403).json({ error: "This link has expired." });
        return;
      }
    }

    const yearDoc = await db
      .collection("users")
      .doc(tokenData.ownerId)
      .collection("billingYears")
      .doc(tokenData.billingYearId)
      .get();

    if (!yearDoc.exists) {
      res.status(404).json({ error: "Billing data not found." });
      return;
    }

    const yearData = yearDoc.data();
    const familyMembers = (yearData.familyMembers || []).map((m) => {
      if (!m.linkedMembers) m.linkedMembers = [];
      return m;
    });
    const billsData = (yearData.bills || []).map((b) => {
      if (!b.members) b.members = [];
      return b;
    });
    const payments = yearData.payments || [];
    const yearSettings = yearData.settings || {};

    const primarySummary = computeMemberSummary(familyMembers, billsData, tokenData.memberId);
    if (!primarySummary) {
      res.status(404).json({ error: "Member not found in billing data." });
      return;
    }

    const primaryMember = familyMembers.find((m) => m.id === tokenData.memberId);
    const linkedIds = primaryMember.linkedMembers || [];
    const linkedSummaries = linkedIds
      .map((id) => computeMemberSummary(familyMembers, billsData, id))
      .filter(Boolean);

    const paymentTotal = payments
      .filter((p) => p.memberId === tokenData.memberId)
      .reduce((sum, p) => sum + (p.amount || 0), 0);
    let combinedAnnual = primarySummary.annualTotal;
    let combinedPayment = paymentTotal;

    linkedSummaries.forEach((ls) => {
      combinedAnnual += ls.annualTotal;
      combinedPayment += payments
        .filter((p) => p.memberId === ls.memberId)
        .reduce((sum, p) => sum + (p.amount || 0), 0);
    });

    tokenDoc.ref
      .update({
        lastAccessedAt: FieldValue.serverTimestamp(),
        accessCount: FieldValue.increment(1),
      })
      .catch(() => {});

    const scopes = tokenData.scopes || ["summary:read", "paymentLinks:read"];
    const result = {
      memberName: primarySummary.name,
      year: yearData.label || tokenData.billingYearId,
      scopes: scopes,
    };

    if (scopes.includes("summary:read")) {
      result.summary = primarySummary;
      result.linkedMembers = linkedSummaries;
      result.paymentSummary = {
        combinedAnnualTotal: Math.round(combinedAnnual * 100) / 100,
        combinedMonthlyTotal: Math.round((combinedAnnual / 12) * 100) / 100,
        totalPaid: Math.round(combinedPayment * 100) / 100,
        balanceRemaining: Math.round((combinedAnnual - combinedPayment) * 100) / 100,
      };
    }

    if (scopes.includes("paymentLinks:read")) {
      result.paymentLinks = yearSettings.paymentLinks || [];
    }

    res.status(200).json(result);
  } catch (err) {
    console.error("resolveShareToken error:", err);
    res.status(500).json({ error: "An unexpected error occurred. Please try again." });
  }
});
