const twilio = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendSMS(phone, message) {
  const messageParams = {
    body: message,
    to: phone
  };

  // Use Messaging Service if available (better for A2P 10DLC compliance)
  // Otherwise fall back to phone number
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    messageParams.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  } else {
    messageParams.from = process.env.TWILIO_PHONE_NUMBER;
  }

  return await twilio.messages.create(messageParams);
}

async function sendPassConfirmation(phone, venue, pass) {
  const backendUrl = process.env.BACKEND_URL || 'https://lightning-backend-production.up.railway.app';
  const qrImageUrl = `${backendUrl}/api/v1/lightning/passes/${pass.passId}/qr-image`;

  let message = `⚡ Your Lightning Pass is ready for ${venue.name}!\n\nPass ID: ${pass.passId}\nPasses: ${pass.quantity}\n\nAmount: $${pass.amount.toFixed(2)}\nValid until: ${new Date(pass.validUntil).toLocaleDateString()}`;

  if (pass.passName) {
    message += `\nType: ${pass.passName}`;
  }

  if (venue.tonightTagline) {
    message += `\n\n${venue.tonightTagline}`;
  }

  message += '\n\nShow this QR code at the door! 👇';

  // Send MMS with QR code image
  return await twilio.messages.create({
    body: message,
    to: phone,
    from: process.env.TWILIO_PHONE_NUMBER,
    mediaUrl: [qrImageUrl] // Twilio will fetch and attach the QR code image
  });
}

async function sendWaitTimeUpdate(phone, venueName, newTime) {
  const message = `⚡ ${venueName} wait time updated: ${newTime} minutes!`;
  return await sendSMS(phone, message);
}

async function sendRefundApproved(phone, venueName, passId, amount) {
  const message = `✅ Your refund request for ${venueName} has been APPROVED!\n\nPass ID: ${passId}\nRefund Amount: $${amount.toFixed(2)}\n\nYour refund will appear in 5-10 business days.`;
  return await sendSMS(phone, message);
}

async function sendRefundDenied(phone, venueName, passId, reason) {
  const message = `❌ Your refund request for ${venueName} has been denied.\n\nPass ID: ${passId}\nReason: ${reason}\n\nPlease contact the venue if you have questions.`;
  return await sendSMS(phone, message);
}

async function sendRefundIssued(phone, venueName, passId, amount) {
  const message = `💸 A refund has been issued for your ${venueName} pass!\n\nPass ID: ${passId}\nRefund Amount: $${amount.toFixed(2)}\n\nYour refund will appear in 5-10 business days.`;
  return await sendSMS(phone, message);
}

async function sendBroadcastMessage(phone, message, venueName) {
  // Add venue branding to message
  const fullMessage = `${message}\n\n- ${venueName}`;

  try {
    const result = await twilio.messages.create({
      body: fullMessage,
      to: phone,
      from: process.env.TWILIO_PHONE_NUMBER
    });

    return {
      success: true,
      messageSid: result.sid,
      phone: phone
    };
  } catch (error) {
    console.error(`Failed to send broadcast to ${phone}:`, error.message);
    return {
      success: false,
      phone: phone,
      error: error.message
    };
  }
}

// Calculate SMS segments (160 chars for standard, 70 for Unicode)
function calculateSMSSegments(message) {
  const hasUnicode = /[^\x00-\x7F]/.test(message);
  const maxLength = hasUnicode ? 70 : 160;
  return Math.ceil(message.length / maxLength);
}

// Generate 6-digit verification code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send phone verification code using Twilio Verify API (A2P 10DLC compliant)
async function sendVerificationCode(phone) {
  const VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || 'VAa5cf99156e6306d83170060c8217b32d';

  return await twilio.verify.v2.services(VERIFY_SERVICE_SID)
    .verifications
    .create({
      to: phone,
      channel: 'sms'
    });
}

// Verify phone verification code using Twilio Verify API
async function verifyPhoneCode(phone, code) {
  const VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || 'VAa5cf99156e6306d83170060c8217b32d';

  return await twilio.verify.v2.services(VERIFY_SERVICE_SID)
    .verificationChecks
    .create({
      to: phone,
      code: code
    });
}

module.exports = {
  sendSMS,
  sendPassConfirmation,
  sendWaitTimeUpdate,
  sendRefundApproved,
  sendRefundDenied,
  sendRefundIssued,
  sendBroadcastMessage,
  calculateSMSSegments,
  generateVerificationCode,
  sendVerificationCode,
  verifyPhoneCode
};
