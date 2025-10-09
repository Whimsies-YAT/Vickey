<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkWindow ref="dialog" :initialWidth="600" :initialHeight="800" @closed="$emit('closed')">
	<template #header>
		<i class="ti ti-credit-card"></i>
		{{ i18n.ts._admin._payments.paymentDetails }}
	</template>
	<div class="payment-detail-content">
		<div class="content">
			<div class="payment-info">
				<div class="info-group">
					<h3>{{ i18n.ts._admin._payments.basicInfo }}</h3>
					<div class="info-grid">
						<div class="info-item">
							<label>{{ i18n.ts._admin._payments.paymentId }}</label>
							<div class="payment-ids">
								<code v-if="payment.paymentIntentId" class="payment-intent-id">
									<span class="id-label">PI:</span>
									{{ payment.paymentIntentId }}
								</code>
								<code v-if="payment.checkoutSessionId" class="checkout-session-id">
									<span class="id-label">CS:</span>
									{{ payment.checkoutSessionId }}
								</code>
								<span v-if="!payment.paymentIntentId && !payment.checkoutSessionId" class="no-id">{{ i18n.ts._admin._payments.unknownId }}</span>
							</div>
						</div>

						<div v-if="payment.paymentMode" class="info-item">
							<label>{{ i18n.ts._admin._payments.paymentMode }}</label>
							<div class="payment-mode">
								<i :class="payment.paymentMode === 'checkout_session' ? 'ti ti-shopping-cart' : 'ti ti-credit-card'"></i>
								{{ payment.paymentMode === 'checkout_session' ? i18n.ts._admin._payments.checkoutSession : i18n.ts._admin._payments.paymentIntent }}
							</div>
						</div>

						<div class="info-item">
							<label>{{ i18n.ts._admin._payments.status }}</label>
							<div :class="['status', payment.status]">
								<i :class="getStatusIcon(payment.status)"></i>
								{{ getStatusText(payment.status) }}
							</div>
						</div>

						<div class="info-item">
							<label>{{ i18n.ts._admin._payments.amount }}</label>
							<div class="amount">
								<span class="value">{{ (payment.amount / 100).toFixed(2) }}</span>
								<span class="currency">{{ payment.currency.toUpperCase() }}</span>
							</div>
						</div>

						<div class="info-item">
							<label>{{ i18n.ts._admin._payments.description }}</label>
							<span>{{ payment.description || i18n.ts._admin._payments.noDescription }}</span>
						</div>

						<div class="info-item">
							<label>{{ i18n.ts._admin._payments.createdAt }}</label>
							<MkTime :time="payment.createdAt" mode="detail"/>
						</div>

						<div class="info-item">
							<label>{{ i18n.ts._admin._payments.updatedAt }}</label>
							<MkTime :time="payment.updatedAt" mode="detail"/>
						</div>
					</div>
				</div>

				<div v-if="payment.user" class="info-group">
					<h3>{{ i18n.ts._admin._payments.userInfo }}</h3>
					<div class="user-card">
						<MkAvatar :user="payment.user" :size="48"/>
						<div class="user-details">
							<div class="user-name">{{ payment.user.name || payment.user.username }}</div>
							<div class="user-username">@{{ payment.user.username }}</div>
							<div v-if="payment.user.email" class="user-email">{{ payment.user.email }}</div>
						</div>
					</div>
				</div>

				<div v-if="payment.metadata" class="info-group">
					<h3>{{ i18n.ts._admin._payments.metadata }}</h3>
					<div class="metadata">
						<pre><code>{{ JSON.stringify(payment.metadata, null, 2) }}</code></pre>
					</div>
				</div>

				<div v-if="payment.stripeDetails" class="info-group">
					<h3>{{ i18n.ts._admin._payments.stripeDetails }}</h3>
					<div class="stripe-details">
						<div v-if="payment.stripeDetails.charges?.data?.[0]" class="detail-item">
							<label>{{ i18n.ts._admin._payments.chargeId }}</label>
							<code>{{ payment.stripeDetails.charges.data[0].id }}</code>
						</div>

						<div v-if="payment.stripeDetails.customer" class="detail-item">
							<label>{{ i18n.ts._admin._payments.customerId }}</label>
							<code>{{ payment.stripeDetails.customer }}</code>
						</div>

						<div v-if="payment.stripeDetails.receipt_url" class="detail-item">
							<label>{{ i18n.ts._admin._payments.receipt }}</label>
							<MkButton size="small" @click="openReceipt(payment.stripeDetails.receipt_url)">
								<i class="ti ti-external-link"></i>
								{{ i18n.ts._admin._payments.viewReceipt }}
							</MkButton>
						</div>

						<div v-if="payment.stripeDetails.payment_method" class="detail-item">
							<label>{{ i18n.ts._admin._payments.paymentMethod }}</label>
							<div class="payment-method">
								<i class="ti ti-credit-card"></i>
								{{ formatPaymentMethod(payment.stripeDetails.payment_method) }}
							</div>
						</div>

						<details class="raw-data">
							<summary>{{ i18n.ts._admin._payments.rawStripeData }}</summary>
							<pre><code>{{ JSON.stringify(payment.stripeDetails, null, 2) }}</code></pre>
						</details>
					</div>
				</div>
			</div>
		</div>

		<div class="footer">
			<MkButton @click="cancel">{{ i18n.ts.close }}</MkButton>
		</div>
	</div>
</MkWindow>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import { i18n } from '@/i18n.js';
import MkWindow from '@/components/MkWindow.vue';
import MkButton from '@/components/MkButton.vue';

interface Props {
	payment: any;
}

const props = defineProps<Props>();

const emit = defineEmits<{
	closed: [];
}>();

const dialog = ref<InstanceType<typeof MkWindow>>();

const cancel = () => {
	dialog.value?.close();
};

const getStatusIcon = (status: string) => {
	switch (status) {
		case 'succeeded': return 'ti ti-check';
		case 'pending': return 'ti ti-clock';
		case 'failed': return 'ti ti-x';
		case 'canceled': return 'ti ti-ban';
		default: return 'ti ti-help';
	}
};

const getStatusText = (status: string) => {
	const statusMap: Record<string, string> = {
		succeeded: i18n.ts._admin._payments.succeeded,
		pending: i18n.ts._admin._payments.pending,
		failed: i18n.ts._admin._payments.failed,
		canceled: i18n.ts._admin._payments.canceled
	};
	return statusMap[status] || status;
};

const openReceipt = (url: string) => {
	window.open(url, '_blank');
};

const formatPaymentMethod = (paymentMethod: any) => {
	if (typeof paymentMethod === 'string') {
		return paymentMethod;
	}

	if (paymentMethod?.type === 'card' && paymentMethod?.card) {
		const card = paymentMethod.card;
		return `${card.brand?.toUpperCase()} •••• ${card.last4}`;
	}

	return paymentMethod?.type || 'Unknown';
};
</script>

<style lang="scss" scoped>
.payment-detail-content {
	display: flex;
	flex-direction: column;
	height: 100%;
	background: var(--MI_THEME-panel);

	.content {
		flex: 1;
		overflow-y: auto;
		padding: 24px;

		.payment-info {
			display: flex;
			flex-direction: column;
			gap: 32px;
		}

		.info-group {
			background: var(--MI_THEME-bg);
			border-radius: 12px;
			padding: 24px;
			border: 1px solid var(--MI_THEME-divider);
			transition: all 0.2s ease;

			&:hover {
				border-color: var(--MI_THEME-accent);
				box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
			}

			h3 {
				margin: 0 0 20px 0;
				font-size: 18px;
				font-weight: 700;
				color: var(--MI_THEME-accent);
				display: flex;
				align-items: center;
				gap: 8px;

				&::before {
					content: '';
					width: 4px;
					height: 18px;
					background: var(--MI_THEME-accent);
					border-radius: 2px;
				}
			}

			.info-grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
				gap: 20px;

				@media (max-width: 640px) {
					grid-template-columns: 1fr;
				}
			}

			.info-item {
				padding: 16px;
				background: var(--MI_THEME-panel);
				border-radius: 8px;
				border: 1px solid var(--MI_THEME-divider);
				transition: all 0.2s ease;

				&:hover {
					transform: translateY(-1px);
					box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
				}

				label {
					display: block;
					font-weight: 600;
					margin-bottom: 8px;
					color: var(--MI_THEME-fgMuted);
					font-size: 0.85em;
					text-transform: uppercase;
					letter-spacing: 0.5px;
				}

				code {
					background: var(--MI_THEME-bg);
					color: var(--MI_THEME-accent);
					padding: 8px 12px;
					border-radius: 6px;
					font-family: 'SFMono-Regular', 'Monaco', 'Inconsolata', 'Fira Code', 'Fira Mono', 'Droid Sans Mono', 'Courier New', monospace;
					font-size: 0.9em;
					font-weight: 600;
					border: 1px solid var(--MI_THEME-divider);
					display: inline-block;
					word-break: break-all;
				}

				.payment-ids {
					display: flex;
					flex-direction: column;
					gap: 8px;

					.payment-intent-id {
						.id-label {
							background: var(--MI_THEME-accent);
							color: white;
							padding: 2px 6px;
							border-radius: 4px 0 0 4px;
							font-size: 0.8em;
							margin-right: -1px;
						}
					}

					.checkout-session-id {
						background: var(--MI_THEME-accentedBg);
						color: var(--MI_THEME-accent);
						border-color: var(--MI_THEME-accent);

						.id-label {
							background: var(--MI_THEME-accent);
							color: white;
							padding: 2px 6px;
							border-radius: 4px 0 0 4px;
							font-size: 0.8em;
							margin-right: -1px;
						}
					}

					.no-id {
						color: var(--MI_THEME-fgMuted);
						font-style: italic;
						font-weight: normal;
					}
				}

				.payment-mode {
					display: flex;
					align-items: center;
					gap: 8px;
					font-weight: 600;
					padding: 8px 12px;
					background: var(--MI_THEME-accentedBg);
					color: var(--MI_THEME-accent);
					border-radius: 8px;
					border: 1px solid var(--MI_THEME-accent);

					i {
						font-size: 1.1em;
					}
				}

				.status {
					display: inline-flex;
					align-items: center;
					gap: 8px;
					font-weight: 600;
					padding: 6px 12px;
					border-radius: 20px;
					font-size: 0.9em;

					&.succeeded {
						color: var(--MI_THEME-success);
						background: color-mix(in srgb, var(--MI_THEME-success) 15%, transparent);
						border: 1px solid color-mix(in srgb, var(--MI_THEME-success) 30%, transparent);
					}

					&.pending {
						color: var(--MI_THEME-warn);
						background: color-mix(in srgb, var(--MI_THEME-warn) 15%, transparent);
						border: 1px solid color-mix(in srgb, var(--MI_THEME-warn) 30%, transparent);
					}

					&.failed, &.canceled {
						color: var(--MI_THEME-error);
						background: color-mix(in srgb, var(--MI_THEME-error) 15%, transparent);
						border: 1px solid color-mix(in srgb, var(--MI_THEME-error) 30%, transparent);
					}

					i {
						font-size: 1.1em;
					}
				}

				.amount {
					display: flex;
					align-items: baseline;
					gap: 6px;

					.value {
						font-weight: 700;
						font-size: 1.5em;
						color: var(--MI_THEME-accent);
					}

					.currency {
						color: var(--MI_THEME-fgMuted);
						font-weight: 600;
						text-transform: uppercase;
						font-size: 0.9em;
					}
				}

				> span:not(.amount):not(.status) {
					color: var(--MI_THEME-fg);
					font-weight: 500;
				}
			}
		}

		.user-card {
			display: flex;
			align-items: center;
			gap: 20px;
			padding: 20px;
			background: var(--MI_THEME-panel);
			border: 1px solid var(--MI_THEME-divider);
			border-radius: 12px;
			transition: all 0.2s ease;

			&:hover {
				transform: translateY(-1px);
				box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
				border-color: var(--MI_THEME-accent);
			}

			.user-details {
				flex: 1;

				.user-name {
					font-weight: 700;
					font-size: 1.1em;
					margin-bottom: 4px;
					color: var(--MI_THEME-fg);
				}

				.user-username {
					color: var(--MI_THEME-accent);
					font-weight: 600;
					font-size: 0.95em;
					margin-bottom: 4px;
				}

				.user-email {
					color: var(--MI_THEME-fgMuted);
					font-size: 0.85em;
					font-weight: 500;
				}
			}
		}

		.metadata, .raw-data {
			background: var(--MI_THEME-bg);
			border: 1px solid var(--MI_THEME-divider);
			border-radius: 8px;
			padding: 20px;
			font-family: 'SFMono-Regular', 'Monaco', 'Inconsolata', 'Fira Code', 'Fira Mono', 'Droid Sans Mono', 'Courier New', monospace;

			pre {
				margin: 0;
				white-space: pre-wrap;
				word-break: break-word;
				font-size: 0.85em;
				line-height: 1.6;
				color: var(--MI_THEME-fg);
			}

			code {
				color: var(--MI_THEME-fg);
			}
		}

		.stripe-details {
			display: flex;
			flex-direction: column;
			gap: 20px;

			.detail-item {
				padding: 16px;
				background: var(--MI_THEME-panel);
				border: 1px solid var(--MI_THEME-divider);
				border-radius: 8px;
				transition: all 0.2s ease;

				&:hover {
					transform: translateY(-1px);
					box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
				}

				label {
					display: block;
					font-weight: 600;
					margin-bottom: 12px;
					color: var(--MI_THEME-fgMuted);
					font-size: 0.85em;
					text-transform: uppercase;
					letter-spacing: 0.5px;
				}

				code {
					background: var(--MI_THEME-bg);
					color: var(--MI_THEME-accent);
					padding: 8px 12px;
					border-radius: 6px;
					font-family: 'SFMono-Regular', 'Monaco', 'Inconsolata', 'Fira Code', 'Fira Mono', 'Droid Sans Mono', 'Courier New', monospace;
					font-size: 0.9em;
					font-weight: 600;
					border: 1px solid var(--MI_THEME-divider);
				}

				.payment-method {
					display: flex;
					align-items: center;
					gap: 12px;
					font-weight: 600;
					color: var(--MI_THEME-fg);

					i {
						color: var(--MI_THEME-accent);
						font-size: 1.2em;
					}
				}
			}

			.raw-data {
				border: 1px solid var(--MI_THEME-divider);

				summary {
					cursor: pointer;
					font-weight: 600;
					padding: 16px 20px;
					color: var(--MI_THEME-accent);
					background: var(--MI_THEME-panel);
					border-radius: 8px 8px 0 0;
					transition: all 0.2s ease;

					&:hover {
						background: var(--MI_THEME-buttonHoverBg);
					}

					&::marker {
						color: var(--MI_THEME-accent);
					}
				}

				&[open] summary {
					border-bottom: 1px solid var(--MI_THEME-divider);
					border-radius: 8px 8px 0 0;
				}

				pre {
					margin: 0 20px 20px;
				}
			}
		}
	}

	.footer {
		padding: 20px 24px;
		border-top: 1px solid var(--MI_THEME-divider);
		background: var(--MI_THEME-bg);
		display: flex;
		justify-content: flex-end;
		gap: 12px;
	}
}
</style>
