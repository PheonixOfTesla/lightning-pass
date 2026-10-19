const mongoose = require('mongoose');

const broadcastMessageSchema = new mongoose.Schema({
  venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
  venueName: { type: String, required: true },
  sentBy: { type: String, required: true }, // Email of venue owner who sent it
  message: { type: String, required: true },

  // Recipients info
  totalRecipients: { type: Number, required: true },
  successfulSends: { type: Number, default: 0 },
  failedSends: { type: Number, default: 0 },

  // Cost tracking
  estimatedCost: { type: Number, required: true }, // In USD
  messageSegments: { type: Number, default: 1 }, // Number of SMS segments

  // Filtering criteria
  targetAudience: {
    type: String,
    enum: ['all_customers', 'active_pass_holders', 'vip_only', 'recent_customers'],
    default: 'all_customers'
  },

  // Status
  status: {
    type: String,
    enum: ['pending', 'sending', 'completed', 'failed'],
    default: 'pending'
  },

  // Detailed results
  recipients: [{
    phone: String,
    email: String,
    status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
    errorMessage: String,
    twilioMessageSid: String
  }],

  // Metadata
  sentAt: { type: Date },
  completedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

// Indexes for common queries
broadcastMessageSchema.index({ venueId: 1, createdAt: -1 });
broadcastMessageSchema.index({ sentBy: 1, createdAt: -1 });

module.exports = mongoose.model('BroadcastMessage', broadcastMessageSchema);
