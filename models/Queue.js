const mongoose = require('mongoose');

const queueSchema = new mongoose.Schema({
  venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue', required: true },
  timestamp: { type: Date, default: Date.now },
  peopleInLine: { type: Number, default: 0 },
  avgWaitTime: { type: Number, default: 0 },
  capacity: { type: Number, default: 500 }
});

module.exports = mongoose.model('Queue', queueSchema);
