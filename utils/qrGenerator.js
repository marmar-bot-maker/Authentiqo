// QR code generation
//
// The QR encodes a JSON payload (repair-history summary + ownership count)
// so a scanner app could read the payload directly, but it is generated as
// a URL-safe string appended after the canonical device link, and the QR
// image itself always POINTS to https://yourdomain.com/device/{SERIAL}
// which is the live, always-current source of truth. Encoding a link (not a
// full data blob) also keeps the QR simple to scan and means the buyer
// always sees live data, not a stale snapshot baked in at generation time.

const QRCode = require('qrcode');

function buildDeviceUrl(baseUrl, serialNumber) {
  return `${baseUrl.replace(/\/$/, '')}/device/${encodeURIComponent(serialNumber)}`;
}

async function generateDeviceQrCode({ baseUrl, serialNumber, repairCount, ownershipCount }) {
  const url = buildDeviceUrl(baseUrl, serialNumber);

  // Small metadata comment embedded is NOT put inside the QR (keeps it scannable
  // by any standard QR reader, not just this app) - the QR only ever encodes the URL.
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: {
      dark: '#0F2942',
      light: '#FFFFFF',
    },
  });

  return { url, dataUrl, repairCount, ownershipCount };
}

module.exports = { generateDeviceQrCode, buildDeviceUrl };
