import React, { useState } from 'react';
import Modal from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { cn } from '~/utils';
import { redirectToCheckout } from '~/utils/stripe';
import { useAuthContext } from '~/hooks/AuthContext';
import { useToastContext } from '~/Providers';
import { NotificationSeverity } from '~/common';
import { Spinner } from '~/components/svg';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  currentPlan?: string;
}

const tokenPackages = [
  { tokens: 1000, price: '$5', stripePriceId: 'price_1QI91uJiXhdbiMBd69zBvyuK' },
  { tokens: 5000, price: '$20', stripePriceId: 'price_1QI93LJiXhdbiMBdfJRIGcqf' },
  { tokens: 10000, price: '$35', stripePriceId: 'price_1QI93zJiXhdbiMBd433vBc4J' },
];

const plans = [
  {
    name: 'Plus',
    description: 'Essential AI tools for everyday use',
    price: '$10',
    stripePriceId: 'price_1PxUbbJiXhdbiMBd58hxC5HI',
    features: [
      '1,000 AI-powered messages',
      '30 image generations',
      'Access to all AI models',
      'Email support',
      'AI prompt library access',
    ],
    popular: false,
  },
  {
    name: 'Pro',
    description: 'Advanced features for serious AI enthusiasts',
    price: '$20',
    stripePriceId: 'price_1PxUc4JiXhdbiMBdrCSsnxqY',
    features: [
      '5,000 AI-powered messages',
      '100 image generations',
      'Access to all AI models',
      'Priority support',
      'AI prompt library access',
    ],
    popular: true,
  },
  {
    name: 'Enterprise',
    description: 'Unlimited potential for power users',
    price: '$100',
    stripePriceId: 'price_1PxUchJiXhdbiMBdnQFAuUrf',
    features: [
      '10,000 AI-powered messages',
      '300 image generations',
      'Early access to new features',
      '24/7 priority support',
      'Access to all AI models',
      'AI prompt library access',
    ],
    popular: false,
  },
];

export const api = async (url: string, options: RequestInit & { body?: Record<string, unknown> }) => {
  const { body, headers, ...opts } = options;
  const requestBody = body ? JSON.stringify(body) : undefined;
  const response = await fetch(url, {
    body: requestBody,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    ...opts,
  });
  const result = await response.json();
  return { status: response.status, ...result, url };
};

const PricingModal: React.FC<PricingModalProps> = ({ isOpen, onClose, userId, currentPlan }) => {
  const { token } = useAuthContext();
  const { showToast } = useToastContext();
  const [loadingPriceId, setLoadingPriceId] = useState<string | null>(null);

  const handleUpgrade = async (priceId: string, planName: string) => {
    try {
      setLoadingPriceId(priceId);

      // If user is on Enterprise plan, handle token purchase
      if (currentPlan === 'enterprise') {
        const response = await fetch('/api/stripe/upgrade', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ userId, priceId, type: 'token' }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error as string || 'An error occurred');
        }

        await redirectToCheckout(data.sessionId);
      }
      // If user is on free plan, redirect to checkout
      else if (currentPlan == null || currentPlan === 'free') {
        const response = await fetch('/api/stripe/upgrade', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ userId, priceId, type: 'subscription' }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error as string || 'An error occurred');
        }

        await redirectToCheckout(data.sessionId);
      }
      // Handle plan upgrade for paid plans
      else {
        const response = await fetch('/api/stripe/change-plan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ userId, newPriceId: priceId }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error as string || 'An error occurred');
        }

        showToast({
          message: `Successfully upgraded to ${planName}!`,
        });
        onClose();
      }
    } catch (error) {
      console.error('Error:', error);
      showToast({
        message: 'Failed to process upgrade. Please try again.',
        severity: NotificationSeverity.ERROR,
      });
      onClose();
    } finally {
      setLoadingPriceId(null);
    }
  };

  const getAvailablePlans = () => {
    if (currentPlan === 'enterprise') {
      return (
        <div className="space-y-6">
          <p className="text-center text-gray-600 mb-8">
            Purchase additional tokens for your Enterprise plan
          </p>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {tokenPackages.map((pkg) => (
              <div
                key={pkg.tokens}
                className="flex flex-col rounded-lg border border-gray-200 p-6 bg-white"
              >
                <h3 className="text-xl font-semibold">{pkg.tokens} Tokens</h3>
                <p className="mt-4 text-3xl font-bold">
                  {pkg.price}
                </p>
                <Button
                  className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => handleUpgrade(pkg.stripePriceId, `${pkg.tokens} Tokens`)}
                  disabled={loadingPriceId !== null}
                >
                  {loadingPriceId === pkg.stripePriceId ? (
                    <div className="flex items-center justify-center">
                      <Spinner className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </div>
                  ) : (
                    'Purchase Tokens'
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Filter plans based on current plan
    const currentPlanIndex = plans.findIndex(p => p.name.toLowerCase() === currentPlan);
    const availablePlans = plans.slice(currentPlanIndex + 1);

    return (
      <div className="space-y-6">
        <p className="text-center text-gray-600 mb-8">
          Access ChatGPT, Claude, Perplexity, Stable Diffusion, and more - all-in-one.
        </p>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {availablePlans.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                'flex flex-col rounded-lg border p-6',
                plan.popular ? 'border-blue-500 shadow-md relative' : 'border-gray-200',
                'bg-white',
              )}
            >
              {plan.popular && (
                <div className="absolute top-0 right-0 -mt-3 -mr-3 px-3 py-1 bg-blue-500 text-white text-xs font-semibold rounded-full">
                  MOST POPULAR
                </div>
              )}
              <h3 className="text-xl font-semibold">{plan.name}</h3>
              <p className="mt-2 text-sm text-gray-600">{plan.description}</p>
              <p className="mt-4 text-3xl font-bold">
                {plan.price}<span className="text-base font-normal text-gray-600">/month</span>
              </p>
              <Button
                className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => handleUpgrade(plan.stripePriceId, plan.name)}
                disabled={loadingPriceId !== null}
              >
                {loadingPriceId === plan.stripePriceId ? (
                  <div className="flex items-center justify-center">
                    <Spinner className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </div>
                ) : (
                  `Upgrade to ${plan.name}`
                )}
              </Button>
              <ul className="mt-6 space-y-3">
                {plan.features.map((feature, index) => (
                  <li key={index} className="flex items-center text-sm text-gray-600">
                    <svg
                      className="mr-3 h-5 w-5 text-green-500"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M5 13l4 4L19 7"></path>
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="10+ AI models for the price of one!" className="sm:max-w-[800px]">
      {getAvailablePlans()}
    </Modal>
  );
};

export default PricingModal;