<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal ref="modal" @click="cancel" @closed="$emit('closed')">
	<div class="payment-detail-modal">
		<div class="header">
			<h2>
				<i class="ti ti-credit-card"></i>
				{{ i18n.ts._admin._payments.paymentDetails }}
			</h2>
			<button class="close" @click="cancel">
				<i class="ti ti-x"></i>
			</button>
		</div>

		<div class="content">
			<div class="payment-info">
				<div class="info-group">
					<h3>{{ i18n.ts._admin._payments.basicInfo }}</h3>
					<div class="info-grid">
						<div class="info-item">
							<label>{{ i18n.ts._admin._payments.paymentId }}</label>
							<code>{{ payment.paymentIntentId }}</code>
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
							<div class="user-email" v-if="payment.user.email">{{ payment.user.email }}</div>
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
						<div class="detail-item" v-if="payment.stripeDetails.charges?.data?.[0]">
							<label>{{ i18n.ts._admin._payments.chargeId }}</label>
							<code>{{ payment.stripeDetails.charges.data[0].id }}</code>
						</div>

						<div class="detail-item" v-if="payment.stripeDetails.customer">
							<label>{{ i18n.ts._admin._payments.customerId }}</label>
							<code>{{ payment.stripeDetails.customer }}</code>
						</div>

						<div class="detail-item" v-if="payment.stripeDetails.receipt_url">
							<label>{{ i18n.ts._admin._payments.receipt }}</label>
							<MkButton size="small" @click="openReceipt(payment.stripeDetails.receipt_url)">
								<i class="ti ti-external-link"></i>
								{{ i18n.ts._admin._payments.viewReceipt }}
							</MkButton>
						</div>

						<div class="detail-item" v-if="payment.stripeDetails.payment_method">
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
</MkModal>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import { i18n } from '@/i18n.js';
import MkModal from '@/components/MkModal.vue';
import MkButton from '@/components/MkButton.vue';

interface Props {
	payment: any;
}

const props = defineProps<Props>();

const emit = defineEmits<{
	closed: [];
}>();

const modal = ref<InstanceType<typeof MkModal>>();

const cancel = () => {
	modal.value?.close();
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
.payment-detail-modal {
	background: var(--panel);
	border-radius: 12px;
	min-width: 600px;
	max-width: 90vw;
	max-height: 90vh;
	overflow: hidden;
	display: flex;
	flex-direction: column;

	@media (max-width: 768px) {
		min-width: 90vw;
		max-height: 95vh;
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
		padding: 20px;

		.payment-info {
			display: flex;
			flex-direction: column;
			gap: 24px;
		}

		.info-group {
			h3 {
				margin: 0 0 16px 0;
				font-size: 16px;
				font-weight: 600;
				color: var(--accent);
			}

			.info-grid {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 16px;

				@media (max-width: 768px) {
					grid-template-columns: 1fr;
				}
			}

			.info-item {
				label {
					display: block;
					font-weight: 500;
					margin-bottom: 4px;
					color: var(--fg-muted);
					font-size: 0.9em;
				}

				code {
					background: var(--bg);
					padding: 4px 8px;
					border-radius: 4px;
					font-family: monospace;
					font-size: 0.9em;
				}

				.status {
					display: flex;
					align-items: center;
					gap: 6px;
					font-weight: 500;

					&.succeeded {
						color: var(--success);
					}

					&.pending {
						color: var(--warn);
					}

					&.failed, &.canceled {
						color: var(--error);
					}
				}

				.amount {
					.value {
						font-weight: 600;
						font-size: 1.2em;
					}

					.currency {
						color: var(--fg-muted);
						margin-left: 4px;
						text-transform: uppercase;
					}
				}
			}
		}

		.user-card {
			display: flex;
			align-items: center;
			gap: 16px;
			padding: 16px;
			background: var(--bg);
			border-radius: 8px;

			.user-details {
				.user-name {
					font-weight: 600;
					margin-bottom: 2px;
				}

				.user-username {
					color: var(--fg-muted);
					font-size: 0.9em;
					margin-bottom: 2px;
				}

				.user-email {
					color: var(--fg-muted);
					font-size: 0.8em;
				}
			}
		}

		.metadata, .raw-data {
			background: var(--bg);
			border-radius: 8px;
			padding: 16px;

			pre {
				margin: 0;
				white-space: pre-wrap;
				word-break: break-all;
				font-size: 0.8em;
				line-height: 1.4;
			}

			code {
				color: var(--fg);
			}
		}

		.stripe-details {
			display: flex;
			flex-direction: column;
			gap: 16px;

			.detail-item {
				label {
					display: block;
					font-weight: 500;
					margin-bottom: 8px;
					color: var(--fg-muted);
					font-size: 0.9em;
				}

				code {
					background: var(--bg);
					padding: 4px 8px;
					border-radius: 4px;
					font-family: monospace;
					font-size: 0.9em;
				}

				.payment-method {
					display: flex;
					align-items: center;
					gap: 8px;
				}
			}

			.raw-data {
				summary {
					cursor: pointer;
					font-weight: 500;
					padding: 8px 0;
					color: var(--accent);

					&:hover {
						text-decoration: underline;
					}
				}
			}
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