/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('user_recommendation_profile')
export class MiUserRecommendationProfile {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('jsonb', {
		default: '{}',
		comment: 'Interest categories with weights (0-1)',
	})
	public interestCategories: Record<string, number>;

	@Column('jsonb', {
		default: '{}',
		comment: 'Content type preferences (text, image, video, etc.)',
	})
	public contentTypePreferences: Record<string, number>;

	@Column('jsonb', {
		default: '{}',
		comment: 'Language preferences with weights',
	})
	public languagePreferences: Record<string, number>;

	@Column('jsonb', {
		default: '{}',
		comment: 'Topic preferences based on hashtags',
	})
	public topicPreferences: Record<string, number>;

	@Column('jsonb', {
		default: '{}',
		comment: 'User interaction patterns',
	})
	public interactionPatterns: {
		averageEngagementTime?: number;
		preferredPostLength?: number;
		reactionPatterns?: Record<string, number>;
		timeOfDayActivity?: Record<string, number>;
		dayOfWeekActivity?: Record<string, number>;
	};

	@Column('jsonb', {
		default: '{}',
		comment: 'Social graph preferences',
	})
	public socialPreferences: {
		followingInfluence?: number;
		mutualConnectionWeight?: number;
		popularityBias?: number;
		diversityPreference?: number;
	};

	@Column('real', {
		default: 0.5,
		comment: 'Exploration vs exploitation balance (0-1)',
	})
	public explorationFactor: number;

	@Column('real', {
		default: 0.7,
		comment: 'Recency preference weight (0-1)',
	})
	public recencyWeight: number;

	@Column('real', {
		default: 0.6,
		comment: 'Quality threshold for recommendations (0-1)',
	})
	public qualityThreshold: number;

	@Column('timestamp with time zone', {
		default: () => 'CURRENT_TIMESTAMP',
	})
	public createdAt: Date;

	@Column('timestamp with time zone', {
		default: () => 'CURRENT_TIMESTAMP',
	})
	public updatedAt: Date;

	@Column('timestamp with time zone', {
		nullable: true,
		comment: 'Last time profile was updated based on user behavior',
	})
	public lastLearningUpdate: Date | null;

	@Column('integer', {
		default: 0,
		comment: 'Number of interactions used for learning',
	})
	public learningDataPoints: number;

	@Column('real', {
		default: 0.5,
		comment: 'Confidence score of the profile (0-1)',
	})
	public confidenceScore: number;
}
