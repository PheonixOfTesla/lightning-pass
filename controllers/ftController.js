const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const Pass = require('../models/Pass');
const Venue = require('../models/Venue');
const FT = require('../core/FT');

// GET venue revenue - REAL DATABASE
router.get('/venue/:venueId/revenue', async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    
    const transactions = await Transaction.find({
      venueId: req.params.venueId,
      createdAt: { $gte: startDate, $lte: endDate }
    });
    
    const total = transactions.reduce((sum, t) => sum + t.venueRevenue, 0);
    const avgPassPrice = transactions.length > 0 
      ? transactions.reduce((sum, t) => sum + t.amount, 0) / transactions.length 
      : 0;
    
    res.json({
      total: Math.round(total),
      transactions: transactions.length,
      avgPassPrice: Math.round(avgPassPrice)
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET venue customers - REAL DATABASE
router.get('/venue/:venueId/customers', async (req, res) => {
  try {
    const passes = await Pass.find({ venueId: req.params.venueId });
    const uniqueCustomers = new Set(passes.map(p => p.email));
    
    res.json({
      totalCustomers: uniqueCustomers.size,
      totalPasses: passes.length,
      activePs: passes.filter(p => p.status === 'active').length
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET system overview - REAL DATABASE
router.get('/system/overview', async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const todayTransactions = await Transaction.find({
      createdAt: { $gte: startOfDay }
    });
    
    const totalRevenue = todayTransactions.reduce((sum, t) => sum + t.platformFee, 0);
    const activeVenues = await Venue.countDocuments({ isActive: true });
    const totalPasses = await Pass.countDocuments();
    
    res.json({
      totalRevenue24h: Math.round(totalRevenue),
      activeVenues,
      totalPasses,
      todayTransactions: todayTransactions.length
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET export data
router.get('/reports/export', async (req, res) => {
  try {
    res.json({ success: true, message: 'Export feature coming soon' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
