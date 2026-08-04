// Trust Score calculation
//
// Produces a 0-100 score plus a short list of human-readable factors,
// so the buyer page can explain *why* a device scored the way it did.
// This is a transparent, rule-based v1 — swap in a real model later
// without changing the API shape (score, band, factors[]).

function daysBetween(dateA, dateB) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.abs(new Date(dateB) - new Date(dateA)) / msPerDay;
}

// Same PART_KEYWORDS/windowing approach as utils/riskDetector.js, kept in sync
// deliberately: a "screen replaced 3 times in one year" Risk Alert should never
// show up in the timeline while the numeric Trust Score stays high right next
// to it — that would be an inconsistent, confusing story on the same page.
const PART_KEYWORDS = ['battery', 'screen', 'display', 'keyboard', 'camera', 'motherboard', 'charging port', 'speaker'];

function guessPartKeyword(description) {
  const lower = (description || '').toLowerCase();
  return PART_KEYWORDS.find((k) => lower.includes(k)) || null;
}

// Counts how many repair entries fall inside a same-part cluster of 3+
// within a trailing 365-day window — mirrors riskDetector's detection exactly.
function countRepeatedPartFlags(repairLogs) {
  const byKeyword = {};
  repairLogs.forEach((r) => {
    const kw = guessPartKeyword(r.description);
    if (!kw) return;
    if (!byKeyword[kw]) byKeyword[kw] = [];
    byKeyword[kw].push(r);
  });

  let flaggedCount = 0;
  Object.values(byKeyword).forEach((entries) => {
    const sorted = [...entries].sort((a, b) => new Date(a.repair_date) - new Date(b.repair_date));
    for (let i = 0; i < sorted.length; i++) {
      const windowEntries = sorted.filter(
        (e) => daysBetween(sorted[i].repair_date, e.repair_date) <= 365 && new Date(e.repair_date) <= new Date(sorted[i].repair_date)
      );
      if (windowEntries.length >= 3) flaggedCount++;
    }
  });
  return flaggedCount;
}

function calculateTrustScore({ repairLogs = [], ownershipCount = 1, ownershipEvents = [] }) {
  let score = 70; // neutral baseline
  const factors = [];

  // --- Verification status mix ---
  if (repairLogs.length === 0) {
    factors.push({ label: 'No repair history on file', effect: 'neutral' });
  } else {
    const verifiedCount = repairLogs.filter(r => r.verification_status === 'verified').length;
    const selfReportedCount = repairLogs.length - verifiedCount;
    const verifiedRatio = verifiedCount / repairLogs.length;

    score += Math.round(verifiedRatio * 20); // up to +20 for fully verified history
    if (selfReportedCount > 0) {
      score -= Math.min(selfReportedCount * 3, 15); // self-reported entries cost confidence, capped
    }

    if (verifiedCount > 0) {
      factors.push({
        label: `${verifiedCount} verified repair ${verifiedCount === 1 ? 'entry' : 'entries'} from registered shops`,
        effect: 'positive',
      });
    }
    if (selfReportedCount > 0) {
      factors.push({
        label: `${selfReportedCount} self-reported ${selfReportedCount === 1 ? 'entry' : 'entries'} (unverified)`,
        effect: 'negative',
      });
    }

    // Repair volume itself was previously unscored — a device with 100% verified
    // repairs got the same +20 bonus whether it had 1 repair or 15. A high repair
    // count is a real signal worth reflecting in the number, not just left to the
    // ratio.
    if (repairLogs.length >= 6) {
      score -= 12;
      factors.push({ label: `${repairLogs.length} repairs on file — a high number of repairs overall`, effect: 'negative' });
    } else if (repairLogs.length >= 4) {
      score -= 6;
      factors.push({ label: `${repairLogs.length} repairs on file`, effect: 'neutral' });
    }

    // Same part repaired repeatedly — mirrors the Risk Alert shown in the
    // timeline, so the score and the visible warning never contradict each other.
    const repeatedPartFlags = countRepeatedPartFlags(repairLogs);
    if (repeatedPartFlags > 0) {
      score -= Math.min(repeatedPartFlags * 12, 25);
      factors.push({ label: 'Same part repaired multiple times within a year', effect: 'negative' });
    }
  }

  // --- Consistency / suspicious gaps or clustering ---
  if (repairLogs.length >= 2) {
    const sorted = [...repairLogs].sort((a, b) => new Date(a.repair_date) - new Date(b.repair_date));
    let suspiciousClusterCount = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gap = daysBetween(sorted[i - 1].repair_date, sorted[i].repair_date);
      if (gap < 1) suspiciousClusterCount++; // multiple "repairs" logged same day, repeatedly
    }
    if (suspiciousClusterCount >= 2) {
      score -= 10;
      factors.push({ label: 'Unusual clustering of repair entries on the same day', effect: 'negative' });
    } else {
      factors.push({ label: 'Repair history follows a plausible timeline', effect: 'positive' });
    }
  }

  // --- Ownership stability ---
  if (ownershipCount <= 1) {
    score += 8;
    factors.push({ label: 'Original owner, no transfers on record', effect: 'positive' });
  } else if (ownershipCount >= 2 && ownershipCount <= 3) {
    factors.push({ label: `${ownershipCount} recorded owners`, effect: 'neutral' });
  } else {
    score -= 10;
    factors.push({ label: `${ownershipCount} recorded owners — frequent resale`, effect: 'negative' });
  }

  // Rapid resale flips (transfers close together in time) — only counts
  // platform-verified transfers. A seller declaring several pre-platform
  // owners at once lands in the ledger with similar timestamps but isn't
  // evidence of actual rapid resale, so it's excluded from this check.
  const verifiedEvents = ownershipEvents.filter((e) => e.source !== 'seller_declared');
  if (verifiedEvents.length >= 2) {
    const sortedEvents = [...verifiedEvents].sort((a, b) => new Date(a.transferred_at) - new Date(b.transferred_at));
    let rapidFlips = 0;
    for (let i = 1; i < sortedEvents.length; i++) {
      const gap = daysBetween(sortedEvents[i - 1].transferred_at, sortedEvents[i].transferred_at);
      if (gap < 14) rapidFlips++;
    }
    if (rapidFlips > 0) {
      score -= Math.min(rapidFlips * 8, 20);
      factors.push({ label: 'One or more ownership transfers happened within two weeks of each other', effect: 'negative' });
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let band = 'moderate';
  if (score >= 80) band = 'high';
  else if (score < 50) band = 'low';

  return { score, band, factors };
}

// Repair Confidence Meter
//
// Distinct from the Trust Score: Trust asks "does this history look good,"
// Confidence asks "how much history do we actually have to go on." Both are
// shown together so a thin-but-clean record isn't confused with a thick,
// well-verified one.
function calculateConfidence({ repairLogs = [], ownershipEvents = [], partsCount = 0, warrantyCount = 0 }) {
  const factors = [];
  let points = 0;
  const maxPoints = 4;

  if (repairLogs.length > 0) {
    points += 1;
    factors.push({ ok: true, label: `${repairLogs.length} repair ${repairLogs.length === 1 ? 'entry' : 'entries'} on file` });
  } else {
    factors.push({ ok: false, label: 'No repair history logged yet' });
  }

  if (ownershipEvents.length > 0) {
    points += 1;
    factors.push({ ok: true, label: 'Ownership history on record' });
  } else {
    factors.push({ ok: false, label: 'No ownership events on record' });
  }

  if (partsCount > 0) {
    points += 1;
    factors.push({ ok: true, label: `${partsCount} part authenticity ${partsCount === 1 ? 'record' : 'records'} on file` });
  } else {
    factors.push({ ok: false, label: 'No parts authenticity data on file' });
  }

  if (warrantyCount > 0) {
    points += 1;
    factors.push({ ok: true, label: 'Warranty or service coverage on file' });
  } else {
    factors.push({ ok: false, label: 'No warranty or service records on file' });
  }

  const score = Math.round((points / maxPoints) * 100);
  let band = 'Low';
  if (score >= 75) band = 'High';
  else if (score >= 40) band = 'Medium';

  return { score, band, factors };
}

module.exports = { calculateTrustScore, calculateConfidence };
