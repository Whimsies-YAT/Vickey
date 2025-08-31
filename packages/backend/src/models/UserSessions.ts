/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, Column } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from "@/models/User.js";
import { MiSignin } from "@/models/Signin.js";

@Entity('user_sessions')
@Index('idx_user_sessions_user_token', ['userId', 'token'])
@Index('idx_user_sessions_user_active', ['userId'], { where: `"isActive" = true` })
@Index('idx_user_sessions_user_valid_device', ['userId', 'deviceId', 'signInId', 'expiresAt'])
@Index('idx_user_sessions_token_active', ['token'], { unique: true, where: `"isActive" = true` })
@Index('idx_user_sessions_cleanup', ['isActive', 'expiresAt'])
@Index('idx_user_sessions_active_lastused', ['isActive', 'lastUsedAt'])
@Index('idx_user_sessions_risk_user_time', ['userId', 'createdAt', 'lastUsedAt'])
@Index('idx_user_sessions_risk_device', ['deviceId', 'createdAt'])
@Index('idx_user_sessions_risk_signin', ['signInId', 'userId'])
@Index('idx_user_sessions_risk_user_device', ['userId', 'deviceId', 'createdAt'])
export class MiUserSessions {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public userId: MiUser['id'];

	@Index('idx_user_sessions_token', ['token'], { unique: true })
	@Column('varchar', { nullable: false, unique: true })
	public token: string;

	@Column('varchar', { nullable: false })
	public deviceId: string;

	@Column(id())
	public signInId: MiSignin['id'];

	@Column('timestamp with time zone', { nullable: false, default: () => 'now()' })
	public createdAt: Date;

	@Index('idx_user_sessions_expires_at')
	@Column('timestamp with time zone', { nullable: false })
	public expiresAt: Date;

	@Column('timestamp with time zone', { nullable: false, default: () => 'now()' })
	public lastUsedAt: Date;

	@Column('boolean', { nullable: false, default: true })
	public isActive: boolean;

	@Index('idx_user_sessions_ip_gin', { synchronize: false })
	@Column('jsonb', { nullable: true })
	public ip: Array<{ address: string; count: number; lastSeen: Date }> | null;
}
