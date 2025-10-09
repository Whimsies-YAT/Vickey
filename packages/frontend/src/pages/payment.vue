<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
	<div class="payment-page-wrapper">
		<div class="payment-page">
			<div v-if="!paymentData" class="loading-state">
				<MkLoading/>
			</div>

				<div v-else-if="paymentComplete" class="success-state">
					<div class="success-checkmark">
						<svg width="100" height="100" viewBox="0 0 100 100">
							<circle fill="none" stroke="#22c55e" stroke-width="4" cx="50" cy="50" r="46" stroke-linecap="round" transform="rotate(-90 50 50)" class="circle" />
							<polyline fill="none" stroke="#22c55e" stroke-width="5" points="22,53.5 43.5,71 76,34.5" stroke-linecap="round" stroke-linejoin="round" class="tick" />
						</svg>
					</div>
					<h2>{{ i18n.ts._payment.success }}</h2>
					<p>{{ i18n.ts._donation.thankYou }}</p>
					<div class="actions">
						<MkButton primary @click="closeWindow">{{ i18n.ts.close }}</MkButton>
					</div>
				</div>

				<div v-else class="payment-form-container">
					<div class="payment-header">
						<div class="payment-icon">
							<i class="ti ti-credit-card"></i>
						</div>
						<h2>{{ i18n.ts._payment.securePayment }}</h2>
						<div class="payment-amount">
							<span class="currency">$</span>
							<span class="amount">{{ formatAmount(paymentData.amount) }}</span>
						</div>
						<p v-if="paymentData.description" class="description">{{ paymentData.description }}</p>
					</div>

					<div class="payment-methods-section">
						<div class="payment-element-wrapper">
							<div v-if="!paymentElementMounted" class="payment-loading">
								<div class="loading-spinner">
									<i class="ti ti-loader"></i>
								</div>
								<p>{{ i18n.ts._payment.loadingPaymentMethods }}</p>
							</div>
							<div ref="paymentElementRef" class="payment-element"></div>
						</div>
					</div>

					<div v-if="paymentError" class="error-message">
						<i class="ti ti-alert-circle"></i>
						<span>{{ paymentError }}</span>
					</div>

					<div v-if="!paymentData.useCheckout" class="payment-actions">
						<MkButton
							:disabled="!paymentElementMounted || processing || !paymentData"
							primary
							large
							@click="processPayment"
						>
						<i v-if="processing" class="ti ti-loader loading-icon"></i>
							<i v-else class="ti ti-lock"></i>
							{{ processing ? i18n.ts._payment.processing : i18n.tsx._payment.payAmount({ amount: formatAmount(paymentData.amount) }) }}
						</MkButton>
					</div>

					<div class="security-info">
						<i class="ti ti-shield-check"></i>
						<span>{{ i18n.ts._payment.securePaymentNote }}</span>
					</div>
				</div>
		</div>
	</div>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, ref, nextTick } from 'vue';
import { loadStripe } from '@stripe/stripe-js';
import type { Stripe, StripeElements, StripeEmbeddedCheckout } from '@stripe/stripe-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import MkButton from '@/components/MkButton.vue';
import { useRouter } from '@/router.js';
import { definePage } from '@/page.js';

const router = useRouter();

interface PaymentData {
	amount: number;
	currency: string;
	description?: string;
	clientSecret?: string;
	paymentIntentId?: string;
	checkoutSessionId?: string;
	billingDetails: {
		firstName: string;
		lastName: string;
		email: string;
	};
	useCheckout: boolean;
}

const paymentData = ref<PaymentData | null>(null);
const paymentComplete = ref(false);
const paymentError = ref('');
const processing = ref(false);
const paymentElementMounted = ref(false);

const stripe = ref<Stripe | null>(null);
const elements = ref<StripeElements | null>(null);
const paymentElement = ref<any>(null);
const checkoutElement = ref<StripeEmbeddedCheckout | null>(null);
const paymentElementRef = ref<HTMLElement | null>(null);

const formatAmount = (amount: number) => {
	return (amount / 100).toFixed(2);
};

const closeWindow = () => {
	if (window.opener) {
		const messageData = {
			type: 'payment-complete',
			success: paymentComplete.value,
			paymentData: paymentData.value ? {
				amount: paymentData.value.amount,
				currency: paymentData.value.currency,
				description: paymentData.value.description,
				paymentIntentId: paymentData.value.paymentIntentId,
				checkoutSessionId: paymentData.value.checkoutSessionId
			} : null
		};

		console.log('Sending payment result to parent:', messageData);
		console.log('paymentComplete.value:', paymentComplete.value);
		console.log('paymentData.value:', paymentData.value);

		window.opener.postMessage(messageData, '*');
		window.close();
	} else {
		router.push('/');
	}
};

const mountStripeElement = async () => {
	if (!stripe.value || !paymentData.value) {
		console.error('Stripe or payment data not available');
		return;
	}

	try {
		if (paymentData.value.useCheckout && (paymentData.value.checkoutSessionId || paymentData.value.clientSecret)) {
			console.log('Creating embedded checkout with session ID...');

			const clientSecret = paymentData.value.clientSecret;
			if (!clientSecret) {
				console.error('Missing client secret for embedded checkout');
				paymentError.value = 'Missing client secret for embedded checkout';
				paymentElementMounted.value = true;
				return;
			}

			checkoutElement.value = await stripe.value.initEmbeddedCheckout({
				clientSecret: clientSecret,
      });

			await nextTick();
			if (paymentElementRef.value) {
				console.log('Mounting embedded checkout...');
				checkoutElement.value.mount(paymentElementRef.value);
				paymentElementMounted.value = true;
			}
		} else if (paymentData.value.clientSecret) {
			console.log('Creating Stripe elements with client secret...');
			elements.value = stripe.value.elements({
				clientSecret: paymentData.value.clientSecret,
				appearance: {
					theme: 'stripe',
				},
				locale: (localStorage.getItem('lang') || 'en-US').slice(0, 2) as any,
			});

			paymentElement.value = elements.value.create('payment', {
				layout: {
					type: 'tabs',
					defaultCollapsed: false,
				},
				defaultValues: {
					billingDetails: {
						name: `${paymentData.value.billingDetails.firstName} ${paymentData.value.billingDetails.lastName}`.trim(),
						email: paymentData.value.billingDetails.email,
					}
				},
				fields: {
					billingDetails: {
						name: 'auto',
						email: 'auto',
						phone: 'auto',
						address: 'if_required'
					}
				}
			});

			await nextTick();

			if (paymentElementRef.value) {
				console.log('Mounting Stripe payment element...');
				paymentElement.value.mount(paymentElementRef.value);

				paymentElement.value.on('ready', () => {
					console.log('Stripe payment element ready');
					paymentElementMounted.value = true;
				});

				paymentElement.value.on('change', (event: any) => {
					paymentError.value = event.error ? event.error.message : '';
				});
			} else {
				console.error('Payment element ref not available');
				paymentError.value = 'Payment form initialization failed. Please refresh the page.';
				paymentElementMounted.value = true;
			}
		}
	} catch (error) {
		console.error('Error creating/mounting Stripe element:', error);
		paymentError.value = 'Failed to initialize payment form. Please refresh the page.';
		paymentElementMounted.value = true;
	}
};

const initializePayment = async () => {
	try {
		const urlParams = new URLSearchParams(window.location.search);
		const useCheckout = urlParams.get('use_checkout') === 'true';
		const checkoutSessionId = urlParams.get('checkout_session_id');
		const paymentIntentId = urlParams.get('payment_intent_id');
		const clientSecret = urlParams.get('client_secret');
		const paymentStatus = urlParams.get('payment_status');

		const paymentIntent = urlParams.get('payment_intent');
		const redirectStatus = urlParams.get('redirect_status');

		const checkoutComplete = urlParams.get('checkout_complete') === 'true';

		console.log('=== DEBUG URL PARAMS ===');
		console.log('useCheckout:', useCheckout);
		console.log('checkoutSessionId:', checkoutSessionId);
		console.log('checkoutComplete:', checkoutComplete);
		console.log('paymentStatus:', paymentStatus);
		console.log('All URL params:', Array.from(urlParams.entries()));

		// For embedded checkout, we need to check with backend if checkout_complete=true
		// For regular checkout, we can rely on payment_status from Stripe
		const shouldConfirm = useCheckout && checkoutSessionId &&
			(paymentStatus === 'paid' || paymentStatus === 'unpaid' || checkoutComplete);
		console.log('shouldConfirm:', shouldConfirm, 'reason:',
			paymentStatus === 'paid' ? 'paid' :
			paymentStatus === 'unpaid' ? 'unpaid' :
			checkoutComplete ? 'checkout_complete_from_return_url' : 'none');

		if (shouldConfirm) {
			console.log('Checkout session completed successfully');

      let sessionIdToConfirm = checkoutSessionId;

			if (!sessionIdToConfirm && clientSecret && clientSecret.startsWith('cs_')) {
				sessionIdToConfirm = clientSecret;
			}

			if (!sessionIdToConfirm) {
				const allParams = Array.from(urlParams.entries());
				for (const [key, value] of allParams) {
					if (value && value.startsWith('cs_')) {
						sessionIdToConfirm = value;
						break;
					}
				}
			}

			try {
				const confirmResult = await misskeyApi('payment/confirm-intent', {
					checkoutSessionId: sessionIdToConfirm,
				}) as {
					status: string;
					paymentIntentId?: string;
					checkoutSessionId?: string;
					amount: number;
					currency: string;
					description?: string;
				};

				console.log('Payment confirmed with status:', confirmResult.status);

				if (['succeeded', 'processing', 'requires_capture'].includes(confirmResult.status)) {
					paymentData.value = {
						amount: confirmResult.amount,
						currency: confirmResult.currency,
						description: confirmResult.description || 'Payment completed successfully',
						clientSecret: clientSecret || undefined,
						paymentIntentId: confirmResult.paymentIntentId || undefined,
						checkoutSessionId: sessionIdToConfirm || undefined,
						billingDetails: { firstName: '', lastName: '', email: '' },
						useCheckout
					};

					paymentComplete.value = true;
					if (window.opener) {
						window.setTimeout(() => {
							closeWindow();
						}, 3000);
					}
				} else {
					console.warn('Payment not successful in redirect, status:', confirmResult.status);
					paymentError.value = `Payment ${confirmResult.status}. Please try again.`;

					if (window.opener) {
						window.setTimeout(() => {
							closeWindow();
						}, 3000);
					}
					return;
				}
			} catch (error) {
				console.error('Failed to confirm checkout session with backend:', error);
				paymentError.value = 'Failed to confirm payment. Please try again.';
				window.setTimeout(() => closeWindow(), 2000);
				return;
			}

			if (!paymentComplete.value) {
			} else {
				return;
			}
			// if (window.opener) {
			// 	window.setTimeout(() => {
			// 		closeWindow();
			// 	}, 3000);
			// }
			// return;
		}

		if (useCheckout) {
			// For embedded checkout, we'll get the session ID from the URL parameters when opening the payment page
			// If not present, this might be a return from checkout completion
		} else {
			if (!paymentIntentId || !clientSecret) {
				throw new Error('Missing payment intent parameters');
			}
		}

		const config = await misskeyApi('payment/get-config', {}) as { enabled: boolean; publicKey: string | null };

		if (!config.enabled || !config.publicKey) {
			throw new Error('Payment system not available');
		}

		stripe.value = await loadStripe(config.publicKey);
		if (!stripe.value) {
			throw new Error('Failed to load Stripe');
		}

		const amount = parseInt(urlParams.get('amount') || '0');
		const currency = urlParams.get('currency') || 'usd';
		const description = urlParams.get('description') || '';
		const firstName = urlParams.get('first_name') || '';
		const lastName = urlParams.get('last_name') || '';
		const email = urlParams.get('email') || '';

		paymentData.value = {
			amount,
			currency,
			description,
			clientSecret: clientSecret || undefined,
			paymentIntentId: paymentIntentId || undefined,
			checkoutSessionId: checkoutSessionId || undefined,
			billingDetails: { firstName, lastName, email },
			useCheckout
		};

		if (!useCheckout) {
			if (paymentIntent && redirectStatus === 'succeeded') {
				console.log('Returning from successful digital wallet payment');

				try {
					const confirmResult = await misskeyApi('payment/confirm-intent', {
						paymentIntentId: paymentIntent,
					}) as {
						status: string;
						paymentIntentId?: string;
						checkoutSessionId?: string;
						amount: number;
						currency: string;
						description?: string;
					};

					console.log('Payment confirmed with status:', confirmResult.status);

					paymentData.value = {
						amount: confirmResult.amount,
						currency: confirmResult.currency,
						description: confirmResult.description || 'Payment completed successfully',
						clientSecret: clientSecret || undefined,
						paymentIntentId: confirmResult.paymentIntentId || paymentIntent,
						checkoutSessionId: undefined,
						billingDetails: { firstName: '', lastName: '', email: '' },
						useCheckout: false
					};

					paymentComplete.value = true;

					if (window.opener) {
						window.setTimeout(() => {
							closeWindow();
						}, 3000);
					}
				} catch (error) {
					console.error('Failed to confirm digital wallet payment:', error);
					paymentError.value = 'Failed to confirm payment. Please contact support.';
					paymentElementMounted.value = true;
				}
				return;
			}

			if (redirectStatus === 'failed') {
				console.log('Returning from failed digital wallet payment');
				paymentError.value = 'Digital wallet payment was cancelled or failed.';
				paymentElementMounted.value = true;
				return;
			}
		}

		if (!paymentComplete.value) {
			await nextTick();
			await nextTick();

			window.setTimeout(() => {
				mountStripeElement();
			}, 200);
		}
	} catch (error) {
		console.error('Failed to initialize payment:', error);
		paymentError.value = error instanceof Error ? error.message : 'Payment initialization failed';
		paymentElementMounted.value = true;
	}
};

const handleRedirectReturn = async (paymentIntentId: string) => {
	try {
		if (!stripe.value || !paymentData.value) {
			paymentError.value = 'Stripe not initialized';
			return;
		}

		console.log('Handling redirect return for payment intent:', paymentIntentId);

		const { paymentIntent, error } = await stripe.value.retrievePaymentIntent(paymentData.value.clientSecret!);

		if (error) {
			console.error('Error retrieving payment intent:', error);
			paymentError.value = error.message || 'Failed to retrieve payment status';
			return;
		}

		if (!paymentIntent) {
			paymentError.value = 'Payment intent not found';
			return;
		}

		console.log('Payment Intent status:', paymentIntent.status);
		console.log('Payment Intent full object:', paymentIntent);

		if (['succeeded', 'processing', 'requires_capture'].includes(paymentIntent.status)) {
			try {
				const paymentMethodId = typeof paymentIntent.payment_method === 'string'
					? paymentIntent.payment_method
					: paymentIntent.payment_method?.id;

				await misskeyApi('payment/confirm-intent', {
					paymentIntentId: paymentIntent.id,
					paymentMethodId: paymentMethodId,
				});
			} catch (error) {
				console.warn('Failed to confirm payment with backend:', error);
			}

			paymentComplete.value = true;

			if (window.opener) {
				window.setTimeout(() => {
					closeWindow();
				}, 3000);
			}
		} else {
			console.warn('Unexpected payment status after redirect:', paymentIntent.status);
			paymentError.value = `Payment ${paymentIntent.status}. Please check your payment method and try again.`;
		}
	} catch (error) {
		console.error('Error handling redirect return:', error);
		paymentError.value = error instanceof Error ? error.message : 'Failed to process payment redirect';
	}
};

const processPayment = async () => {
	if (!stripe.value || !paymentData.value || !paymentElementMounted.value) {
		paymentError.value = 'Payment form not ready. Please wait or refresh the page.';
		return;
	}

	if (paymentData.value.useCheckout) {
		return;
	}

	if (!elements.value) {
		paymentError.value = 'Payment elements not initialized.';
		return;
	}

	processing.value = true;
	paymentError.value = '';

	try {
		const { error, paymentIntent } = await stripe.value.confirmPayment({
			elements: elements.value,
			redirect: 'if_required',
			confirmParams: {
				return_url: window.location.href,
				payment_method_data: {
					billing_details: {
						name: `${paymentData.value.billingDetails.firstName} ${paymentData.value.billingDetails.lastName}`.trim(),
						email: paymentData.value.billingDetails.email,
					}
				}
			}
		});

		if (error) {
			paymentError.value = error.message || 'Payment failed';
			window.setTimeout(() => closeWindow(), 2000);
		} else if (paymentIntent) {
			console.log('Payment Intent full object:', paymentIntent);
			console.log('Payment Intent status:', paymentIntent.status);
			console.log('Payment method:', paymentIntent.payment_method);

			if (['succeeded', 'processing', 'requires_capture'].includes(paymentIntent.status)) {
				try {
					const paymentMethodId = typeof paymentIntent.payment_method === 'string'
						? paymentIntent.payment_method
						: paymentIntent.payment_method?.id;

					await misskeyApi('payment/confirm-intent', {
						paymentIntentId: paymentIntent.id,
						paymentMethodId: paymentMethodId,
					});
				} catch (error) {
					console.warn('Failed to confirm payment with backend:', error);
				}

				paymentComplete.value = true;

				if (window.opener) {
					window.setTimeout(() => {
						closeWindow();
					}, 3000);
				}
			} else if (paymentIntent.status === 'requires_action') {
				paymentError.value = 'Additional authentication required. Please try again.';
			} else {
				console.warn('Unhandled payment status:', paymentIntent.status);
				paymentError.value = `Payment ${paymentIntent.status}. Please check your payment method and try again.`;
			}
		}
	} catch (error) {
		console.error('Payment processing error:', error);
		paymentError.value = error instanceof Error ? error.message : 'Payment processing failed';
	} finally {
		processing.value = false;
	}
};

onMounted(() => {
	initializePayment();
});

definePage({
	title: i18n.ts._payment.checkoutTitle,
	hideHeader: true,
	hideSidebar: true,
	hideWidgets: true,
	hideFooter: true,
});

onUnmounted(() => {
	if (paymentElement.value) {
		paymentElement.value.unmount();
	}
	if (checkoutElement.value) {
		checkoutElement.value.unmount();
	}
});
</script>

<style lang="scss" scoped>
.payment-page-wrapper {
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background: var(--MI_THEME-bg);
	z-index: 10000;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 20px;
	box-sizing: border-box;
	overflow: hidden;
}

.payment-page {
	max-width: 600px;
	width: 100%;
	max-height: 90vh;
	overflow-y: auto;

	.loading-state {
		text-align: center;
		padding: 60px 0;
	}

	.success-state {
		text-align: center;
		padding: 40px 20px;

		.success-checkmark {
			display: flex;
			justify-content: center;
			margin-bottom: 32px;

			svg {
				width: min(20vw, 120px);
				height: min(20vw, 120px);
				max-width: 120px;
				max-height: 120px;
				min-width: 60px;
				min-height: 60px;

				.circle {
					stroke-dasharray: 289;
					stroke-dashoffset: 289;
					animation: circle 0.5s ease-in-out forwards;
				}

				.tick {
					stroke-dasharray: 80;
					stroke-dashoffset: 80;
					animation: tick 0.4s ease-out 0.475s forwards;
				}
			}

			@keyframes circle {
				from {
					stroke-dashoffset: 289;
				}
				to {
					stroke-dashoffset: 578;
				}
			}

			@keyframes tick {
				from {
					stroke-dashoffset: 80;
				}
				to {
					stroke-dashoffset: 0;
				}
			}
		}

		h2 {
			font-size: 28px;
			font-weight: 700;
			margin: 0 0 12px 0;
			color: var(--MI_THEME-fg);
		}

		p {
			font-size: 16px;
			color: var(--MI_THEME-fgMuted);
			margin: 0 0 32px 0;
		}

		.payment-summary {
			background: var(--MI_THEME-panel);
			border: 1px solid var(--MI_THEME-divider);
			border-radius: 12px;
			padding: 24px;
			margin-bottom: 32px;
			text-align: left;

			.summary-item {
				display: flex;
				justify-content: space-between;
				align-items: center;
				padding: 12px 0;
				border-bottom: 1px solid var(--MI_THEME-divider);

				&:last-child {
					border-bottom: none;
				}

				.label {
					font-weight: 500;
					color: var(--MI_THEME-fgMuted);
				}

				.value {
					font-weight: 600;
					color: var(--MI_THEME-fg);
					font-family: monospace;
				}
			}
		}

		.actions {
			display: flex;
			justify-content: center;
		}
	}

	.payment-form-container {
		background: var(--MI_THEME-panel);
		border-radius: 16px;
		border: 1px solid var(--MI_THEME-divider);
		overflow: hidden;

		.payment-header {
			text-align: center;
			padding: 40px 32px 32px;
			background: var(--MI_THEME-accentedBg);

			.payment-icon {
				font-size: 48px;
				color: var(--MI_THEME-accent);
				margin-bottom: 16px;
			}

			h2 {
				font-size: 24px;
				font-weight: 600;
				margin: 0 0 16px 0;
				color: var(--MI_THEME-fg);
			}

			.payment-amount {
				font-size: 36px;
				font-weight: 700;
				color: var(--MI_THEME-accent);
				margin-bottom: 8px;

				.currency {
					font-size: 24px;
					opacity: 0.8;
				}
			}

			.description {
				font-size: 14px;
				color: var(--MI_THEME-fgMuted);
				margin: 0 auto;
				max-width: 300px;
				line-height: 1.4;
			}
		}

		.payment-methods-section {
			padding: 32px;

			.payment-element-wrapper {
				border: 1px solid var(--MI_THEME-divider);
				border-radius: 8px;
				background: var(--MI_THEME-bg);
				position: relative;
				min-height: 200px;

				.payment-loading {
					display: flex;
					flex-direction: column;
					align-items: center;
					justify-content: center;
					padding: 40px 20px;
					color: var(--MI_THEME-fgMuted);
					position: absolute;
					top: 0;
					left: 0;
					right: 0;
					bottom: 0;
					background: var(--MI_THEME-bg);
					z-index: 1;

					.loading-spinner {
						font-size: 32px;
						margin-bottom: 16px;

						i {
							animation: spin 1s linear infinite;
						}

						@keyframes spin {
							0% { transform: rotate(0deg); }
							100% { transform: rotate(360deg); }
						}
					}

					p {
						margin: 0;
						font-size: 14px;
					}
				}

				.payment-element {
					padding: 16px;
					min-height: 200px;
					width: 100%;
					box-sizing: border-box;
				}
			}
		}

		.error-message {
			margin: 0 32px 24px;
			padding: 16px;
			background: var(--MI_THEME-errorBg);
			color: var(--MI_THEME-error);
			border-radius: 8px;
			display: flex;
			align-items: center;
			gap: 12px;
			font-size: 14px;

			i {
				font-size: 18px;
				flex-shrink: 0;
			}
		}

		.payment-actions {
			padding: 0 32px 24px;

			.loading-icon {
				animation: spin 1s linear infinite;
			}

			@keyframes spin {
				0% { transform: rotate(0deg); }
				100% { transform: rotate(360deg); }
			}
		}

		.security-info {
			padding: 24px 32px 32px;
			text-align: center;
			font-size: 14px;
			color: var(--MI_THEME-fgMuted);
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 8px;
			border-top: 1px solid var(--MI_THEME-divider);
			background: var(--MI_THEME-bg);

			i {
				color: var(--MI_THEME-success);
				font-size: 16px;
			}
		}
	}
}

@media (max-width: 600px) {
	.payment-page {
		margin: 0 16px;

		.payment-form-container .payment-header {
			padding: 32px 24px 24px;

			.payment-amount {
				font-size: 28px;
			}
		}

		.payment-form-container .payment-methods-section,
		.payment-form-container .payment-actions {
			padding-left: 24px;
			padding-right: 24px;
		}
	}
}
</style>
