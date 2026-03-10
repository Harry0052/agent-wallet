"use client";

import { FormEvent, useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import type { SavedPaymentMethod } from "@/lib/types";
import { confirmFundingSetupIntent } from "@/services/funding";

interface StripeSetupFormProps {
  clientSecret: string;
  publishableKey: string;
  onSaved: (method: SavedPaymentMethod) => void | Promise<void>;
  onCancel: () => void;
}

interface StripeSetupFormInnerProps {
  onSaved: (method: SavedPaymentMethod) => void | Promise<void>;
  onCancel: () => void;
}

function StripeSetupFormInner({ onSaved, onCancel }: StripeSetupFormInnerProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stripe || !elements) return;

    setIsSubmitting(true);
    setError(null);

    const result = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
      confirmParams: {
        return_url: `${window.location.origin}/wallet?funding_setup=return`,
      },
    });

    if (result.error) {
      setError(result.error.message || "Payment setup failed.");
      setIsSubmitting(false);
      return;
    }

    const setupIntent = result.setupIntent;
    if (!setupIntent) {
      setError("Payment setup is not complete yet.");
      setIsSubmitting(false);
      return;
    }

    if (setupIntent.status === "succeeded") {
      try {
        const method = await confirmFundingSetupIntent(setupIntent.id);
        await onSaved(method);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Failed to save payment method.");
        setIsSubmitting(false);
      }
      return;
    }

    if (setupIntent.status === "processing") {
      setError("Payment is processing. Check again in a moment.");
      setIsSubmitting(false);
      return;
    }

    setError("Payment needs verification. Complete verification to continue.");
    setIsSubmitting(false);
  };

  return (
    <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
      <PaymentElement options={{ layout: "tabs" }} />

      {error ? (
        <p className="text-xs text-[var(--aw-danger)]">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="aw-button-primary h-9 px-3 text-xs"
          disabled={!stripe || !elements || isSubmitting}
        >
          {isSubmitting ? "Saving..." : "Save payment method"}
        </button>
        <button
          type="button"
          className="aw-button-secondary h-9 px-3 text-xs"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function StripeSetupForm(props: StripeSetupFormProps) {
  const stripePromise = useMemo(
    () => loadStripe(props.publishableKey),
    [props.publishableKey],
  );

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: props.clientSecret,
        appearance: {
          theme: "stripe",
        },
      }}
    >
      <StripeSetupFormInner onSaved={props.onSaved} onCancel={props.onCancel} />
    </Elements>
  );
}
