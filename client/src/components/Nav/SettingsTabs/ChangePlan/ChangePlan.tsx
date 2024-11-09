import React, { useState } from 'react';
import { useRecoilValue } from 'recoil';
import { Label, Button, OGDialog, OGDialogTrigger, Spinner } from '~/components';
import { useCancelSubscriptionMutation } from 'librechat-data-provider/react-query';
import { useToastContext } from '~/Providers';
import { NotificationSeverity } from '~/common';
import OGDialogTemplate from '~/components/ui/OGDialogTemplate';
import store from '~/store';

export default function ChangePlan() {
  const [open, setOpen] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
  const user = useRecoilValue(store.user);
  const cancelMutation = useCancelSubscriptionMutation();
  const { showToast } = useToastContext();

  const formatExpiryDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const cancelMembership = async () => {
    if ((user?.id) == null) {return;}

    try {
      await cancelMutation.mutateAsync(user.id);
      setIsCancelled(true);
      showToast({
        message: 'Your membership has been successfully cancelled.',
        severity: NotificationSeverity.SUCCESS,
      });
      setOpen(false);
    } catch (error) {
      console.error('Failed to cancel subscription:', error);
      showToast({
        message: 'Failed to cancel subscription. Please try again.',
        severity: NotificationSeverity.ERROR,
      });
    }
  };

  const isFreePlan = user?.subscription === null || user?.subscription === 'free';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="font-light">{isFreePlan ? 'You\'re currently on the free plan' : 'Cancel your membership'}</Label>
          <OGDialog open={open} onOpenChange={setOpen}>
            <OGDialogTrigger asChild>
              <Button
                variant="destructive"
                className="flex items-center justify-center rounded-lg transition-colors duration-200"
                onClick={() => setOpen(true)}
                disabled={isFreePlan || isCancelled}
                title={isFreePlan ? 'You\'re currently on the free plan' : 'Cancel your paid subscription'}
              >
              Cancel Membership
              </Button>
            </OGDialogTrigger>
            <OGDialogTemplate
              showCloseButton={false}
              title="Cancel Membership"
              className="max-w-[450px]"
              main={
                <div className="flex flex-col gap-2">
                  <Label className="text-left text-sm font-medium">
                  Are you sure you want to cancel your membership?
                  </Label>
                  <Label className="text-left text-sm text-gray-600 dark:text-gray-300">
                  Your subscription and tokens will remain active until the end of your current billing period.
                  </Label>
                </div>
              }
              selection={{
                selectHandler: cancelMembership,
                selectClasses:
                'bg-destructive text-white transition-all duration-200 hover:bg-destructive/80',
                selectText: cancelMutation.isLoading as boolean ? <Spinner /> : 'Cancel Membership',
              }}
            />
          </OGDialog>
        </div>
        {isCancelled && user && user.subscriptionExpiresAt !== undefined && (
          <Label className="text-left text-sm font-medium text-gray-600 dark:text-gray-300">
            Your balance will expire on {formatExpiryDate(user.subscriptionExpiresAt.toString())}
          </Label>
        )}
      </div>
    </div>
  );
}