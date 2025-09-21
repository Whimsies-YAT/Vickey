<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 900px;">
		<div class="_gaps">
			<div class="stats">
				<div class="stat">
					<div class="label">{{ i18n.ts.totalLogs }}</div>
					<div class="value">{{ stats?.totalCount ?? 0 }}</div>
				</div>
				<div class="stat">
					<div class="label">{{ i18n.ts.maxEntries }}</div>
					<div class="value">{{ stats?.maxEntries ?? 0 }}</div>
				</div>
			</div>

			<div class="controls">
				<MkButton :disabled="loading" @click="() => refreshLogs()">
					<i class="ti ti-refresh"></i> {{ i18n.ts.refresh }}
				</MkButton>
				<MkButton danger :disabled="loading" @click="clearLogs">
					<i class="ti ti-trash"></i> {{ i18n.ts.remove }}
				</MkButton>
				<MkButton :class="{ active: autoRefresh }" @click="toggleAutoRefresh">
					<i class="ti ti-clock"></i> {{ autoRefresh ? (i18n.ts.stopAutoRefresh) : (i18n.ts.startAutoRefresh) }}
				</MkButton>
			</div>

			<div class="log-container">
				<MkLoading v-if="loading"/>
				<div v-else class="logs">
					<div
						v-for="log in logs"
						:key="log.id"
						class="log-entry"
						:class="{ stderr: log.type === 'stderr' }"
					>
						<span class="timestamp">{{ formatTime(log.timestamp) }}</span>
						<span class="type">{{ log.type }}</span>
						<span class="content">{{ sanitizeContent(log.content) }}</span>
					</div>
					<div v-if="logs.length === 0" class="empty">
						{{ i18n.ts.noLogs }}
					</div>
				</div>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

interface LogEntry {
	id: number;
	timestamp: string;
	type: 'stdout' | 'stderr';
	content: string;
}

interface LogStats {
	totalCount: number;
	maxEntries: number;
	oldestId: number;
	newestId: number;
}

const logs = ref<LogEntry[]>([]);
const stats = ref<LogStats | null>(null);
const loading = ref<boolean>(true);
const autoRefresh = ref<boolean>(false);
const refreshInterval = ref<number | null>(null);
const lastLogId = ref<number>(0);

const headerActions = computed(() => []);
const headerTabs = computed(() => []);

async function refreshLogs(sinceId: number | null = null) {
	try {
		if (sinceId === null) {
			loading.value = true;
		}

		const params: any = { count: 100 };
		if (sinceId) params.sinceId = sinceId;

		const response = await misskeyApi('admin/logs/show', params) as any;

		if (sinceId) {
			const newLogs = response.logs;
			if (newLogs.length > 0) {
				logs.value.push(...newLogs);
				if (logs.value.length > 1000) {
					logs.value = logs.value.slice(-1000);
				}

				window.setTimeout(() => {
					const logContainer = window.document.querySelector('.logs');
					if (logContainer) {
						logContainer.scrollTop = logContainer.scrollHeight;
					}
				}, 0);
			}
		} else {
			logs.value = response.logs;
		}

		stats.value = response.stats;

		if (logs.value.length > 0) {
			lastLogId.value = Math.max(...logs.value.map(log => log.id));
		}
	} catch (error) {
		os.alert({
			type: 'error',
			text: i18n.ts.somethingHappened,
		});
	} finally {
		if (sinceId === null) {
			loading.value = false;
		}
	}
}

async function clearLogs() {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts.clearLogsConfirm,
	});

	if (canceled) return;

	try {
		await misskeyApi('admin/logs/clear');
		logs.value = [];
		stats.value = { totalCount: 0, maxEntries: stats.value?.maxEntries ?? 0, oldestId: 0, newestId: 0 };
		os.success();
	} catch (error) {
		os.alert({
			type: 'error',
			text: i18n.ts.somethingHappened,
		});
	}
}

function toggleAutoRefresh() {
	autoRefresh.value = !autoRefresh.value;

	if (autoRefresh.value) {
		refreshInterval.value = window.setInterval(() => {
			refreshLogs(lastLogId.value);
		}, 2000) as any;
	} else {
		if (refreshInterval.value) {
			window.clearInterval(refreshInterval.value);
			refreshInterval.value = null;
		}
	}
}

function formatTime(timestamp: string): string {
	return new Date(timestamp).toLocaleTimeString();
}

function sanitizeContent(content: string): string {
	if (!content) return '';

	let sanitized = content.replace(/\x1b\[[0-9;]*m/g, '');

	sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

	sanitized = sanitized.replace(/�/g, '[?]');

	if (sanitized.length > 1000) {
		sanitized = sanitized.substring(0, 1000) + '...';
	}

	return sanitized;
}

onMounted(() => {
	refreshLogs();
});

onUnmounted(() => {
	if (refreshInterval.value) {
		window.clearInterval(refreshInterval.value);
	}
});

definePage(() => ({
	title: i18n.ts.systemLogs,
	icon: 'ti ti-file-text',
}));
</script>

<style lang="scss" scoped>
.stats {
	display: flex;
	gap: 1rem;

	.stat {
		flex: 1;
		padding: 1rem;
		background: var(--panel);
		border-radius: var(--radius);

		.label {
			font-size: 0.9rem;
			opacity: 0.7;
		}

		.value {
			font-size: 1.5rem;
			font-weight: bold;
			margin-top: 0.5rem;
		}
	}
}

.controls {
	display: flex;
	gap: 0.5rem;
	flex-wrap: wrap;

	.active {
		background: var(--accent) !important;
		color: var(--fgOnAccent) !important;
	}
}

.log-container {
	min-height: 400px;
	background: var(--bg);
	border: 1px solid var(--divider);
	border-radius: var(--radius);

	.logs {
		max-height: 600px;
		overflow-y: auto;
		font-family: monospace;
		font-size: 0.8rem;
		line-height: 1.4;

		.log-entry {
			display: flex;
			padding: 0.25rem 0.5rem;
			border-bottom: 1px solid var(--divider);

			&.stderr {
				background: var(--error);
				color: var(--fgOnError);
			}

			.timestamp {
				min-width: 80px;
				color: var(--accent);
				margin-right: 0.5rem;
			}

			.type {
				min-width: 60px;
				margin-right: 0.5rem;
				font-weight: bold;

				&::after {
					content: ':';
				}
			}

			.content {
				flex: 1;
				white-space: pre-wrap;
				word-break: break-all;
			}
		}

		.empty {
			display: flex;
			justify-content: center;
			align-items: center;
			height: 200px;
			opacity: 0.5;
		}
	}
}
</style>
