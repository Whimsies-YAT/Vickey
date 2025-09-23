<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<template #icon><i class="ti ti-credit-card"></i></template>
	<template #title>{{ i18n.ts._admin._payments.title }}</template>

	<div class="_spacer" style="--MI_SPACER-w: 1000px;">
		<div class="_gaps">
			<MkInfo v-if="!stripe.enabled">{{ i18n.ts._admin._payments.stripeNotEnabled }}</MkInfo>

			<template v-else>
				<div class="stats-grid">
					<div class="stat-card total-payments">
						<div class="stat-icon">
							<i class="ti ti-credit-card"></i>
						</div>
						<div class="stat-content">
							<div class="stat-number">
								<MkNumber :value="stats?.totalPayments || 0" />
							</div>
							<div class="stat-label">{{ i18n.ts._admin._payments.totalPayments }}</div>
						</div>
					</div>

					<div class="stat-card total-revenue">
						<div class="stat-icon">
							<i class="ti ti-currency-dollar"></i>
						</div>
						<div class="stat-content">
							<div class="stat-number">${{ ((stats?.totalAmount || 0) / 100).toFixed(2) }}</div>
							<div class="stat-label">{{ i18n.ts._admin._payments.totalRevenue }}</div>
						</div>
					</div>

					<div class="stat-card recent-payments">
						<div class="stat-icon">
							<i class="ti ti-clock"></i>
						</div>
						<div class="stat-content">
							<div class="stat-number">
								<MkNumber :value="stats?.recentPayments || 0" />
							</div>
							<div class="stat-label">{{ i18n.ts._admin._payments.recentPayments }}</div>
						</div>
					</div>

					<div class="stat-card successful-payments">
						<div class="stat-icon">
							<i class="ti ti-check"></i>
						</div>
						<div class="stat-content">
							<div class="stat-number">
								<MkNumber :value="stats?.statusBreakdown?.succeeded || 0" />
							</div>
							<div class="stat-label">{{ i18n.ts._admin._payments.successfulPayments }}</div>
						</div>
					</div>
				</div>

				<div class="filters">
					<MkInput v-model="userId" :placeholder="i18n.ts._admin._payments.filterByUser">
						<template #prefix><i class="ti ti-user"></i></template>
					</MkInput>

					<MkSelect v-model="statusFilter" :items="statusOptions">
						<template #label>{{ i18n.ts._admin._payments.status }}</template>
					</MkSelect>

					<MkButton @click="refreshPayments">
						<i class="ti ti-refresh"></i>
						{{ i18n.ts.refresh }}
					</MkButton>
				</div>

				<div class="payments-table">
					<MkLoading v-if="loading"/>
					<div v-else-if="payments.length === 0" class="empty">
						<i class="ti ti-credit-card-off"></i>
						<p>{{ i18n.ts._admin._payments.noPayments }}</p>
					</div>
					<div v-else class="table-container">
						<table class="payments-table-content">
							<thead>
								<tr>
									<th>{{ i18n.ts._admin._payments.paymentId }}</th>
									<th>{{ i18n.ts._admin._payments.user }}</th>
									<th>{{ i18n.ts._admin._payments.amount }}</th>
									<th>{{ i18n.ts._admin._payments.status }}</th>
									<th>{{ i18n.ts._admin._payments.description }}</th>
									<th>{{ i18n.ts._admin._payments.createdAt }}</th>
									<th>{{ i18n.ts._admin._payments.actions }}</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="payment in payments" :key="payment.id" class="payment-row">
									<td>
										<code class="payment-id">{{ payment.paymentIntentId.substring(0, 16) }}...</code>
									</td>
									<td>
										<div v-if="payment.user" class="user-info">
											<MkUserCardMini :user="payment.user"/>
										</div>
										<span v-else class="no-user">{{ i18n.ts._admin._payments.unknownUser }}</span>
									</td>
									<td>
										<div class="amount">
											<span class="value">{{ (payment.amount / 100).toFixed(2) }}</span>
											<span class="currency">{{ payment.currency.toUpperCase() }}</span>
										</div>
									</td>
									<td>
										<div :class="['status', payment.status]">
											<i :class="getStatusIcon(payment.status)"></i>
											{{ getStatusText(payment.status) }}
										</div>
									</td>
									<td>
										<span class="description">{{ payment.description || i18n.ts._admin._payments.noDescription }}</span>
									</td>
									<td>
										<MkTime :time="payment.createdAt"/>
									</td>
									<td>
										<MkButton size="small" @click="showPaymentDetail(payment.id)">
											<i class="ti ti-eye"></i>
											{{ i18n.ts._admin._payments.viewDetails }}
										</MkButton>
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<div v-if="hasMore" class="load-more">
						<MkButton :loading="loadingMore" @click="loadMore">
							{{ i18n.ts.loadMore }}
						</MkButton>
					</div>
				</div>
			</template>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import {computed, onMounted, ref, watch} from 'vue';
import {definePage} from '@/page.js';
import {misskeyApi} from '@/utility/misskey-api.js';
import {i18n} from '@/i18n.js';
import * as os from '@/os.js';
import MkInfo from '@/components/MkInfo.vue';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkUserCardMini from '@/components/MkUserCardMini.vue';
import MkNumber from "@/components/MkNumber.vue";

const loading = ref(true);
const loadingMore = ref(false);
const payments = ref<any[]>([]);
const stats = ref<any>(null);
const hasMore = ref(true);
const untilId = ref(null);

const userId = ref('');
const statusFilter = ref('');

const stripe = ref({ enabled: false });

const statusOptions = computed(() => [
	{ value: '', label: i18n.ts._admin._payments.allStatuses },
	{ value: 'succeeded', label: i18n.ts._admin._payments.succeeded },
	{ value: 'pending', label: i18n.ts._admin._payments.pending },
	{ value: 'failed', label: i18n.ts._admin._payments.failed },
	{ value: 'canceled', label: i18n.ts._admin._payments.canceled }
]);

const headerActions = computed(() => [
	{
		icon: 'ti ti-refresh',
		text: i18n.ts.refresh,
		handler: refreshPayments,
	},
]);

const headerTabs = computed(() => []);

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

const loadPayments = async (reset = false) => {
	if (reset) {
		loading.value = true;
		payments.value = [];
		untilId.value = null;
		hasMore.value = true;
	} else {
		loadingMore.value = true;
	}

	try {
		const params: any = { limit: 30 };
		if (untilId.value) params.untilId = untilId.value;
		if (statusFilter.value) params.status = statusFilter.value;
		if (userId.value) params.userId = userId.value;

		const result = await misskeyApi('admin/payments/list', params) as any[];

		if (reset) {
			payments.value = result;
		} else {
			payments.value.push(...result);
		}

		hasMore.value = result.length === 30;
		if (result.length > 0) {
			untilId.value = result[result.length - 1].id;
		}
	} catch (error) {
		console.error('Failed to load payments:', error);
		os.alert({
			type: 'error',
			text: i18n.ts._admin._payments.loadError,
		});
	} finally {
		loading.value = false;
		loadingMore.value = false;
	}
};

const loadStats = async () => {
	try {
		stats.value = await misskeyApi('admin/payments/stats', {}) as any;
	} catch (error) {
		console.error('Failed to load payment stats:', error);
	}
};

const loadMore = () => {
	if (!loadingMore.value && hasMore.value) {
		loadPayments(false);
	}
};

const refreshPayments = () => {
	loadPayments(true);
	loadStats();
};

const showPaymentDetail = async (paymentId: string) => {
	try {
		const payment = await misskeyApi('admin/payments/show', { paymentId });

		os.popup(import('@/components/MkPaymentDetailDialog.vue').then(x => x.default), {
			payment,
		}, {
			closed: () => {
			},
		});
	} catch (error) {
		console.error('Failed to load payment details:', error);
		os.alert({
			type: 'error',
			text: i18n.ts._admin._payments.loadDetailError,
		});
	}
};

const checkStripeConfig = async () => {
	try {
		stripe.value = await misskeyApi('payment/get-config', {}) as { enabled: boolean; publicKey?: string | null };
	} catch (error) {
		console.error('Failed to check Stripe config:', error);
	}
};

watch([userId, statusFilter], () => {
	loadPayments(true);
});

onMounted(() => {
	checkStripeConfig();
	loadPayments(true);
	loadStats();
});

definePage(() => ({
	title: i18n.ts._admin._payments.title,
	icon: 'ti ti-credit-card',
}));
</script>

<style lang="scss" scoped>
.stats-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
	gap: 12px;
	margin-bottom: 20px;
}

.stat-card {
	background: var(--MI_THEME-panel);
	border-radius: 10px;
	padding: 12px;
	display: flex;
	align-items: center;
	gap: 12px;
	border: 1px solid var(--MI_THEME-divider);
	transition: all 0.2s ease;
	cursor: default;
	min-height: auto;

	&:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
		border-color: var(--MI_THEME-accent);
	}

	.stat-icon {
		width: 40px;
		height: 40px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 20px;
		flex-shrink: 0;
		transition: all 0.3s ease;
	}

	.stat-content {
		flex: 1;
		min-width: 0;

		.stat-number {
			font-size: 20px;
			font-weight: 600;
			margin-bottom: 2px;
			line-height: 1.2;
			transition: all 0.3s ease;
		}

		.stat-label {
			color: var(--MI_THEME-fgTransparent);
			font-size: 0.85em;
			font-weight: 500;
			line-height: 1.3;
		}
	}

	&.total-payments {
		.stat-icon {
			background: var(--MI_THEME-accentedBg);
			color: var(--MI_THEME-accent);
		}
		&:hover .stat-icon {
			background: #0088d726;
			color: #3d96c1;
		}
	}

	&.total-revenue {
		.stat-icon {
			background: #22c55e26;
			color: #22c55e;
		}
		&:hover .stat-icon {
			background: #22c55e40;
		}
	}

	&.recent-payments {
		.stat-icon {
			background: #e96b0026;
			color: #d76d00;
		}
		&:hover .stat-icon {
			background: #e96b0040;
		}
	}

	&.successful-payments {
		.stat-icon {
			background: #86b30026;
			color: #86b300;
		}
		&:hover .stat-icon {
			background: #86b30040;
		}
	}
}

.filters {
	display: grid;
	grid-template-columns: 1fr 200px auto;
	gap: 16px;
	margin-bottom: 24px;
	align-items: end;

	@media (max-width: 768px) {
		grid-template-columns: 1fr;
		gap: 12px;
	}
}

.payments-table {
	background: var(--MI_THEME-panel);
	border-radius: 8px;
	overflow: hidden;
	border: 1px solid var(--MI_THEME-divider);

	.empty {
		text-align: center;
		padding: 40px 20px;
		color: var(--MI_THEME-fgTransparent);

		i {
			font-size: 48px;
			margin-bottom: 16px;
			display: block;
		}
	}

	.table-container {
		overflow-x: auto;
	}

	.payments-table-content {
		width: 100%;
		border-collapse: collapse;

		th {
			background: var(--MI_THEME-bg);
			padding: 12px 16px;
			text-align: left;
			font-weight: 600;
			border-bottom: 1px solid var(--MI_THEME-divider);
			white-space: nowrap;
		}

		td {
			padding: 12px 16px;
			border-bottom: 1px solid var(--MI_THEME-divider);
			vertical-align: middle;
		}

		.payment-row {
			&:hover {
				background: var(--MI_THEME-bg);
			}
		}

		.payment-id {
			font-family: monospace;
			background: var(--MI_THEME-bg);
			padding: 4px 8px;
			border-radius: 4px;
			font-size: 0.9em;
		}

		.user-info {
			display: flex;
			align-items: center;
			gap: 8px;
		}

		.no-user {
			color: var(--MI_THEME-fgTransparent);
			font-style: italic;
		}

		.amount {
			.value {
				font-weight: 600;
				font-size: 1.1em;
			}

			.currency {
				color: var(--MI_THEME-fgTransparent);
				margin-left: 4px;
				text-transform: uppercase;
				font-size: 0.9em;
			}
		}

		.status {
			display: flex;
			align-items: center;
			gap: 6px;
			font-weight: 500;

			&.succeeded {
				color: var(--MI_THEME-success);
			}

			&.pending {
				color: var(--MI_THEME-warn);
			}

			&.failed, &.canceled {
				color: var(--MI_THEME-error);
			}
		}

		.description {
			max-width: 200px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.load-more {
		padding: 20px;
		text-align: center;
		border-top: 1px solid var(--MI_THEME-divider);
	}
}
</style>
