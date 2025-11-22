/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { UserSessionsRepository, SigninsRepository } from '@/models/_.js';
import type { MiUserSessions } from '@/models/UserSessions.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { IP2LocationService } from '@/core/IP2LocationService.js';

@Injectable()
export class UserSessionEntityService {
	constructor(
		@Inject(DI.userSessionsRepository)
		private userSessionsRepository: UserSessionsRepository,

		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		private idService: IdService,
		private ip2LocationService: IP2LocationService,
	) {
	}

	@bindThis
	private parseDeviceId(deviceId: string): { type: string; name: string } {
		const prefix = deviceId.charAt(0);
		switch (prefix) {
			case 'M':
				return { type: 'mobile', name: 'Mobile' };
			case 'P':
				return { type: 'desktop', name: 'Desktop' };
			case 'C':
				return { type: 'console', name: 'Console' };
			default:
				return { type: 'unknown', name: 'Unknown Device' };
		}
	}

	@bindThis
	private parseUserAgent(userAgent?: string): { browser?: string; os?: string; device?: string } {
		if (!userAgent) return {};

		const result: { browser?: string; os?: string; device?: string } = {};

		if (userAgent.includes('Firefox/')) {
			result.browser = 'Firefox';
		} else if (userAgent.includes('Edg/')) {
			result.browser = 'Edge';
		} else if (userAgent.includes('Chrome/')) {
			result.browser = 'Chrome';
		} else if (userAgent.includes('Safari/') && !userAgent.includes('Chrome')) {
			result.browser = 'Safari';
		}

		if (userAgent.includes('Windows')) {
			result.os = 'Windows';
		} else if (userAgent.includes('Mac OS X')) {
			result.os = 'macOS';
		} else if (userAgent.includes('Linux')) {
			result.os = 'Linux';
		} else if (userAgent.includes('Android')) {
			result.os = 'Android';
		} else if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) {
			result.os = 'iOS';
		}

		if (userAgent.includes('iPhone')) {
			result.device = 'iPhone';
		} else if (userAgent.includes('iPad')) {
			result.device = 'iPad';
		} else if (userAgent.includes('Android')) {
			result.device = 'Android';
		}

		return result;
	}

	@bindThis
	private formatDeviceName(deviceId: string, userAgent?: string): string {
		const device = this.parseDeviceId(deviceId);
		const ua = this.parseUserAgent(userAgent);

		const parts: string[] = [];

		if (ua.device) {
			parts.push(ua.device);
		} else {
			parts.push(device.name);
		}

		if (ua.browser) {
			parts.push(ua.browser);
		}

		if (ua.os) {
			parts.push(`on ${ua.os}`);
		}

		return parts.join(' · ') || device.name;
	}

	@bindThis
	private async formatLocation(ipData: Array<{ address: string; count: number; lastSeen: Date }> | null): Promise<{ ip: string; location: string }> {
		if (!ipData || ipData.length === 0) {
			return { ip: '-', location: '-' };
		}

		const primaryIp = ipData[0].address;
		const locationInfo = await this.ip2LocationService.checkLocation(primaryIp);

		if (locationInfo.length === 0) {
			return { ip: primaryIp, location: '-' };
		}

		const city = locationInfo[5];
		const region = locationInfo[4];
		const countryCode = locationInfo[2];

		const locationParts: string[] = [];
		if (city && city !== '-') locationParts.push(city);
		if (region && region !== '-') locationParts.push(region);
		if (countryCode && countryCode !== '-') locationParts.push(countryCode);

		return {
			ip: primaryIp,
			location: locationParts.length > 0 ? locationParts.join(', ') : '-',
		};
	}

	@bindThis
	public async pack(
		src: MiUserSessions['id'] | MiUserSessions,
		options?: {
			currentToken?: string;
		},
	) {
		const session = typeof src === 'object' ? src : await this.userSessionsRepository.findOneByOrFail({ id: src });

		const signin = await this.signinsRepository.findOneBy({ id: session.signInId });
		const userAgent = signin?.headers?.['user-agent'] as string | undefined;

		const { ip, location } = await this.formatLocation(session.ip);

		return {
			id: session.id,
			createdAt: this.idService.parse(session.id).date.toISOString(),
			lastUsedAt: session.lastUsedAt.toISOString(),
			deviceId: session.deviceId,
			deviceName: this.formatDeviceName(session.deviceId, userAgent),
			deviceType: this.parseDeviceId(session.deviceId).type,
			ip,
			location,
			isCurrent: options?.currentToken ? session.token === options.currentToken : false,
		};
	}

	@bindThis
	public async packMany(
		sessions: MiUserSessions[],
		options?: {
			currentToken?: string;
		},
	) {
		return Promise.all(sessions.map(session => this.pack(session, options)));
	}
}