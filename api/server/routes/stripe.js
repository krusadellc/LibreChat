const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { logger } = require('~/config');
const { upgradeSubscription, changePlan, handleSubscriptionUpdated, purchaseTokens, handleTokenPurchase, deletePlan } = require('../services/SubscriptionService');

router.post('/upgrade', async (req, res) => {
  const { userId, priceId, type } = req.body;

  try {
    let session;
    if (type === 'token') {
      session = await purchaseTokens(userId, priceId);
    } else {
      session = await upgradeSubscription(userId, priceId);
    }
    res.json({ sessionId: session.id });
  } catch (error) {
    logger.error('[/upgrade] Error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

router.post('/cancel', async (req, res) => {
  const { userId } = req.body;
  try {
    await deletePlan(userId);
    res.json({ success: true });
  } catch (error) {
    logger.error('[/change-plan] Error:', error);
    res.status(500).json({ error: 'Failed to change plan' });
  }
});

router.post('/change-plan', async (req, res) => {
  const { userId, newPriceId } = req.body;

  try {
    await changePlan(userId, newPriceId);
    res.json({ success: true });
  } catch (error) {
    logger.error('[/change-plan] Error:', error);
    res.status(500).json({ error: 'Failed to change plan' });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    logger.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // Check if this is a token purchase
        if (session.metadata?.type === 'token_purchase') {
          await handleTokenPurchase(session);
        } else {
          // Handle regular subscription creation
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          await handleSubscriptionUpdated({
            ...subscription,
            metadata: {
              userId: session.client_reference_id,
              context: 'initial',
            },
          });
        }
        break;
      }

      case 'customer.subscription.deleted':
        // Handle subscription cancellation
        await handleSubscriptionUpdated({
          ...event.data.object,
          status: 'canceled',
        });
        break;

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);

        if (invoice.billing_reason === 'subscription_cycle') {
          // Handle regular renewal
          await handleSubscriptionUpdated({
            ...subscription,
            metadata: {
              userId: subscription.metadata.userId,
              context: 'renewal',
            },
          });
        } else if (invoice.billing_reason === 'subscription_update') {
          // Handle immediate plan change
          await handleSubscriptionUpdated({
            ...subscription,
            metadata: {
              userId: subscription.metadata.userId,
              context: 'update',
            },
          });
        }
        break;
      }

      default:
        logger.info(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('[webhook] Error processing event:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

module.exports = router;