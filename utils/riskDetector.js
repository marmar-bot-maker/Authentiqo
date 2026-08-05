// Risk Alert detection
//
// Surfaces plain-language warnings at the specific point in a device's
// timeline where they're relevant, e.g. "screen replaced 3 times in one
// year" attached to the third such repair, or "changed hands 4 times in
// 2 years" attached to that ownership event. Computed entirely from data
// that already exists in repair_logs and ownership_events — no new table.

const PART_KEYWORDS = ['battery', 'screen', 'display', 'keyboard', 'camera', 'motherboard', 'charging port', 'speaker'];

function daysBetween(a, b) {
  return Math.abs(new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24);
}

function guessPartKeyword(description) {
  const lower = (description || '').toLowerCase();
  return PART_KEYWORDS.find((k) => lower.includes(k)) || null;
}

// Returns a map keyed by repair_log id -> risk alert to render inline
// under that specific timeline entry (repeated-part-repair case), plus
// a map keyed by ownership_event index -> risk alert (rapid-transfer case).
function detectRisks({ repairLogs = [], ownershipEvents = [], deviceCreatedAt }) {
  const repairRisks = {}; // repair_log id -> { severity, title, explanation }
  const ownershipRisks = {}; // event index -> { severity, title, explanation }

  // --- Same part repaired 3+ times within any trailing 365-day window ---
  const byKeyword = {};
  repairLogs.forEach((r) => {
    const kw = guessPartKeyword(r.description);
    if (!kw) return;
    if (!byKeyword[kw]) byKeyword[kw] = [];
    byKeyword[kw].push(r);
  });

  Object.entries(byKeyword).forEach(([kw, entries]) => {
    const sorted = [...entries].sort((a, b) => new Date(a.repair_date) - new Date(b.repair_date));
    for (let i = 0; i < sorted.length; i++) {
      const windowEntries = sorted.filter((e) => daysBetween(sorted[i].repair_date, e.repair_date) <= 365 && new Date(e.repair_date) <= new Date(sorted[i].repair_date));
      if (windowEntries.length >= 3) {
        const flagged = windowEntries[windowEntries.length - 1];
        const span = daysBetween(windowEntries[0].repair_date, flagged.repair_date);
        const partName = kw.charAt(0).toUpperCase() + kw.slice(1);
        let severity, title, explanation;
        if (span <= 30) {
          severity = 'high';
          title = `${partName} replaced ${windowEntries.length} times in under a month`;
          explanation = 'Three or more repairs to the same part within a single month is unusually frequent — worth asking the seller or shop about directly rather than assuming it\'s routine wear.';
        } else if (span <= 90) {
          severity = 'high';
          title = `${partName} replaced ${windowEntries.length} times within ${Math.round(span)} days`;
          explanation = 'Repeated replacements of the same part in a short window can indicate an underlying, unresolved issue rather than a one-off fix.';
        } else {
          severity = 'moderate';
          title = `${partName} replaced ${windowEntries.length} times in one year`;
          explanation = 'Repeated replacements of the same part over the course of a year is less alarming than a tight cluster, but still worth a quick question about what changed.';
        }
        if (flagged.id) {
          repairRisks[flagged.id] = { severity, title, explanation };
        }
      }
    }
  });

  // --- Ownership changed hands frequently relative to device age ---
  // Only platform-verified transfers count here — a seller disclosing several
  // pre-platform owners at once is honesty, not a rapid-resale red flag.
  const verifiedEvents = ownershipEvents.filter((e) => e.source !== 'seller_declared');
  if (verifiedEvents.length >= 2) {
    const sortedEvents = [...verifiedEvents].sort((a, b) => new Date(a.transferred_at) - new Date(b.transferred_at));
    // Owner #1's row is a registration, not a real "hand change" — don't count it.
    const realTransferCount = sortedEvents.filter((e) => e.new_owner_number > 1).length;
    const ageYears = Math.max(daysBetween(deviceCreatedAt, new Date()) / 365, 0.5);
    const transfersPerYear = realTransferCount / ageYears;

    if (realTransferCount >= 2 && transfersPerYear >= 2) {
      const lastIdx = sortedEvents.length - 1;
      ownershipRisks[lastIdx] = {
        severity: transfersPerYear >= 3 ? 'high' : 'moderate',
        title: `Changed hands ${realTransferCount} times in ${ageYears.toFixed(1)} years`,
        explanation: 'Frequent resale can be completely ordinary, but unusually rapid turnover is worth asking the seller about directly.',
      };
    }

   // Rapid flips: two transfers within 14 days of each other. Skips any gap
    // involving owner #1 — that timestamp is just when the first owner
    // registered on Authentiqo, not when they actually acquired the device,
    // so it's not a real date to measure a "resale" against.
    for (let i = 1; i < sortedEvents.length; i++) {
      if (sortedEvents[i - 1].new_owner_number === 1) continue;
      const gap = daysBetween(sortedEvents[i - 1].transferred_at, sortedEvents[i].transferred_at);
      if (gap < 14) {
        ownershipRisks[i] = {
          severity: 'high',
          title: 'Resold within two weeks of the previous transfer',
          explanation: 'A very fast resale shortly after acquiring a device is uncommon and worth a direct question to the seller.',
        };
      }
    }
  }

  return { repairRisks, ownershipRisks };
}

module.exports = { detectRisks };
