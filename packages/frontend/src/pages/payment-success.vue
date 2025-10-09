<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkStickyContainer>
	<template #header>
		<MkPageHeader/>
	</template>
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="payment-success">
			<div class="success-content">
				<div class="icon">
					<i class="ti ti-check-circle"></i>
				</div>
				<h1>{{ i18n.ts._donation.thankYou }}</h1>
				<p>{{ i18n.ts._payment.success }}</p>

				<div v-if="paymentDetails" class="payment-details">
					<h2>{{ i18n.ts._admin._payments.paymentDetails }}</h2>
					<div class="detail-item">
						<span class="label">{{ i18n.ts._admin._payments.paymentId }}:</span>
						<span class="value">{{ paymentDetails.paymentIntentId }}</span>
					</div>
					<div class="detail-item">
						<span class="label">{{ i18n.ts._admin._payments.amount }}:</span>
						<span class="value">${{ formatAmount(paymentDetails.amount) }}</span>
					</div>
					<div v-if="paymentDetails.description" class="detail-item">
						<span class="label">{{ i18n.ts._admin._payments.description }}:</span>
						<span class="value">{{ paymentDetails.description }}</span>
					</div>
				</div>

				<div class="actions">
					<MkButton primary @click="closeWindow">{{ i18n.ts.close }}</MkButton>
				</div>
			</div>
		</div>
	</div>
</MkStickyContainer>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

interface PaymentDetails {
	paymentIntentId: string;
	amount: number;
	description?: string;
}

const paymentDetails = ref<PaymentDetails | null>(null);

const formatAmount = (amount: number) => {
	return (amount / 100).toFixed(2);
};

const closeWindow = () => {
	if (window.opener) {
		window.opener.postMessage({ type: 'payment-success', data: paymentDetails.value }, '*');
		window.close();
	} else {
		window.history.back();
	}
};

onMounted(async () => {
	const urlParams = new URLSearchParams(window.location.search);
	const paymentIntent = urlParams.get('payment_intent');
	const redirectStatus = urlParams.get('redirect_status');
	const checkoutSessionId = urlParams.get('checkout_session_id');
	const useCheckout = urlParams.get('use_checkout') === 'true';

	try {
		if (useCheckout && checkoutSessionId) {
			const { misskeyApi } = await import('@/utility/misskey-api.js');
			const confirmResult = await misskeyApi('payment/confirm-intent', {
				checkoutSessionId: checkoutSessionId,
			}) as {
				status: string;
				paymentIntentId?: string;
				checkoutSessionId?: string;
				amount: number;
				currency: string;
				description?: string;
			};

			paymentDetails.value = {
				paymentIntentId: confirmResult.paymentIntentId || checkoutSessionId,
				amount: confirmResult.amount,
				description: confirmResult.description,
			};
		} else if (paymentIntent && redirectStatus === 'succeeded') {
			const { misskeyApi } = await import('@/utility/misskey-api.js');
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

			paymentDetails.value = {
				paymentIntentId: confirmResult.paymentIntentId || paymentIntent,
				amount: confirmResult.amount,
				description: confirmResult.description,
			};
		}
	} catch (error) {
		console.error('Failed to load payment details:', error);
		paymentDetails.value = {
			paymentIntentId: checkoutSessionId || paymentIntent || 'Unknown',
			amount: 0,
		};
	}

	if (window.opener) {
		window.setTimeout(() => {
			closeWindow();
		}, 3000);
	}
});

definePage({
	title: '',
	hideHeader: true,
	hideSidebar: true,
	hideWidgets: true,
	hideFooter: true,
});
</script>

<style lang="scss" scoped>
.payment-success {
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 400px;
	padding: 20px;

	.success-content {
		text-align: center;
		max-width: 500px;

		.icon {
			margin-bottom: 24px;

			i {
				font-size: 64px;
				color: var(--MI_THEME-success);
			}
		}

		h1 {
			margin: 0 0 16px 0;
			font-size: 28px;
			font-weight: 700;
			color: var(--MI_THEME-fg);
		}

		p {
			margin: 0 0 32px 0;
			font-size: 16px;
			color: var(--MI_THEME-fgMuted);
			line-height: 1.6;
		}

		.payment-details {
			background: var(--MI_THEME-panel);
			border: 1px solid var(--MI_THEME-divider);
			border-radius: 8px;
			padding: 24px;
			margin-bottom: 32px;
			text-align: left;

			h2 {
				margin: 0 0 16px 0;
				font-size: 18px;
				font-weight: 600;
				color: var(--MI_THEME-fg);
			}

			.detail-item {
				display: flex;
				justify-content: space-between;
				align-items: center;
				padding: 8px 0;
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
			gap: 12px;
		}
	}
}
</style>
