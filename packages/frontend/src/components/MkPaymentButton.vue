<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkButton
	v-if="paymentEnabled"
	:disabled="processing"
	@click="openPaymentDialog"
	v-bind="$attrs"
>
	<i v-if="processing" class="ti ti-loader spinning"></i>
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
}

const props = withDefaults(defineProps<Props>(), {
	amount: 10,
	currency: 'usd',
	description: '',
	buttonText: '',
	subscription: false,
	priceId: ''
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
		const config = await misskeyApi('payment/get-config', {});
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
				currency: props.currency,
				description: props.description,
				subscription: props.subscription,
				priceId: props.priceId
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

<style lang="scss" scoped>
.spinning {
	animation: spin 1s linear infinite;
}

@keyframes spin {
	from { transform: rotate(0deg); }
	to { transform: rotate(360deg); }
}
</style>
