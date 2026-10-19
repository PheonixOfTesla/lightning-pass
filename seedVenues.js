require('dotenv').config();
const mongoose = require('mongoose');
const Venue = require('./models/Venue');

async function seedVenues() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Clear existing venues
    await Venue.deleteMany({});
    
    // Add sample venues
    const venues = [
      {
        name: 'Electric Paradise',
        type: 'Nightclub',
        address: '123 Ocean Drive, Miami Beach',
        coordinates: { lat: 25.7617, lng: -80.1918 },
        capacity: 500,
        currentPrice: 45,
        basePrice: 35,
        availablePasses: 50,
        waitTime: 75,
        inLine: 187,
        status: 'high',
        trending: true,
        isActive: true
      },
      {
        name: 'The Velvet Room',
        type: 'Lounge',
        address: '456 Wynwood Ave, Miami',
        coordinates: { lat: 25.8019, lng: -80.1990 },
        capacity: 200,
        currentPrice: 25,
        basePrice: 20,
        availablePasses: 30,
        waitTime: 35,
        inLine: 62,
        status: 'medium',
        isActive: true
      },
      {
        name: 'Sunset Terrace',
        type: 'Rooftop Bar',
        address: '789 Brickell Ave, Miami',
        coordinates: { lat: 25.7663, lng: -80.1917 },
        capacity: 150,
        currentPrice: 20,
        basePrice: 15,
        availablePasses: 25,
        waitTime: 20,
        inLine: 28,
        status: 'low',
        isActive: true
      }
    ];
    
    await Venue.insertMany(venues);
    console.log('✅ Sample venues added to database!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding venues:', error);
    process.exit(1);
  }
}

seedVenues();
