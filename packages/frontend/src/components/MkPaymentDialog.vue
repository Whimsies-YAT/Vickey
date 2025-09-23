<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal ref="modal" @click="cancel" @closed="$emit('closed')">
	<div class="payment-modal">
		<div class="header">
			<h2>
				<i class="ti ti-credit-card"></i>
				{{ subscription ? i18n.ts._payment.subscriptionTitle : i18n.ts._payment.paymentTitle }}
			</h2>
			<button class="close" @click="cancel">
				<i class="ti ti-x"></i>
			</button>
		</div>

		<div class="content">
			<MkPaymentWidget
				:showSubscriptionOptions="subscription"
				:defaultAmount="amount"
				:defaultCurrency="currency"
				:subscriptionPlans="subscriptionPlans"
				@success="onSuccess"
				@error="onError"
			/>
		</div>

		<div class="footer">
			<MkButton @click="cancel">{{ i18n.ts.cancel }}</MkButton>
		</div>
	</div>
</MkModal>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import { i18n } from '@/i18n.js';
import MkModal from '@/components/MkModal.vue';
import MkButton from '@/components/MkButton.vue';
import MkPaymentWidget from '@/components/MkPaymentWidget.vue';

interface Props {
	amount?: number;
	currency?: string;
	description?: string;
	subscription?: boolean;
	priceId?: string;
	subscriptionPlans?: Array<{ value: string, text: string }>;
}

const props = withDefaults(defineProps<Props>(), {
	amount: 10,
	currency: 'usd',
	description: '',
	subscription: false,
	priceId: '',
	subscriptionPlans: () => []
});

const emit = defineEmits<{
	done: [result: any];
	closed: [];
}>();

const modal = ref<InstanceType<typeof MkModal>>();

const cancel = () => {
	modal.value?.close();
};

const onSuccess = (paymentData: any) => {
	emit('done', paymentData);
	modal.value?.close();
};

const onError = (error: string) => {
	// Error handling is already done in the widget
	console.error('Payment error:', error);
};
</script>

<style lang="scss" scoped>
.payment-modal {
	background: var(--panel);
	border-radius: 12px;
	min-width: 480px;
	max-width: 90vw;
	max-height: 90vh;
	overflow: hidden;
	display: flex;
	flex-direction: column;

	@media (max-width: 600px) {
		min-width: 90vw;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 20px;
		border-bottom: 1px solid var(--divider);

		h2 {
			margin: 0;
			font-size: 18px;
			font-weight: 600;
			display: flex;
			align-items: center;
			gap: 12px;

			i {
				color: var(--accent);
			}
		}

		.close {
			background: none;
			border: none;
			color: var(--fg);
			font-size: 20px;
			cursor: pointer;
			padding: 4px;
			border-radius: 4px;
			transition: background-color 0.2s;

			&:hover {
				background: var(--buttonHoverBg);
			}
		}
	}

	.content {
		flex: 1;
		overflow-y: auto;
		padding: 0;

		:deep(.payment-widget) {
			border: none;
			border-radius: 0;
		}
	}

	.footer {
		padding: 20px;
		border-top: 1px solid var(--divider);
		display: flex;
		justify-content: flex-end;
	}
}
</style>
