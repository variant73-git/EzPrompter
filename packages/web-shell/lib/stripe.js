import Stripe from 'stripe';

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY env var missing.');
  _stripe = new Stripe(key);
  return _stripe;
}

export const stripe = new Proxy(function () {}, {
  get(_t, prop) { return getStripe()[prop]; }
});

export const PLANS = {
  free: { captures: 5, name: 'Free' },
  pro: { captures: -1, name: 'Pro' },
};

export async function createCheckoutSession(userId, email) {
  return getStripe().checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Uncraft Pro',
            description: 'Unlimited captures per month',
          },
          unit_amount: 700,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      },
    ],
    metadata: { userId: String(userId) },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/canvas?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/canvas`,
  });
}
