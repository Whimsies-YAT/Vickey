<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkButton
	v-if="paymentEnabled"
	:disabled="processing"
	v-bind="$attrs"
	@click="openPaymentDialog"
>
	<span v-if="processing" :class="$style.spinnerWrapper">
		<svg :class="$style.spinner" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
			<circle cx="25" cy="25" r="20" :class="$style.spinnerCircle"/>
		</svg>
	</span>
	<i v-else class="ti ti-credit-card"></i>
	{{ processing ? i18n.ts._payment.processing : buttonText }}
</MkButton>
</template>

<script lang="ts" setup>
import { ref, onMounted, computed } from 'vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import MkButton from '@/components/MkButton.vue';

interface Props {
	amount?: number;
	currency?: string;
	description?: string;
	buttonText?: string;
	subscription?: boolean;
	priceId?: string;
	useCheckout?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	amount: 10,
	description: '',
	buttonText: '',
	subscription: false,
	priceId: '',
	useCheckout: false
});

const emit = defineEmits<{
	success: [paymentData: any];
	error: [error: string];
}>();

const paymentEnabled = ref(false);
const processing = ref(false);

const buttonText = computed(() => {
	if (props.buttonText) return props.buttonText;
	return props.subscription ? i18n.ts._payment.subscribe : i18n.ts._payment.payNow;
});

const checkPaymentConfig = async () => {
	try {
		const config = await misskeyApi('payment/get-config', {}) as { enabled: boolean; publicKey: string | null };
		paymentEnabled.value = config.enabled && !!config.publicKey;
	} catch (error) {
		console.error('Failed to check payment config:', error);
		paymentEnabled.value = false;
	}
};

const openPaymentDialog = async () => {
	processing.value = true;

	try {
		await os.popupAsyncWithDialog(
			import('@/components/MkPaymentDialog.vue').then(x => x.default),
			{
				amount: props.amount,
				description: props.description,
				subscription: props.subscription,
				priceId: props.priceId,
				useCheckout: props.useCheckout
			},
			{
				done: (result) => {
					emit('success', result);
				},
				closed: () => {
					// Dialog was closed without completion
				}
			}
		);
	} catch (error) {
		console.error('Payment dialog error:', error);
		emit('error', error instanceof Error ? error.message : i18n.ts._payment.processingError);
	} finally {
		processing.value = false;
	}
};

onMounted(() => {
	checkPaymentConfig();
});
</script>

<style lang="scss" module>
.spinnerWrapper {
	display: inline-block;
	width: 1.28em;
	height: 1.28em;
	vertical-align: -0.2em;
	animation: globalSpinnerRotate 2s linear infinite;
}

.spinner {
	width: 100%;
	height: 100%;
	fill: none;
	stroke: currentColor;
	stroke-width: 3px;
	stroke-linecap: round;
}

.spinnerCircle {
	transform-origin: center;
	stroke-dasharray: 1, 200;
	stroke-dashoffset: 0;
	animation: globalSpinnerDash 1.5s ease-in-out infinite;
}
</style>
