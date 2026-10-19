const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY?.trim());

async function createPaymentIntent(amount, email, venueConnectId = null) {
  const paymentData = {
    amount,
    currency: 'usd',
    receipt_email: email,
    metadata: { platform: 'lightning-pass' }
  };

  // If venue has Stripe Connect, automatically split payment
  if (venueConnectId) {
    const platformFee = Math.round(amount * 0.15); // 15% platform fee
    paymentData.application_fee_amount = platformFee;
    paymentData.transfer_data = {
      destination: venueConnectId  // 85% goes directly to venue
    };
  }

  return await stripe.paymentIntents.create(paymentData);
}

// NEW: Update payment intent with metadata
async function updatePaymentIntent(paymentIntentId, updates) {
  return await stripe.paymentIntents.update(paymentIntentId, updates);
}

// NEW: Retrieve payment intent
async function retrievePaymentIntent(paymentIntentId) {
  return await stripe.paymentIntents.retrieve(paymentIntentId);
}

// NEW: Confirm payment intent (for test mode auto-confirmation)
async function confirmPaymentIntent(paymentIntentId, paymentMethod) {
  return await stripe.paymentIntents.confirm(paymentIntentId, {
    payment_method: paymentMethod
  });
}

async function createCustomer(email, phone) {
  return await stripe.customers.create({ email, phone });
}

async function processRefund(chargeId) {
  return await stripe.refunds.create({ payment_intent: chargeId });
}

// Create refund with proper destination charge handling
async function createRefund(paymentIntentId, amount = null, reason = 'requested_by_customer') {
  const refundData = {
    payment_intent: paymentIntentId,
    reason: reason,
    refund_application_fee: false,  // Platform keeps 15% fee, customer gets 85% back
    reverse_transfer: true  // Pull refund from venue's connected Stripe account
  };

  // If amount specified, refund partial amount (otherwise full refund)
  if (amount) {
    refundData.amount = Math.round(amount * 100);
  }

  return await stripe.refunds.create(refundData);
}

// NEW: Get Stripe Connect account status
async function getConnectAccountStatus(accountId) {
  return await stripe.accounts.retrieve(accountId);
}

// STRIPE CONNECT & PAYOUT FUNCTIONS
async function createConnectAccount(email, businessName) {
  return await stripe.accounts.create({
    type: 'express',
    country: 'US',
    email,
    business_type: 'company',
    company: { name: businessName },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    }
  });
}

async function createConnectAccountLink(accountId, refreshUrl, returnUrl) {
  return await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding'
  });
}

async function createPayout(connectAccountId, amount) {
  return await stripe.transfers.create({
    amount: Math.round(amount * 100),
    currency: 'usd',
    destination: connectAccountId,
    description: 'End of night payout - Lightning Pass'
  });
}

module.exports = {
  createPaymentIntent,
  updatePaymentIntent,
  retrievePaymentIntent,
  confirmPaymentIntent,
  createCustomer,
  processRefund,
  createRefund,
  getConnectAccountStatus,
  createConnectAccount,
  createConnectAccountLink,
  createPayout,
  webhooks: stripe.webhooks  // Export for webhook verification
};
