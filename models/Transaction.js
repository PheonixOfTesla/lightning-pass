const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  passId: { type: String, required: true },
  venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue' },
  venueName: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  amount: { type: Number, required: true },
  venueRevenue: { type: Number, required: true },
  platformFee: { type: Number, required: true },
  stripeChargeId: { type: String, required: true },
  status: { type: String, enum: ['pending', 'completed', 'refunded'], default: 'completed' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', transactionSchema);
