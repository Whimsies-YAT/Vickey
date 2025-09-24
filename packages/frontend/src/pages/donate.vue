<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<template #icon><i class="ti ti-heart"></i></template>
	<template #title>{{ i18n.ts._donation.title }}</template>

	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<div class="donation-header">
				<div class="hero-icon">
					<i class="ti ti-heart-filled"></i>
				</div>
				<h2>{{ i18n.ts._donation.supportProject }}</h2>
				<p class="hero-description">{{ i18n.tsx._donation.description({ instanceName: instanceName }) }}</p>
				<p class="help-text">{{ i18n.ts._donation.helpMaintain }}</p>
			</div>

			<div v-if="paymentEnabled" class="donation-widget">
				<MkLoading v-if="loading"/>
				<div v-else class="payment-form">
					<div class="amount-section">
						<div class="section-header">
							<i class="ti ti-currency-dollar"></i>
							<h3>{{ i18n.ts._donation.donateAmount }}</h3>
						</div>

						<div class="quick-amounts">
							<button
								v-for="amount in quickAmounts"
								:key="amount"
								:class="['amount-btn', { active: selectedAmount === amount }]"
								@click="selectAmount(amount)"
							>
								${{ amount }}
							</button>
							<button
								:class="['amount-btn', 'custom-btn', { active: isCustomAmount }]"
								@click="selectCustom"
							>
								{{ i18n.ts._donation.customAmount }}
							</button>
						</div>

						<div v-if="isCustomAmount" class="custom-amount">
							<MkInput
								v-model="customAmountValue"
								type="number"
								:min="1"
								:placeholder="i18n.ts._donation.enterAmount"
								@input="onCustomAmountChange"
							>
								<template #prefix>$</template>
							</MkInput>
						</div>
					</div>

					<div class="payment-type-section">
						<div class="section-header">
							<i class="ti ti-refresh"></i>
							<h3>{{ i18n.ts._donation.paymentType }}</h3>
						</div>
						<div class="payment-type-buttons">
							<button
								:class="['type-btn', { active: paymentType === 'one-time' }]"
								@click="paymentType = 'one-time'"
							>
								<i class="ti ti-credit-card"></i>
								{{ i18n.ts._donation.oneTime }}
							</button>
							<button
								:class="['type-btn', { active: paymentType === 'monthly' }]"
								@click="paymentType = 'monthly'"
							>
								<i class="ti ti-calendar-repeat"></i>
								{{ i18n.ts._donation.monthly }}
							</button>
						</div>
					</div>

					<div class="note-section">
						<div class="section-header">
							<i class="ti ti-message"></i>
							<h3>{{ i18n.ts._donation.note }} <span class="optional">({{ i18n.ts._donation.optional }})</span></h3>
						</div>
						<MkInput
							v-model="donationNote"
							:placeholder="i18n.ts._donation.noteExample"
						/>
					</div>

					<div class="donate-button-section">
						<MkButton
							:disabled="!canDonate || processing"
							:loading="processing"
							primary
							large
							@click="processDonation"
						>
							<i v-if="!processing" class="ti ti-heart"></i>
							{{ processing ? i18n.ts._donation.processing : i18n.ts._donation.donateButton }}
							<span v-if="finalAmount > 0" class="amount-display">${{ finalAmount }}</span>
						</MkButton>
						<p class="secure-payment">
							<i class="ti ti-shield-check"></i>
							{{ i18n.ts._donation.securePayment }}
						</p>
					</div>
				</div>
			</div>

			<div v-else class="payment-disabled">
				<div class="disabled-content">
					<i class="ti ti-credit-card-off"></i>
					<h3>{{ i18n.ts._donation.paymentUnavailable }}</h3>
					<p>{{ i18n.ts._donation.paymentDisabled }}</p>
				</div>
			</div>

			<div class="why-donate-section">
				<div class="section-header">
					<i class="ti ti-help-circle"></i>
					<h3>{{ i18n.ts._donation.whyDonate }}</h3>
				</div>
				<div class="reasons-grid">
					<div class="reason-card">
						<div class="reason-icon">
							<i class="ti ti-server"></i>
						</div>
						<div class="reason-content">
							<h4>{{ i18n.ts._donation.serverCosts }}</h4>
						</div>
					</div>
					<div class="reason-card">
						<div class="reason-icon">
							<i class="ti ti-code"></i>
						</div>
						<div class="reason-content">
							<h4>{{ i18n.ts._donation.development }}</h4>
						</div>
					</div>
					<div class="reason-card">
						<div class="reason-icon">
							<i class="ti ti-users"></i>
						</div>
						<div class="reason-content">
							<h4>{{ i18n.ts._donation.community }}</h4>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { definePage } from '@/page.js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import { instanceName } from '@@/js/config.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { $i } from '@/i.js';

const loading = ref(true);
const processing = ref(false);
const paymentEnabled = ref(false);

const selectedAmount = ref<number | null>(null);
const customAmountValue = ref<number | null>(null);
const isCustomAmount = ref(false);
const paymentType = ref<'one-time' | 'monthly'>('one-time');
const donationNote = ref('');

const quickAmounts = [5, 10, 25, 50, 100];

const headerActions = computed(() => []);
const headerTabs = computed(() => []);

const finalAmount = computed(() => {
	if (isCustomAmount.value) {
		return customAmountValue.value || 0;
	}
	return selectedAmount.value || 0;
});

const canDonate = computed(() => {
	return paymentEnabled.value && finalAmount.value > 0 && !processing.value;
});

const selectAmount = (amount: number) => {
	selectedAmount.value = amount;
	isCustomAmount.value = false;
	customAmountValue.value = null;
};

const selectCustom = () => {
	isCustomAmount.value = true;
	selectedAmount.value = null;
};

const onCustomAmountChange = () => {
	if (customAmountValue.value && customAmountValue.value > 0) {
	}
};

const processDonation = async () => {
	if (!canDonate.value) return;

	if (!$i) {
		const { dispose } = await os.popupAsyncWithDialog(
			import('@/components/MkSigninDialog.vue').then(x => x.default),
			{
				autoSet: true,
				message: i18n.ts.signinRequired,
			},
			{
				done: async () => {
					dispose();
					window.setTimeout(() => processDonation(), 100);
				},
				cancelled: () => {
					dispose();
				},
				closed: () => dispose(),
			}
		);
		return;
	}

	processing.value = true;

	try {
		const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkPaymentDialog.vue').then(x => x.default), {
			amount: finalAmount.value,
			currency: 'usd',
			description: donationNote.value || i18n.tsx._donation.description({ instanceName }),
			subscription: paymentType.value === 'monthly',
		}, {
			closed: () => {
				processing.value = false;
				dispose();
			},
			done: () => {
				processing.value = false;
				os.toast(i18n.ts._donation.thankYou);
				dispose();
			},
		});
	} catch (error) {
		console.error('Failed to process donation:', error);
		processing.value = false;
		await os.alert({
			type: 'error',
			text: i18n.ts._donation.errorText,
		});
	}
};

const checkPaymentConfig = async () => {
	try {
		const config = await misskeyApi('payment/get-config', {}) as { enabled: boolean };
		paymentEnabled.value = config.enabled;
	} catch (error) {
		console.error('Failed to check payment config:', error);
		paymentEnabled.value = false;
	} finally {
		loading.value = false;
	}
};

onMounted(() => {
	checkPaymentConfig();
	selectAmount(10);
});

definePage(() => ({
	title: i18n.ts._donation.title,
	icon: 'ti ti-heart',
}));
</script>

<style lang="scss" scoped>
.donation-header {
	text-align: center;
	padding: 32px 0;

	.hero-icon {
		font-size: 64px;
		color: var(--MI_THEME-accent);
		margin-bottom: 16px;

		i {
			animation: pulse 2s infinite;
		}

		@keyframes pulse {
			0%, 100% { transform: scale(1); }
			50% { transform: scale(1.05); }
		}
	}

	h2 {
		font-size: 32px;
		font-weight: 700;
		margin-bottom: 12px;
		color: var(--MI_THEME-fg);
	}

	.hero-description {
		font-size: 18px;
		color: var(--MI_THEME-fgTransparent);
		margin-bottom: 8px;
	}

	.help-text {
		font-size: 16px;
		color: var(--MI_THEME-fgTransparent);
	}
}

.donation-widget {
	background: var(--MI_THEME-panel);
	border-radius: 16px;
	border: 1px solid var(--MI_THEME-divider);
	overflow: hidden;
}

.payment-form {
	padding: 24px;
	display: flex;
	flex-direction: column;
	gap: 24px;
}

.section-header {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 16px;

	i {
		font-size: 20px;
		color: var(--MI_THEME-accent);
	}

	h3 {
		font-size: 18px;
		font-weight: 600;
		margin: 0;
	}

	.optional {
		font-size: 14px;
		font-weight: 400;
		color: var(--MI_THEME-fgTransparent);
	}
}

.quick-amounts {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
	gap: 12px;
	margin-bottom: 16px;
}

.amount-btn {
	padding: 12px 16px;
	border: 2px solid var(--MI_THEME-divider);
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	border-radius: 10px;
	font-size: 16px;
	font-weight: 600;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		border-color: var(--MI_THEME-accent);
		background: var(--MI_THEME-accentedBg);
	}

	&.active {
		border-color: var(--MI_THEME-accent);
		background: var(--MI_THEME-accent);
		color: var(--MI_THEME-accentForeground);
	}

	&.custom-btn {
		font-size: 14px;
	}
}

.custom-amount {
	margin-top: 8px;
}

.payment-type-buttons {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 12px;
}

.type-btn {
	padding: 16px;
	border: 2px solid var(--MI_THEME-divider);
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	border-radius: 10px;
	font-size: 16px;
	font-weight: 500;
	cursor: pointer;
	transition: all 0.2s ease;
	display: flex;
	align-items: center;
	gap: 8px;
	justify-content: center;

	&:hover {
		border-color: var(--MI_THEME-accent);
		background: var(--MI_THEME-accentedBg);
	}

	&.active {
		border-color: var(--MI_THEME-accent);
		background: var(--MI_THEME-accent);
		color: var(--MI_THEME-accentForeground);
	}

	i {
		font-size: 18px;
	}
}

.donate-button-section {
	text-align: center;

	.amount-display {
		margin-left: 8px;
		font-weight: 700;
	}

	.secure-payment {
		margin-top: 12px;
		font-size: 14px;
		color: var(--MI_THEME-fgTransparent);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;

		i {
			color: var(--MI_THEME-success);
		}
	}
}

.payment-disabled {
	background: var(--MI_THEME-panel);
	border-radius: 16px;
	border: 1px solid var(--MI_THEME-divider);
	padding: 48px 24px;
	text-align: center;

	.disabled-content {
		i {
			font-size: 48px;
			color: var(--MI_THEME-fgTransparent);
			margin-bottom: 16px;
		}

		h3 {
			font-size: 20px;
			margin-bottom: 8px;
		}

		p {
			color: var(--MI_THEME-fgTransparent);
		}
	}
}

.why-donate-section {
	background: var(--MI_THEME-panel);
	border-radius: 16px;
	border: 1px solid var(--MI_THEME-divider);
	padding: 24px;
}

.reasons-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
	gap: 16px;
}

.reason-card {
	padding: 20px;
	background: var(--MI_THEME-bg);
	border-radius: 12px;
	border: 1px solid var(--MI_THEME-divider);
	display: flex;
	align-items: center;
	gap: 16px;

	.reason-icon {
		width: 48px;
		height: 48px;
		border-radius: 12px;
		background: var(--MI_THEME-accentedBg);
		color: var(--MI_THEME-accent);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 24px;
		flex-shrink: 0;
	}

	.reason-content {
		flex: 1;

		h4 {
			font-size: 16px;
			font-weight: 600;
			margin: 0;
			line-height: 1.3;
		}
	}
}

@media (max-width: 768px) {
	.donation-header {
		padding: 24px 0;

		.hero-icon {
			font-size: 48px;
		}

		h2 {
			font-size: 24px;
		}
	}

	.quick-amounts {
		grid-template-columns: 1fr 1fr;
	}

	.reasons-grid {
		grid-template-columns: 1fr;
	}

	.reason-card {
		padding: 16px;
	}
}
</style>
