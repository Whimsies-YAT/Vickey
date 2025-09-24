<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkWindow
	ref="windowEl"
	:initialWidth="500"
	:initialHeight="600"
	:canResize="false"
	@close="windowEl?.close()"
	@closed="emit('closed')"
>
	<template #header>
		<i class="ti ti-credit-card"></i>
		{{ subscription ? i18n.ts._payment.subscriptionTitle : i18n.ts._payment.paymentTitle }}
	</template>

	<div style="display: flex; flex-direction: column; min-height: 100%;">
		<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 20px; flex-grow: 1;">
			<MkPaymentWidget
				:showSubscriptionOptions="subscription"
				:defaultAmount="amount"
				:defaultCurrency="currency"
				:defaultDescription="description"
				:subscriptionPlans="subscriptionPlans"
				@success="onSuccess"
				@error="onError"
			/>
		</div>
	</div>
</MkWindow>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import { i18n } from '@/i18n.js';
import MkWindow from '@/components/MkWindow.vue';
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

const windowEl = ref<InstanceType<typeof MkWindow>>();

const onSuccess = (paymentData: any) => {
	emit('done', paymentData);
	windowEl.value?.close();
};

const onError = (error: string) => {
	// Error handling is already done in the widget
	console.error('Payment error:', error);
};
</script>
