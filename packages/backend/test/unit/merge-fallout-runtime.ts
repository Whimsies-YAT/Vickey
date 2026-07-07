/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { EventBus } from '@/core/events/EventBus.js';
import { isBlockedPrivateIp } from '@/core/HttpRequestService.js';
import { VoiceCallService } from '@/core/VoiceCallService.js';
import { endpointNames, getEndpointParamDef } from '@/server/api/endpoint-metadata.js';
import EndpointEndpoint from '@/server/api/endpoints/endpoint.js';
import EndpointsEndpoint from '@/server/api/endpoints/endpoints.js';
import type { Config } from '@/config.js';
import type { DomainEvent } from '@/core/events/DomainEvent.js';
import type { MiMeta } from '@/models/Meta.js';

const telemetryCreateMock = vi.hoisted(() => vi.fn());

vi.mock('@/core/telemetry/adapters/SentryTelemetryAdapter.js', () => ({
	SentryTelemetryAdapter: {
		create: telemetryCreateMock,
	},
}));

function testEvent(type = 'MergeFalloutEvent'): DomainEvent {
	return {
		eventType: type,
		occurredAt: new Date('2026-07-07T00:00:00.000Z'),
		aggregateId: 'aggregate',
	};
}

class MemoryRedis {
	private readonly data = new Map<string, string>();

	public async get(key: string): Promise<string | null> {
		return this.data.get(key) ?? null;
	}

	public async setex(key: string, _ttl: number, value: string): Promise<'OK'> {
		this.data.set(key, value);
		return 'OK';
	}

	public async del(...keys: string[]): Promise<number> {
		let deleted = 0;
		for (const key of keys) {
			if (this.data.delete(key)) deleted++;
		}
		return deleted;
	}
}

function createVoiceCallService() {
	const redis = new MemoryRedis();
	const globalEventService = {
		publishMainStream: vi.fn(),
	};
	const cloudflareCallsService = {
		getIceServers: vi.fn(() => [{ urls: ['stun:example.com'] }]),
		getAppCredentials: vi.fn(),
		createSession: vi.fn(),
	};
	const notificationService = {
		createNotification: vi.fn(),
	};
	const idService = {
		gen: vi.fn(() => 'call-1'),
	};
	const meta = {
		enableCloudflareSfu: false,
		cloudflareSfuAppId: null,
		cloudflareSfuAppSecret: null,
		cloudflareAccountId: null,
		cloudflareApiToken: null,
	} as MiMeta;

	const service = new VoiceCallService(
		redis as never,
		meta,
		globalEventService as never,
		cloudflareCallsService as never,
		notificationService as never,
		idService as never,
	);

	return {
		service,
		globalEventService,
		cloudflareCallsService,
		notificationService,
	};
}

describe('merge fallout runtime contracts', () => {
	describe('allowedPrivateNetworks', () => {
		test('accepts CIDR entries from the official sample style', () => {
			expect(isBlockedPrivateIp('127.0.0.1', ['127.0.0.1/32'])).toBe(false);
			expect(isBlockedPrivateIp('127.0.0.2', ['127.0.0.1/32'])).toBe(true);
			expect(isBlockedPrivateIp('::1', ['::1/128'])).toBe(false);
			expect(isBlockedPrivateIp('8.8.8.8', ['127.0.0.1/32'])).toBe(false);
		});
	});

	describe('endpoint metadata', () => {
		test('keeps endpoint discovery executable without importing endpoint-list back', async () => {
			expect(endpointNames).toContain('endpoint');
			expect(endpointNames).toContain('endpoints');
			expect(endpointNames).toContain('ping');

			await expect(getEndpointParamDef('does-not-exist')).resolves.toBeNull();
			await expect(getEndpointParamDef('ping')).resolves.toMatchObject({
				type: 'object',
				properties: {},
				required: [],
			});

			const endpoints = new EndpointsEndpoint();
			await expect(endpoints.exec({}, null, null)).resolves.toContain('ping');

			const endpoint = new EndpointEndpoint();
			await expect(endpoint.exec({ endpoint: 'endpoint' }, null, null)).resolves.toEqual({
				params: [{ name: 'endpoint', type: 'String' }],
			});
			await expect(endpoint.exec({ endpoint: 'does-not-exist' }, null, null)).resolves.toBeNull();
		});
	});

	describe('EventBus', () => {
		test('runs higher priority handlers first and unsubscribe removes the right handler', () => {
			const eventBus = new EventBus();
			eventBus.setLogging(false);
			const calls: string[] = [];

			eventBus.subscribe('MergeFalloutEvent', () => {
				calls.push('low');
			}, {
				handlerId: 'low',
				priority: -1,
			});
			const unsubscribeHigh = eventBus.subscribe('MergeFalloutEvent', () => {
				calls.push('high');
			}, {
				handlerId: 'high',
				priority: 10,
			});

			eventBus.publish(testEvent());
			expect(calls).toEqual(['high', 'low']);

			unsubscribeHigh();
			eventBus.publish(testEvent());
			expect(calls).toEqual(['high', 'low', 'low']);
		});

		test('isolates handler errors from later handlers', () => {
			const eventBus = new EventBus();
			eventBus.setLogging(false);
			const calls: string[] = [];

			eventBus.subscribe('MergeFalloutEvent', () => {
				calls.push('broken');
				throw new Error('boom');
			}, { handlerId: 'broken', priority: 10 });
			eventBus.subscribe('MergeFalloutEvent', () => {
				calls.push('healthy');
			}, {
				handlerId: 'healthy',
				priority: 0,
			});

			expect(() => eventBus.publish(testEvent())).not.toThrow();
			expect(calls).toEqual(['broken', 'healthy']);
			expect(eventBus.getStats().totalErrors).toBe(1);
		});
	});

	describe('telemetry registry', () => {
		test('is a no-op when backend Sentry is not configured', async () => {
			const telemetry = await import('@/core/telemetry/telemetry-registry.js');
			await telemetry.initTelemetry({ sentryForBackend: null } as unknown as Config);

			expect(telemetry.startSpan('noop', () => 'ok')).toBe('ok');
			expect(() => telemetry.captureMessage('message', { level: 'error' })).not.toThrow();
			expect(telemetryCreateMock).not.toHaveBeenCalled();
		});

		test('replaces adapters on re-init and clears them on shutdown', async () => {
			const telemetry = await import('@/core/telemetry/telemetry-registry.js');
			const firstAdapter = {
				captureMessage: vi.fn(),
				startSpan: vi.fn((_name: string, fn: () => string) => `first:${fn()}`),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const secondAdapter = {
				captureMessage: vi.fn(),
				startSpan: vi.fn((_name: string, fn: () => string) => `second:${fn()}`),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			telemetryCreateMock
				.mockResolvedValueOnce(firstAdapter)
				.mockResolvedValueOnce(secondAdapter);

			const config = {
				sentryForBackend: {
					options: { dsn: 'https://example.invalid/1' },
					disabledIntegrations: [],
					enableNodeProfiling: false,
				},
			} as unknown as Config;

			await telemetry.initTelemetry(config);
			expect(telemetry.startSpan('span', () => 'value')).toBe('first:value');

			await telemetry.initTelemetry(config);
			expect(firstAdapter.shutdown).toHaveBeenCalledTimes(1);
			expect(telemetry.startSpan('span', () => 'value')).toBe('second:value');

			await telemetry.shutdownTelemetry();
			expect(secondAdapter.shutdown).toHaveBeenCalledTimes(1);

			telemetry.captureMessage('after-shutdown', { level: 'error' });
			expect(secondAdapter.captureMessage).not.toHaveBeenCalled();
		});
	});

	describe('VoiceCallService', () => {
		test('runs the P2P call lifecycle without Cloudflare SFU credentials', async () => {
			const {
				service,
				globalEventService,
				cloudflareCallsService,
				notificationService,
			} = createVoiceCallService();

			await expect(service.initiateCall('alice', 'alice', 'p2p')).resolves.toBeNull();

			const initiated = await service.initiateCall('alice', 'bob', 'p2p');
			expect(initiated).toEqual({
				callId: 'call-1',
				iceServers: [{ urls: ['stun:example.com'] }],
				mode: 'p2p',
				currentMode: 'p2p',
				sessionId: undefined,
			});
			expect(notificationService.createNotification).toHaveBeenCalledWith('bob', 'voiceCall', {}, 'alice');
			expect(globalEventService.publishMainStream).toHaveBeenCalledWith('bob', 'voiceCall', {
				type: 'incoming',
				callId: 'call-1',
				from: 'alice',
				mode: 'p2p',
				currentMode: 'p2p',
			});
			expect(cloudflareCallsService.createSession).not.toHaveBeenCalled();

			await expect(service.getCurrentCall('alice')).resolves.toMatchObject({
				callId: 'call-1',
				callerId: 'alice',
				recipientId: 'bob',
				status: 'ringing',
			});

			await expect(service.answerCall('call-1', 'alice')).resolves.toBeNull();
			await expect(service.answerCall('call-1', 'bob')).resolves.toEqual({
				iceServers: [{ urls: ['stun:example.com'] }],
				mode: 'p2p',
				currentMode: 'p2p',
				sessionId: undefined,
			});
			expect(globalEventService.publishMainStream).toHaveBeenCalledWith('alice', 'voiceCall', {
				type: 'answered',
				callId: 'call-1',
				by: 'bob',
			});

			await service.endCall('call-1', 'alice');
			expect(globalEventService.publishMainStream).toHaveBeenCalledWith('bob', 'voiceCall', {
				type: 'ended',
				callId: 'call-1',
				by: 'alice',
			});
			await expect(service.getCurrentCall('alice')).resolves.toBeNull();
			await expect(service.getCurrentCall('bob')).resolves.toBeNull();
		});
	});
});
