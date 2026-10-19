class LightningSauce {
  calculateOptimalPrice(venue, waitTime, capacity, historicalData = {}) {
    let basePrice = venue.basePrice || 25;
    let multiplier = 1;
    
    if (waitTime > 60) multiplier += 0.5;
    else if (waitTime > 30) multiplier += 0.2;
    
    const capacityUsed = venue.inLine / capacity;
    if (capacityUsed > 0.8) multiplier += 0.3;
    
    const hour = new Date().getHours();
    if (hour >= 22 && hour <= 2) multiplier += 0.2;
    
    const suggestedPrice = Math.round(basePrice * multiplier);
    
    return {
      suggestedPrice,
      reasoning: `Base: $${basePrice}, Wait: ${waitTime}min, Capacity: ${Math.round(capacityUsed * 100)}%`,
      confidence: 0.85,
      multiplier
    };
  }
  
  realTimeWaitCalculation(peopleInLine, avgEntryTime = 2, capacity) {
    const estimatedWait = Math.round(peopleInLine * avgEntryTime);
    let status;
    if (estimatedWait < 30) status = 'low';
    else if (estimatedWait < 60) status = 'medium';
    else status = 'high';
    return { estimatedWait, status };
  }
  
  validatePass(pass, venueId, userLocation = null) {
    if (!pass) return { valid: false, reason: 'Pass not found' };
    if (pass.status !== 'active') return { valid: false, reason: 'Pass already used or expired' };
    if (pass.venueId.toString() !== venueId.toString()) return { valid: false, reason: 'Pass not valid for this venue' };
    if (pass.validUntil && new Date() > pass.validUntil) return { valid: false, reason: 'Pass expired' };
    return { valid: true, passData: pass };
  }
  
  geofenceCheck(userLat, userLng, venueLat, venueLng, radiusKm = 0.5) {
    const R = 6371;
    const dLat = (venueLat - userLat) * Math.PI / 180;
    const dLon = (venueLng - userLng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(userLat * Math.PI / 180) * Math.cos(venueLat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    return { withinRange: distance <= radiusKm, distance: distance.toFixed(2) };
  }
  
  revenueMaximization(venueData, timeWindow = 'tonight') {
    const currentPrice = venueData.currentPrice;
    const avgWaitTime = venueData.waitTime;
    const optimalPricing = this.calculateOptimalPrice(venueData, avgWaitTime, venueData.capacity);
    const expectedPassesSold = Math.round(venueData.capacity * 0.15);
    const expectedRevenue = expectedPassesSold * optimalPricing.suggestedPrice * 0.7;
    return {
      optimalPricing: optimalPricing.suggestedPrice,
      expectedRevenue,
      expectedPassesSold,
      recommendations: [
        'Activate passes during peak wait times',
        'Use flash sales for slow periods',
        'Push notifications to nearby users'
      ]
    };
  }
  
  surgePricingEngine(currentDemand, timeOfDay, events = []) {
    let multiplier = 1;
    if (currentDemand > 80) multiplier = 1.5;
    else if (currentDemand > 60) multiplier = 1.3;
    else if (currentDemand > 40) multiplier = 1.1;
    if (timeOfDay >= 22 && timeOfDay <= 2) multiplier += 0.2;
    if (events.length > 0) multiplier += 0.15;
    return {
      priceMultiplier: multiplier,
      reason: `Demand: ${currentDemand}%, Time: ${timeOfDay}:00, Events: ${events.length}`
    };
  }
}

module.exports = new LightningSauce();
