const mongoose = require('mongoose');

const passSchema = new mongoose.Schema({
  passId: { type: String, required: true, unique: true, index: true },
  venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true, index: true },
  venueName: { type: String, required: true },
  userId: mongoose.Schema.Types.ObjectId,
  email: { type: String, required: true, index: true },
  phone: { type: String, required: true },
  purchasePrice: { type: Number, required: true },
  quantity: { type: Number, default: 1 },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['active', 'used', 'expired', 'cancelled', 'refunded'],
    default: 'active',
    index: true
  },
  qrCode: { type: String, required: true },
  validUntil: { type: Date, required: true, index: true },
  usedAt: Date,
  usedBy: String,  // Email of scanner who marked it used

  // Refund tracking
  refundRequested: { type: Boolean, default: false },
  refundRequestedAt: Date,
  refundStatus: {
    type: String,
    enum: ['none', 'pending', 'approved', 'denied', 'venue_refunded'],
    default: 'none'
  },
  refundedAt: Date,
  refundedBy: String,  // Email of who issued refund
  stripeRefundId: String,

  // Pass Template Reference
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'PassTemplate' },
  passName: { type: String },  // e.g., "VIP Unlimited Drinks"
  passDescription: { type: String },
  tagline: { type: String },  // e.g., "DJ ESCO at 9pm - Enjoy the night!"

  // Payment tracking for idempotency
  stripePaymentIntentId: { type: String, unique: true, sparse: true, index: true },

  // Comp pass tracking
  isComp: { type: Boolean, default: false },
  generationType: { type: String, enum: ['purchase', 'host_comp', 'host_bulk', 'admin_comp'], default: 'purchase' },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Metadata
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
});

// Update timestamp on save
passSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Compound indexes for common queries
passSchema.index({ venueId: 1, status: 1, createdAt: -1 });
passSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model('Pass', passSchema);
