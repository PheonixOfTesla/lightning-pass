const QRCode = require('qrcode');

async function generate(data) {
  try {
    return await QRCode.toDataURL(data);
  } catch (error) {
    throw new Error('Failed to generate QR code');
  }
}

module.exports = { generate };
