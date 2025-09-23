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
				<div id="card-element" ref="cardElementRef" class="card-element"></div>
				<div v-if="cardError" class="error">{{ cardError }}</div>
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
	subscriptionPlans?: Array<{value: string, text: string}>;
}

const props = withDefaults(defineProps<Props>(), {
	showSubscriptionOptions: false,
	defaultAmount: 10,
	defaultCurrency: 'usd',
	subscriptionPlans: () => []
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
const currency = ref(props.defaultCurrency);

watch(() => props.defaultAmount, (newAmount) => {
	if (newAmount) {
		amount.value = newAmount;
	}
});

watch(() => props.defaultCurrency, (newCurrency) => {
	if (newCurrency) {
		currency.value = newCurrency;
	}
});
const description = ref('');
const isSubscription = ref(false);
const selectedPlan = ref('');

const stripe = ref<Stripe | null>(null);
const elements = ref<StripeElements | null>(null);
const cardElement = ref<StripeCardElement | null>(null);
const cardElementRef = ref<HTMLElement | null>(null);

// Convert subscriptionPlans to the format expected by MkSelect
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
			}
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
	if (!stripe.value || !cardElement.value) {
		paymentError.value = i18n.ts._payment.stripeNotLoaded;
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
	} finally {
		processing.value = false;
	}
};

const processOneTimePayment = async () => {
	const requestData: { amount: number; currency: string; description?: string } = {
		amount: amount.value * 100,
		currency: currency.value
	};
	if (description.value) {
		requestData.description = description.value;
	}
	const paymentIntent = await misskeyApi('payment/create-intent', requestData) as { clientSecret: string; paymentIntentId: string };

	const { error, paymentIntent: confirmedPaymentIntent } = await stripe.value!.confirmCardPayment(
		paymentIntent.clientSecret,
		{
			payment_method: {
				card: cardElement.value!,
			}
		}
	);

	if (error) {
		throw new Error(error.message);
	}

	if (confirmedPaymentIntent?.status === 'succeeded') {
		paymentSuccess.value = true;
		emit('success', confirmedPaymentIntent);
	} else {
		throw new Error(i18n.ts._payment.paymentFailed);
	}
};

const processSubscription = async () => {
	const { error: pmError, paymentMethod } = await stripe.value!.createPaymentMethod({
		type: 'card',
		card: cardElement.value!,
	});

	if (pmError) {
		throw new Error(pmError.message);
	}

	const subscriptionData = {
		priceId: selectedPlan.value,
		paymentMethodId: paymentMethod.id,
		metadata: description.value ? { description: description.value } : null
	};
	const subscription = await misskeyApi('payment/create-subscription', subscriptionData as any) as { subscriptionId: string; status: string; clientSecret: string | null };

	if (subscription.status === 'active' || subscription.status === 'trialing') {
		paymentSuccess.value = true;
		emit('success', subscription);
	} else if (subscription.clientSecret) {
		const { error } = await stripe.value!.confirmCardPayment(subscription.clientSecret);

		if (error) {
			throw new Error(error.message);
		} else {
			paymentSuccess.value = true;
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

			.card-element {
				border: 1px solid var(--MI_THEME-inputBorder);
				border-radius: 4px;
				padding: 12px;
				background: var(--MI_THEME-input);
				transition: border-color 0.2s;

				&:focus-within {
					border-color: var(--MI_THEME-accent);
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
