const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { updateUser, getUserById } = require('~/models/userMethods');
const { Transaction } = require('~/models/Transaction');
const Balance = require('~/models/Balance');
const { logger } = require('~/config');

const TOKENS_PER_PLAN = {
  'price_1PxUbbJiXhdbiMBd58hxC5HI': 1000,  // Plus
  'price_1PxUc4JiXhdbiMBdrCSsnxqY': 5000,  // Pro
  'price_1PxUchJiXhdbiMBdnQFAuUrf': 10000, // Enterprise
};

const TOKEN_PACKAGES = {
  'price_1QI91uJiXhdbiMBd69zBvyuK': 1000,
  'price_1QI93LJiXhdbiMBdfJRIGcqf': 5000,
  'price_1QI93zJiXhdbiMBd433vBc4J': 10000,
};

const upgradeSubscription = async (userId, planId) => {
  try {
    const user = await getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (!user.stripeCustomerId) {
      const stripeCustomer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: user._id.toString(),
        },
      });
      user.stripeCustomerId = stripeCustomer.id;
      await updateUser(user._id, { stripeCustomerId: stripeCustomer.id });
    }

    const session = await stripe.checkout.sessions.create({
      customer: user.stripeCustomerId,
      client_reference_id: user._id.toString(),
      payment_method_types: ['card'],
      line_items: [
        {
          price: planId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      subscription_data: {
        metadata: {
          userId: user._id.toString(),
        },
      },
      success_url: `${process.env.DOMAIN_CLIENT}/c/new`,
      cancel_url: `${process.env.DOMAIN_CLIENT}/c/new`,
    });

    return session;
  } catch (error) {
    logger.error('[upgradeSubscription] Error:', error);
    throw error;
  }
};

async function changePlan(userId, newPriceId) {
  const user = await getUserById(userId);
  if (!user || !user.stripeCustomerId) {
    throw new Error('User not found or no subscription exists');
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: user.stripeCustomerId,
    status: 'active',
    limit: 1,
  });

  if (!subscriptions.data.length) {
    throw new Error('No active subscription found');
  }

  const subscription = subscriptions.data[0];

  // Schedule the update for the next billing cycle
  await stripe.subscriptions.update(subscription.id, {
    proration_behavior: 'always_invoice',
    items: [{
      id: subscription.items.data[0].id,
      price: newPriceId,
    }],
  });
}

async function deletePlan(userId) {
  const user = await getUserById(userId);
  if (!user || !user.stripeCustomerId) {
    throw new Error('User not found or no subscription exists');
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: user.stripeCustomerId,
    status: 'active',
    limit: 1,
  });

  if (!subscriptions.data.length) {
    throw new Error('No active subscription found');
  }

  const subscription = subscriptions.data[0];

  // Schedule the update for the next billing cycle
  await stripe.subscriptions.update(subscription.id, {
    cancel_at_period_end: true,
    metadata: {
      userId,
      context: 'canceled',
    },
  });
}

async function purchaseTokens(userId, priceId) {
  const user = await getUserById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const tokenAmount = TOKEN_PACKAGES[priceId];
  if (!tokenAmount) {
    throw new Error('Invalid token package');
  }

  return stripe.checkout.sessions.create({
    customer: user.stripeCustomerId,
    client_reference_id: userId,
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [{
      price: priceId,
      quantity: 1,
    }],
    metadata: {
      type: 'token_purchase',
      tokenAmount,
    },
    success_url: `${process.env.DOMAIN_CLIENT}/c/new`,
    cancel_url: `${process.env.DOMAIN_CLIENT}/c/new`,
  });
}

async function handleTokenPurchase(session) {
  try {
    const tokenAmount = parseInt(session.metadata.tokenAmount);
    const userId = session.client_reference_id;

    // Get current balance
    const currentBalance = await Balance.findOne({ user: userId }).lean();
    const previousBalance = currentBalance?.tokenCredits || 0;
    const newBalance = previousBalance + tokenAmount;

    // Create transaction record
    await Transaction.create({
      user: userId,
      tokenType: 'credits',
      context: 'token_purchase',
      rawAmount: tokenAmount,
      metadata: {
        source: 'token_purchase',
        previousBalance,
        newBalance,
      },
    });

    // Update Balance collection
    await Balance.findOneAndUpdate(
      { user: userId },
      { $set: { tokenCredits: newBalance } },
      { upsert: true, new: true },
    );

    // Update user's token balance
    await updateUser(userId, { tokenBalance: newBalance });

    logger.info(`[handleTokenPurchase] Token purchase completed for user ${userId}`, {
      tokenAmount,
      previousBalance,
      newBalance,
    });
  } catch (error) {
    logger.error('[handleTokenPurchase] Error:', error);
    throw error;
  }
}

async function handleSubscriptionUpdated(subscription) {
  try {
    const { userId, context } = subscription.metadata;
    const user = await getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const subscriptionItem = subscription.items.data[0];
    const productId = subscriptionItem.price.product;
    const product = await stripe.products.retrieve(productId);
    const planName = product.name.toLowerCase();
    const priceId = subscriptionItem.price.id;

    const updatedData = {
      subscription: subscription.status === 'canceled' ? 'free' : planName,
      subscriptionStatus: subscription.status,
      subscriptionExpiresAt: new Date(subscription.current_period_end * 1000),
    };

    // Get current balance
    const currentBalance = await Balance.findOne({ user: userId }).lean();
    const previousBalance = currentBalance?.tokenCredits || 0;
    let tokenAmount = 0;
    let tokenDifference = 0;

    switch (context) {
      case 'initial':
        tokenAmount = TOKENS_PER_PLAN[priceId];
        // Create transaction record
        await Transaction.create({
          user: userId,
          tokenType: 'credits',
          context: 'subscription',
          rawAmount: tokenAmount,
          metadata: {
            source: 'subscription',
            planType: planName,
            previousBalance,
          },
        });
        break;

      case 'renewal':
        tokenAmount = TOKENS_PER_PLAN[priceId];
        // Create transaction record for renewal
        await Transaction.create({
          user: userId,
          tokenType: 'credits',
          context: 'subscription_renewal',
          rawAmount: tokenAmount,
          metadata: {
            source: 'subscription_renewal',
            planType: planName,
            previousBalance,
          },
        });
        break;

      case 'update': {
        const currentPlanTokens = TOKENS_PER_PLAN[user.subscription] || 0;
        const newPlanTokens = TOKENS_PER_PLAN[priceId] || 0;
        tokenDifference = newPlanTokens - currentPlanTokens;
        tokenAmount = previousBalance + tokenDifference;

        // Create transaction record for update
        if (tokenDifference !== 0) {
          await Transaction.create({
            user: userId,
            tokenType: 'credits',
            context: 'subscription_update',
            rawAmount: tokenDifference,
            metadata: {
              source: 'subscription_update',
              planType: planName,
              previousBalance,
            },
          });
        }
        break;
      }

      case 'canceled':
        tokenAmount = 0;
        break;
    }

    // Update Balance collection
    await Balance.findOneAndUpdate(
      { user: userId },
      { $set: { tokenCredits: tokenAmount } },
      { upsert: true, new: true },
    );

    // Update user's token balance field
    updatedData.tokenBalance = tokenAmount;

    await updateUser(user._id, updatedData);

    logger.info(`[handleSubscriptionUpdated] Successfully handled ${context} for user ${userId}`, {
      subscription: planName,
      previousBalance,
      newBalance: tokenAmount,
      tokenDifference: context === 'update' ? tokenDifference : undefined,
      status: subscription.status,
      context,
    });
  } catch (error) {
    logger.error('[handleSubscriptionUpdated] Error:', error);
    throw error;
  }
}

module.exports = {
  upgradeSubscription,
  changePlan,
  purchaseTokens,
  handleSubscriptionUpdated,
  handleTokenPurchase,
  deletePlan,
};