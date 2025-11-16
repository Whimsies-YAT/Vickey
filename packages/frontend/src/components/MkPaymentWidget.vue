<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="payment-widget">
	<div v-if="!paymentEnabled" class="disabled">
		<i class="ti ti-credit-card-off"></i>
		<p>{{ i18n.ts._payment.disabled }}</p>
	</div>
	<div v-else-if="loading" class="loading">
		<MkLoading />
	</div>
	<div v-else class="content">
		<div class="header">
			<i class="ti ti-credit-card"></i>
			<h3>{{ i18n.ts._payment.title }}</h3>
		</div>

		<form @submit.prevent="processPayment">
			<div class="amount-section">
				<label>{{ i18n.ts._payment.amount }}</label>
				<MkInput
					v-model="amount"
					type="number"
					:min="1"
					:placeholder="i18n.ts._payment.enterAmount"
					required
				/>
			</div>

			<div class="description-section">
				<label>{{ i18n.ts._payment.description }}</label>
				<MkInput
					v-model="description"
					:placeholder="i18n.ts._payment.descriptionPlaceholder"
				/>
			</div>

			<div class="billing-info-section">
				<h4>{{ i18n.ts._payment.billingInformation }}</h4>
				<div class="billing-row">
					<MkInput
						v-model="billingInfo.firstName"
						:placeholder="i18n.ts._payment.firstName"
						required
					/>
					<MkInput
						v-model="billingInfo.lastName"
						:placeholder="i18n.ts._payment.lastName"
						required
					/>
				</div>
				<br/>
				<MkInput
					v-model="billingInfo.email"
					type="email"
					:placeholder="i18n.ts._payment.email"
					required
				/>
				<div class="privacy-note">
					<i class="ti ti-info-circle"></i>
					<span>{{ i18n.ts._payment.billingPrivacyNote }}</span>
				</div>
			</div>

			<div v-if="showSubscriptionOptions" class="subscription-section">
				<MkSwitch v-model="isSubscription">
					{{ i18n.ts._payment.subscription }}
				</MkSwitch>

				<div v-if="isSubscription" class="subscription-options">
					<MkSelect v-model="selectedPlan" :items="subscriptionPlanItems">
						<template #label>{{ i18n.ts._payment.subscriptionPlan }}</template>
					</MkSelect>
				</div>
			</div>

			<div class="payment-method-section">
				<label>{{ i18n.ts._payment.paymentMethod }}</label>
				<div v-if="showSubscriptionOptions && isSubscription" id="card-element" ref="cardElementRef" class="card-element"></div>
				<div v-else class="payment-element">
					<div class="payment-placeholder">
						<i class="ti ti-credit-card"></i>
						<p>{{ i18n.ts._payment.paymentOptionsPlaceholder }}</p>
						<small>{{ i18n.ts._payment.multiplePaymentMethods }}</small>
					</div>
				</div>
				<div v-if="paymentError" class="error">{{ paymentError }}</div>
			</div>

			<div class="actions">
				<MkButton
					:disabled="processing"
					type="submit"
					primary
				>
					<i v-if="processing" class="ti ti-loader"></i>
					<i v-else class="ti ti-credit-card"></i>
					{{ processing ? i18n.ts._payment.processing : (isSubscription ? i18n.ts._payment.subscribe : i18n.ts._payment.payNow) }}
				</MkButton>
			</div>
		</form>

		<div v-if="paymentSuccess" class="success">
			<i class="ti ti-check"></i>
			<p>{{ i18n.ts._payment.success }}</p>
		</div>

		<div v-if="paymentError" class="error">
			<i class="ti ti-x"></i>
			<p>{{ paymentError }}</p>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, onMounted, computed, watch, nextTick } from 'vue';
import { loadStripe } from '@stripe/stripe-js';
import type { Stripe, StripeElements, StripeCardElement } from '@stripe/stripe-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkButton from '@/components/MkButton.vue';
import MkSwitch from '@/components/MkSwitch.vue';

interface Props {
	showSubscriptionOptions?: boolean;
	defaultAmount?: number;
	defaultCurrency?: string;
	defaultDescription?: string;
	subscriptionPlans?: Array<{ value: string, text: string }>;
	useCheckout?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	showSubscriptionOptions: false,
	defaultAmount: 10,
	defaultDescription: '',
	subscriptionPlans: () => [],
	useCheckout: false
});

const emit = defineEmits<{
	success: [paymentData: any];
	error: [error: string];
}>();

const loading = ref(true);
const processing = ref(false);
const paymentEnabled = ref(false);
const paymentSuccess = ref(false);
const paymentError = ref('');
const cardError = ref('');

const amount = ref(props.defaultAmount);

watch(() => props.defaultAmount, (newAmount) => {
	if (newAmount) {
		amount.value = newAmount;
	}
});

const description = ref(props.defaultDescription);

watch(() => props.defaultDescription, (newDescription) => {
	if (newDescription) {
		description.value = newDescription;
	}
});
const isSubscription = ref(false);
const selectedPlan = ref('');

watch(isSubscription, async (newValue) => {
	if (newValue && props.showSubscriptionOptions) {
		await nextTick();
		if (cardElementRef.value && cardElement.value) {
			try {
				cardElement.value.mount(cardElementRef.value);
			} catch (error) {
				try {
					cardElement.value.unmount();
					await nextTick();
					cardElement.value.mount(cardElementRef.value);
				} catch (remountError) {
					console.warn('Failed to remount card element:', remountError);
				}
			}
		}
	}
});

const billingInfo = ref({
	firstName: '',
	lastName: '',
	email: ''
});

const stripe = ref<Stripe | null>(null);
const elements = ref<StripeElements | null>(null);
const cardElement = ref<StripeCardElement | null>(null);
const cardElementRef = ref<HTMLElement | null>(null);

const subscriptionPlanItems = computed(() =>
	props.subscriptionPlans.map(plan => ({
		value: plan.value,
		label: plan.text
	}))
);

const initializeStripe = async () => {
	try {
		const config = await misskeyApi('payment/get-config', {}) as { enabled: boolean; publicKey: string | null };

		if (!config.enabled || !config.publicKey) {
			paymentEnabled.value = false;
			loading.value = false;
			return;
		}

		paymentEnabled.value = true;

		stripe.value = await loadStripe(config.publicKey);

		if (!stripe.value) {
			throw new Error('Failed to load Stripe');
		}

		elements.value = stripe.value.elements();
		cardElement.value = elements.value.create('card', {
			style: {
				base: {
					fontSize: '16px',
					color: 'var(--MI_THEME-fg)',
					fontFamily: 'system-ui, sans-serif',
					backgroundColor: 'var(--MI_THEME-input)',
					'::placeholder': {
						color: 'var(--MI_THEME-fgMuted)'
					}
				},
				invalid: {
					color: 'var(--MI_THEME-error)',
					iconColor: 'var(--MI_THEME-error)'
				},
				complete: {
					color: 'var(--MI_THEME-success)',
					iconColor: 'var(--MI_THEME-success)'
				}
			},
			hidePostalCode: false,
		});

		loading.value = false;

		await nextTick();

		if (cardElementRef.value && cardElement.value) {
			cardElement.value.mount(cardElementRef.value);

			cardElement.value.on('change', (event) => {
				cardError.value = event.error ? event.error.message : '';
			});
		}
	} catch (error) {
		console.error('Failed to initialize Stripe:', error);
		paymentError.value = i18n.ts._payment.initializationError;
		loading.value = false;
	}
};

const processPayment = async () => {
	if (!stripe.value) {
		paymentError.value = i18n.ts._payment.stripeNotLoaded;
		return;
	}

	const isOneTimePayment = !props.showSubscriptionOptions || !isSubscription.value;
	if (!isOneTimePayment && !cardElement.value) {
		paymentError.value = 'Card element not available';
		return;
	}

	processing.value = true;
	paymentError.value = '';
	paymentSuccess.value = false;

	try {
		if (isSubscription.value && selectedPlan.value) {
			await processSubscription();
		} else {
			await processOneTimePayment();
		}
	} catch (error) {
		console.error('Payment processing error:', error);
		paymentError.value = error instanceof Error ? error.message : i18n.ts._payment.processingError;
		emit('error', paymentError.value);
		processing.value = false;
	}
};

const processOneTimePayment = async () => {
	const requestData: {
		amount: number;
		description?: string;
		useCheckout: boolean;
		billingDetails: {
			firstName: string;
			lastName: string;
			email: string;
		};
	} = {
		amount: amount.value * 100,
		useCheckout: props.useCheckout,
		billingDetails: {
			firstName: '',
			lastName: '',
			email: '',
		},
	};

	if (description.value) {
		requestData.description = description.value;
	}

	requestData.billingDetails = {
		firstName: billingInfo.value.firstName || '',
		lastName: billingInfo.value.lastName || '',
		email: billingInfo.value.email || '',
	};

	const intentResponse = await misskeyApi('payment/create-intent', requestData) as {
		clientSecret: string;
		paymentIntentId?: string;
		checkoutSessionId?: string;
		useCheckout: boolean;
	};

	const paymentParams = new URLSearchParams({
		client_secret: intentResponse.clientSecret,
		amount: (amount.value * 100).toString(),
		description: description.value || '',
		first_name: billingInfo.value.firstName || '',
		last_name: billingInfo.value.lastName || '',
		email: billingInfo.value.email || ''
	});

	if (intentResponse.useCheckout && intentResponse.checkoutSessionId) {
		paymentParams.set('use_checkout', 'true');
		paymentParams.set('checkout_session_id', intentResponse.checkoutSessionId);
	} else if (intentResponse.paymentIntentId) {
		paymentParams.set('payment_intent_id', intentResponse.paymentIntentId);
	}

	const paymentWindow = window.open(
		`/payment?${paymentParams.toString()}`,
		'stripe-payment',
		'width=750,height=900,scrollbars=yes,resizable=yes,status=yes,toolbar=no,menubar=no'
	);

	if (!paymentWindow) {
		throw new Error('Failed to open payment window. Please allow popups.');
	}

	const messageHandler = (event: MessageEvent) => {
		if (event.source === paymentWindow && event.data?.type === 'payment-complete') {
			if (event.data.success) {
				paymentSuccess.value = true;
				processing.value = false;
				emit('success', event.data.paymentData);
			} else {
				paymentError.value = 'Payment was not completed';
				processing.value = false;
			}
			window.clearInterval(checkClosed);
			window.removeEventListener('message', messageHandler);
		}
	};

	window.addEventListener('message', messageHandler);

	const checkClosed = window.setInterval(() => {
		if (paymentWindow.closed) {
			window.clearInterval(checkClosed);
			window.removeEventListener('message', messageHandler);
			if (!paymentSuccess.value) {
				processing.value = false;
				// User closed window without completing payment
			}
		}
	}, 1000);
};

const processSubscription = async () => {
	const { error: pmError, paymentMethod } = await stripe.value!.createPaymentMethod({
		type: 'card',
		card: cardElement.value!,
		billing_details: {
			name: `${billingInfo.value.firstName} ${billingInfo.value.lastName}`.trim(),
			email: billingInfo.value.email,
		}
	});

	if (pmError) {
		throw new Error(pmError.message);
	}

	const subscriptionData = {
		priceId: selectedPlan.value,
		paymentMethodId: paymentMethod.id,
		amount: amount.value,
		metadata: description.value ? { description: description.value } : null
	};
	const subscription = await misskeyApi('payment/create-subscription', subscriptionData as any) as { subscriptionId: string; status: string; clientSecret: string | null };

	if (subscription.status === 'active' || subscription.status === 'trialing') {
		paymentSuccess.value = true;
		processing.value = false;
		emit('success', subscription);
	} else if (subscription.clientSecret) {
		const { error } = await stripe.value!.confirmCardPayment(subscription.clientSecret);

		if (error) {
			throw new Error(error.message);
		} else {
			paymentSuccess.value = true;
			processing.value = false;
			emit('success', subscription);
		}
	} else {
		throw new Error(i18n.ts._payment.subscriptionFailed);
	}
};

onMounted(() => {
	initializeStripe();
});
</script>

<style lang="scss" scoped>
.payment-widget {
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 8px;
	padding: 20px;
	background: var(--MI_THEME-panel);

	.disabled, .loading {
		text-align: center;
		padding: 40px 20px;
		color: var(--MI_THEME-fgMuted);

		i {
			font-size: 48px;
			margin-bottom: 16px;
			display: block;
		}
	}

	.content {
		.header {
			display: flex;
			align-items: center;
			gap: 12px;
			margin-bottom: 24px;

			i {
				font-size: 24px;
				color: var(--MI_THEME-accent);
			}

			h3 {
				margin: 0;
				font-size: 20px;
				font-weight: 600;
			}
		}

		.optional {
			font-weight: normal;
			font-size: 14px;
			color: var(--MI_THEME-fgMuted);
			opacity: 0.8;
		}

		form {
			display: flex;
			flex-direction: column;
			gap: 20px;

			label {
				display: block;
				font-weight: 500;
				margin-bottom: 8px;
				color: var(--MI_THEME-fg);
			}

			.card-element, .payment-element {
				border: 1px solid var(--MI_THEME-inputBorder);
				border-radius: 4px;
				padding: 12px;
				background: var(--MI_THEME-input);
				transition: border-color 0.2s;

				&:focus-within {
					border-color: var(--MI_THEME-accent);
				}

				.payment-placeholder {
					display: flex;
					flex-direction: column;
					align-items: center;
					justify-content: center;
					text-align: center;
					padding: 20px;
					color: var(--MI_THEME-fgMuted);

					i {
						font-size: 32px;
						margin-bottom: 12px;
						opacity: 0.7;
					}

					p {
						margin: 0 0 8px 0;
						font-size: 14px;
						font-weight: 500;
					}

					small {
						font-size: 12px;
						opacity: 0.8;
						line-height: 1.4;
					}
				}
			}

			.billing-row {
				display: flex;
				gap: 12px;

				> * {
					flex: 1;
				}
			}

			.privacy-note {
				margin-top: 8px;
				display: flex;
				align-items: flex-start;
				gap: 8px;
				font-size: 14px;
				color: var(--MI_THEME-fgMuted);
				background: var(--MI_THEME-bg);
				padding: 12px;
				border-radius: 6px;

				i {
					margin-top: 2px;
					flex-shrink: 0;
				}
			}

			.subscription-options {
				margin-top: 16px;
				padding: 16px;
				background: var(--MI_THEME-bg);
				border-radius: 6px;
			}

			.actions {
				margin-top: 24px;
				display: flex;
				justify-content: flex-end;
			}
		}

		.success, .error {
			margin-top: 20px;
			padding: 16px;
			border-radius: 6px;
			display: flex;
			align-items: center;
			gap: 12px;

			i {
				font-size: 20px;
			}

			p {
				margin: 0;
				font-weight: 500;
			}
		}

		.success {
			background: var(--MI_THEME-successBg);
			color: var(--MI_THEME-success);
		}

		.error {
			background: var(--MI_THEME-errorBg);
			color: var(--MI_THEME-error);
		}
	}
}
</style>
