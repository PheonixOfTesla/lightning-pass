class FT {
  logPurchaseEvent(userId, venueId, amount, passCount) {
    console.log(`[PURCHASE] User: ${userId}, Venue: ${venueId}, Amount: $${amount}, Passes: ${passCount}`);
  }
  
  logPriceChange(venueId, oldPrice, newPrice, reason) {
    console.log(`[PRICE_CHANGE] Venue: ${venueId}, ${oldPrice} → ${newPrice}, Reason: ${reason}`);
  }
  
  logQueueEvent(venueId, action, data) {
    console.log(`[QUEUE] Venue: ${venueId}, Action: ${action}, Data:`, data);
  }
}

module.exports = new FT();
