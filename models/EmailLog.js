const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema({
  // Sender info
  senderType: { type: String, enum: ['admin', 'host'], required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderEmail: { type: String, required: true },

  // Email content
  subject: { type: String, required: true },
  bodyPreview: { type: String },  // First 500 chars of body

  // Recipients
  recipientCount: { type: Number, required: true },
  recipientEmails: [{ type: String }],

  // Context
  venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue' },
  venueName: { type: String },

  // Results
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  failedEmails: [{
    email: String,
    error: String
  }],

  // Timestamps
  sentAt: { type: Date, default: Date.now },
  completedAt: { type: Date }
});

// Index for efficient querying by sender
emailLogSchema.index({ senderId: 1, sentAt: -1 });
emailLogSchema.index({ senderType: 1, sentAt: -1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
