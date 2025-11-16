/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import * as Reversi from 'misskey-reversi';
import type { MiChannel } from '@/models/Channel.js';
import type { MiUser } from '@/models/User.js';
import type { MiUserProfile } from '@/models/UserProfile.js';
import type { MiNote } from '@/models/Note.js';
import type { MiAntenna } from '@/models/Antenna.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import type { MiDriveFolder } from '@/models/DriveFolder.js';
import type { MiUserList } from '@/models/UserList.js';
import type { MiAbuseUserReport } from '@/models/AbuseUserReport.js';
import type { MiSignin } from '@/models/Signin.js';
import type { MiPage } from '@/models/Page.js';
import type { MiWebhook } from '@/models/Webhook.js';
import type { MiSystemWebhook } from '@/models/SystemWebhook.js';
import type { MiMeta } from '@/models/Meta.js';
import { MiAvatarDecoration, MiChatMessage, MiChatRoom, MiGomokuGame, MiReversiGame, MiRole, MiRoleAssignment, MiWerewolfGame } from '@/models/_.js';
import type { WerewolfPlayer } from '@/models/WerewolfGame.js';
import type { Packed } from '@/misc/json-schema.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import { Serialized } from '@/types.js';
import type Emitter from 'strict-event-emitter-types';
import type { EventEmitter } from 'events';

//#region Stream type-body definitions
export interface BroadcastTypes {
	emojiAdded: {
		emoji: Packed<'EmojiDetailed'>;
	};
	emojiUpdated: {
		emojis: Packed<'EmojiDetailed'>[];
	};
	emojiDeleted: {
		emojis: {
			id?: string;
			name: string;
			[other: string]: any;
		}[];
	};
	announcementCreated: {
		announcement: Packed<'Announcement'>;
	};
}

export interface MainEventTypes {
	notification: Packed<'Notification'>;
	mention: Packed<'Note'>;
	reply: Packed<'Note'>;
	renote: Packed<'Note'>;
	follow: Packed<'UserDetailedNotMe'>;
	followed: Packed<'UserLite'>;
	unfollow: Packed<'UserDetailedNotMe'>;
	meUpdated: Packed<'MeDetailed'>;
	pageEvent: {
		pageId: MiPage['id'];
		event: string;
		var: any;
		userId: MiUser['id'];
		user: Packed<'UserDetailed'>;
	};
	urlUploadFinished: {
		marker?: string | null;
		file: Packed<'DriveFile'>;
	};
	readAllNotifications: undefined;
	notificationFlushed: undefined;
	notificationDeleted: {
		notificationId: string;
		type: string;
		notifierId?: string | null;
		reaction?: string | null;
		noteId?: string | null;
		targetNoteId?: string | null;
	};
	unreadNotification: Packed<'Notification'>;
	unreadAntenna: MiAntenna;
	newChatMessage: Packed<'ChatMessage'>;
	readAllAnnouncements: undefined;
	myTokenRegenerated: undefined;
	signin: {
		id: MiSignin['id'];
		createdAt: string;
		ip: string;
		headers: Record<string, any>;
		success: boolean;
	};
	registryUpdated: {
		scope?: string[];
		key: string;
		value: any | null;
	};
	driveFileCreated: Packed<'DriveFile'>;
	readAntenna: MiAntenna;
	receiveFollowRequest: Packed<'UserLite'>;
	announcementCreated: {
		announcement: Packed<'Announcement'>;
	};
	voiceCall: {
		type: 'incoming' | 'initiated' | 'answered' | 'ready' | 'rejected' | 'ended' | 'signal' | 'error' | 'tracksAnswered' | 'readyToPull' | 'pullAnswered' | 'pullCompleted' | 'switchToSfu' | 'groupMemberJoined' | 'groupMemberLeft';
		callId?: string;
		from?: MiUser['id'];
		by?: MiUser['id'];
		mode?: 'auto' | 'p2p' | 'sfu';
		currentMode?: 'p2p' | 'sfu';
		signalType?: 'iceCandidate' | 'offer' | 'answer';
		signalData?: any;
		iceServers?: RTCIceServer[];
		sessionId?: string;
		answer?: any;
		message?: string;
		userId?: MiUser['id'];
	};
}

export interface DriveEventTypes {
	fileCreated: Packed<'DriveFile'>;
	fileDeleted: MiDriveFile['id'];
	fileUpdated: Packed<'DriveFile'>;
	folderCreated: Packed<'DriveFolder'>;
	folderDeleted: MiDriveFolder['id'];
	folderUpdated: Packed<'DriveFolder'>;
}

export interface NoteEventTypes {
	pollVoted: {
		choice: number;
		userId: MiUser['id'];
	};
	deleted: {
		deletedAt: Date;
	};
	updated: {
		cw: string | null;
		text: string;
	};
	reacted: {
		reaction: string;
		emoji?: {
			name: string;
			url: string;
		} | null;
		userId: MiUser['id'];
	};
	unreacted: {
		reaction: string;
		userId: MiUser['id'];
	};
}
type NoteStreamEventTypes = {
	[key in keyof NoteEventTypes]: {
		id: MiNote['id'];
		body: NoteEventTypes[key];
	};
};

export interface UserListEventTypes {
	userAdded: Packed<'UserLite'>;
	userRemoved: Packed<'UserLite'>;
}

export interface AntennaEventTypes {
	note: MiNote;
}

export interface RoleTimelineEventTypes {
	note: Packed<'Note'>;
}

export interface AdminEventTypes {
	newAbuseUserReport: {
		id: MiAbuseUserReport['id'];
		targetUserId: MiUser['id'],
		reporterId: MiUser['id'],
		comment: string;
	};
}

export interface ChatEventTypes {
	message: Packed<'ChatMessageLite'>;
	deleted: Packed<'ChatMessageLite'>['id'];
	react: {
		reaction: string;
		user?: Packed<'UserLite'>;
		messageId: MiChatMessage['id'];
	};
	unreact: {
		reaction: string;
		user?: Packed<'UserLite'>;
		messageId: MiChatMessage['id'];
	};
}

export interface ReversiEventTypes {
	matched: {
		game: Packed<'ReversiGameDetailed'>;
	};
	invited: {
		user: Packed<'User'>;
	};
}

export interface ReversiGameEventTypes {
	changeReadyStates: {
		user1: boolean;
		user2: boolean;
	};
	updateSettings: {
		userId: MiUser['id'];
		key: string;
		value: any;
	};
	log: Reversi.Serializer.Log & { id: string | null };
	started: {
		game: Packed<'ReversiGameDetailed'>;
	};
	ended: {
		winnerId: MiUser['id'] | null;
		game: Packed<'ReversiGameDetailed'>;
	};
	canceled: {
		userId: MiUser['id'];
	};
}

export interface GomokuEventTypes {
	matched: {
		game: Packed<'GomokuGameDetailed'>;
	};
	invited: {
		user: Packed<'User'>;
	};
}

export interface GomokuGameEventTypes {
	changeReadyStates: {
		user1: boolean;
		user2: boolean;
	};
	log: [number, number];
	started: {
		game: Packed<'GomokuGameDetailed'>;
	};
	ended: {
		winnerId: MiUser['id'] | null;
		game: Packed<'GomokuGameDetailed'>;
	};
	canceled: {
		userId: MiUser['id'];
	};
}

export interface WerewolfEventTypes {
	matched: {
		game: Packed<'WerewolfGameDetailed'>;
	};
	invited: {
		user: Packed<'User'>;
	};
	canceled: {
		game: Packed<'WerewolfGameLite'>;
	};
}

export interface WerewolfGameEventTypes {
	playerJoined: {
		userId: MiUser['id'];
	};
	playerLeft: {
		userId: MiUser['id'];
	};
	readyChanged: {
		userId: MiUser['id'];
		ready: boolean;
	};
	playerReady: {
		userId: MiUser['id'];
		readyPlayers: MiUser['id'][];
	};
	playerUnready: {
		userId: MiUser['id'];
		readyPlayers: MiUser['id'][];
	};
	countdownStarted: {
		countdownStartedAt: Date;
	};
	countdownTick: {
		remaining: number;
	};
	countdownCancelled: Record<string, never>;
	playerKicked: {
		userId: MiUser['id'];
		reason: string;
	};
	started: {
		game: Packed<'WerewolfGameDetailed'>;
	};
	gameStarted: {
		game: Packed<'WerewolfGameDetailed'>;
	};
	seatChanged: {
		seats: any[];
		players?: any[];
		userId?: MiUser['id'];
		seatNumber?: number | null;
	};
	phaseChanged: {
		phase: string;
		phaseCount?: number;
		dayNumber?: number;
		voicePermissions?: Record<string, boolean>;
	};
	subPhaseChanged: {
		subPhase: string;
		voicePermissions?: Record<string, boolean>;
	};
	speakerChanged: {
		userId: MiUser['id'] | null;
		timeLimit?: number;
		isTestament?: boolean;
	};
	speechTimeUpdate: {
		remaining: number;
	};
	discussionEnded: Record<string, never>;
	testamentNext: {
		userId: MiUser['id'];
	};
	playerDied: {
		userId: MiUser['id'];
		reason: string;
		revealRole?: boolean;
		role?: string;
		players?: WerewolfPlayer[];
	};
	transitionDelay: {
		type: 'death_announcement' | 'speech_transition' | 'discussion_to_voting' | 'voting_results';
		duration: number;
		[key: string]: any;
	};
	actionPerformed: {
		userId: MiUser['id'];
		action: string;
	};
	message: {
		channel: string;
		userId: MiUser['id'];
		message: string;
		timestamp: Date;
	};
	ended: {
		winnerTeam: string | null;
		game: Packed<'WerewolfGameDetailed'>;
	};
	gameEnded: {
		winnerTeam: string | null;
		game: Packed<'WerewolfGameDetailed'>;
	};
	canceled: {
		userId: MiUser['id'];
	};
	gameCanceled: Record<string, never>;
	voiceTrackReady: {
		userId: MiUser['id'];
		sessionId: string;
		trackName: string;
	};
	voiceTrackAdded: {
		userId: MiUser['id'];
	};
	votingTied: {
		round: number;
		tiedPlayers: MiUser['id'][];
	};
	secondRoundDiscussionStarted: {
		tiedPlayers: MiUser['id'][];
		speechOrder: MiUser['id'][] | null;
	};
	nightPhaseTimeUpdate: {
		role: string;
		subPhase: string;
		elapsed: number;
		remaining: number;
		total: number;
	};
	witchTimeWindowUpdate: {
		window: string;
		windowRemaining: number;
		allowedActions: string[];
		uiState: Record<string, any>;
		hasSubmitted: boolean;
	};
	votingTimeUpdate: {
		elapsed: number;
		remaining: number;
		total: number;
		round: number;
	};
}
//#endregion

// 辞書(interface or type)から{ type, body }ユニオンを定義
// https://stackoverflow.com/questions/49311989/can-i-infer-the-type-of-a-value-using-extends-keyof-type
// VS Codeの展開を防止するためにEvents型を定義
type Events<T extends object> = { [K in keyof T]: { type: K; body: T[K]; } };
type EventUnionFromDictionary<
	T extends object,
	U = Events<T>,
> = U[keyof U];

type SerializedAll<T> = {
	[K in keyof T]: Serialized<T[K]>;
};

type UndefinedAsNullAll<T> = {
	[K in keyof T]: T[K] extends undefined ? null : T[K];
};

export interface InternalEventTypes {
	userChangeSuspendedState: { id: MiUser['id']; isSuspended: MiUser['isSuspended']; };
	userChangeDeletedState: { id: MiUser['id']; isDeleted: MiUser['isDeleted']; };
	userTokenRegenerated: { id: MiUser['id']; oldToken: string; newToken: string; };
	remoteUserUpdated: { id: MiUser['id']; };
	localUserUpdated: { id: MiUser['id']; };
	follow: { followerId: MiUser['id']; followeeId: MiUser['id']; };
	unfollow: { followerId: MiUser['id']; followeeId: MiUser['id']; };
	blockingCreated: { blockerId: MiUser['id']; blockeeId: MiUser['id']; };
	blockingDeleted: { blockerId: MiUser['id']; blockeeId: MiUser['id']; };
	policiesUpdated: MiRole['policies'];
	roleCreated: MiRole;
	roleDeleted: MiRole;
	roleUpdated: MiRole;
	userRoleAssigned: MiRoleAssignment;
	userRoleUnassigned: MiRoleAssignment;
	webhookCreated: MiWebhook;
	webhookDeleted: MiWebhook;
	webhookUpdated: MiWebhook;
	systemWebhookCreated: MiSystemWebhook;
	systemWebhookDeleted: MiSystemWebhook;
	systemWebhookUpdated: MiSystemWebhook;
	antennaCreated: MiAntenna;
	antennaDeleted: MiAntenna;
	antennaUpdated: MiAntenna;
	avatarDecorationCreated: MiAvatarDecoration;
	avatarDecorationDeleted: MiAvatarDecoration;
	avatarDecorationUpdated: MiAvatarDecoration;
	metaUpdated: { before?: MiMeta; after: MiMeta; };
	followChannel: { userId: MiUser['id']; channelId: MiChannel['id']; };
	unfollowChannel: { userId: MiUser['id']; channelId: MiChannel['id']; };
	muteChannel: { userId: MiUser['id']; channelId: MiChannel['id']; };
	unmuteChannel: { userId: MiUser['id']; channelId: MiChannel['id']; };
	updateUserProfile: MiUserProfile;
	mute: { muterId: MiUser['id']; muteeId: MiUser['id']; };
	unmute: { muterId: MiUser['id']; muteeId: MiUser['id']; };
	userListMemberAdded: { userListId: MiUserList['id']; memberId: MiUser['id']; };
	userListMemberRemoved: { userListId: MiUserList['id']; memberId: MiUser['id']; };
	noteDeleted: { noteId: MiNote['id']; };
}

type EventTypesToEventPayload<T> = EventUnionFromDictionary<UndefinedAsNullAll<SerializedAll<T>>>;

// name/messages(spec) pairs dictionary
export type GlobalEvents = {
	internal: {
		name: 'internal';
		payload: EventTypesToEventPayload<InternalEventTypes>;
	};
	broadcast: {
		name: 'broadcast';
		payload: EventTypesToEventPayload<BroadcastTypes>;
	};
	main: {
		name: `mainStream:${MiUser['id']}`;
		payload: EventTypesToEventPayload<MainEventTypes>;
	};
	drive: {
		name: `driveStream:${MiUser['id']}`;
		payload: EventTypesToEventPayload<DriveEventTypes>;
	};
	note: {
		name: `noteStream:${MiNote['id']}`;
		payload: EventTypesToEventPayload<NoteStreamEventTypes>;
	};
	userList: {
		name: `userListStream:${MiUserList['id']}`;
		payload: EventTypesToEventPayload<UserListEventTypes>;
	};
	roleTimeline: {
		name: `roleTimelineStream:${MiRole['id']}`;
		payload: EventTypesToEventPayload<RoleTimelineEventTypes>;
	};
	antenna: {
		name: `antennaStream:${MiAntenna['id']}`;
		payload: EventTypesToEventPayload<AntennaEventTypes>;
	};
	admin: {
		name: `adminStream:${MiUser['id']}`;
		payload: EventTypesToEventPayload<AdminEventTypes>;
	};
	notes: {
		name: 'notesStream';
		payload: Serialized<Packed<'Note'>>;
	};
	chatUser: {
		name: `chatUserStream:${MiUser['id']}-${MiUser['id']}`;
		payload: EventTypesToEventPayload<ChatEventTypes>;
	};
	chatRoom: {
		name: `chatRoomStream:${MiChatRoom['id']}`;
		payload: EventTypesToEventPayload<ChatEventTypes>;
	};
	reversi: {
		name: `reversiStream:${MiUser['id']}`;
		payload: EventTypesToEventPayload<ReversiEventTypes>;
	};
	reversiGame: {
		name: `reversiGameStream:${MiReversiGame['id']}`;
		payload: EventTypesToEventPayload<ReversiGameEventTypes>;
	};
	gomoku: {
		name: `gomokuStream:${MiUser['id']}`;
		payload: EventTypesToEventPayload<GomokuEventTypes>;
	};
	gomokuGame: {
		name: `gomokuGameStream:${MiGomokuGame['id']}`;
		payload: EventTypesToEventPayload<GomokuGameEventTypes>;
	};
	werewolf: {
		name: `werewolfStream:${MiUser['id']}`;
		payload: EventTypesToEventPayload<WerewolfEventTypes>;
	};
	werewolfLobby: {
		name: 'werewolfLobbyStream';
		payload: EventTypesToEventPayload<WerewolfEventTypes>;
	};
	werewolfGame: {
		name: `werewolfGameStream:${MiWerewolfGame['id']}`;
		payload: EventTypesToEventPayload<WerewolfGameEventTypes>;
	};
};

// API event definitions
// ストリームごとのEmitterの辞書を用意
type EventEmitterDictionary = { [x in keyof GlobalEvents]: Emitter.default<EventEmitter, { [y in GlobalEvents[x]['name']]: (e: GlobalEvents[x]['payload']) => void }> };
// 共用体型を交差型にする型 https://stackoverflow.com/questions/54938141/typescript-convert-union-to-intersection
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;
// Emitter辞書から共用体型を作り、UnionToIntersectionで交差型にする
export type StreamEventEmitter = UnionToIntersection<EventEmitterDictionary[keyof GlobalEvents]>;
// { [y in name]: (e: spec) => void }をまとめてその交差型をEmitterにかけるとts(2590)にひっかかる

// provide stream channels union
export type StreamChannels = GlobalEvents[keyof GlobalEvents]['name'];

@Injectable()
export class GlobalEventService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redisForPub)
		private redisForPub: Redis.Redis,
	) {
	}

	@bindThis
	private publish(channel: StreamChannels, type: string | null, value?: any): void {
		const message = type == null ? value : value == null ?
			{ type: type, body: null } :
			{ type: type, body: value };

		this.redisForPub.publish(this.config.host, JSON.stringify({
			channel: channel,
			message: message,
		}));
	}

	@bindThis
	public publishInternalEvent<K extends keyof InternalEventTypes>(type: K, value?: InternalEventTypes[K]): void {
		this.publish('internal', type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishBroadcastStream<K extends keyof BroadcastTypes>(type: K, value?: BroadcastTypes[K]): void {
		this.publish('broadcast', type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishMainStream<K extends keyof MainEventTypes>(userId: MiUser['id'], type: K, value?: MainEventTypes[K]): void {
		this.publish(`mainStream:${userId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishDriveStream<K extends keyof DriveEventTypes>(userId: MiUser['id'], type: K, value?: DriveEventTypes[K]): void {
		this.publish(`driveStream:${userId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishNoteStream<K extends keyof NoteEventTypes>(noteId: MiNote['id'], type: K, value?: NoteEventTypes[K]): void {
		this.publish(`noteStream:${noteId}`, type, {
			id: noteId,
			body: value,
		});
	}

	@bindThis
	public publishUserListStream<K extends keyof UserListEventTypes>(listId: MiUserList['id'], type: K, value?: UserListEventTypes[K]): void {
		this.publish(`userListStream:${listId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishAntennaStream<K extends keyof AntennaEventTypes>(antennaId: MiAntenna['id'], type: K, value?: AntennaEventTypes[K]): void {
		this.publish(`antennaStream:${antennaId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishRoleTimelineStream<K extends keyof RoleTimelineEventTypes>(roleId: MiRole['id'], type: K, value?: RoleTimelineEventTypes[K]): void {
		this.publish(`roleTimelineStream:${roleId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishNotesStream(note: Packed<'Note'>): void {
		this.publish('notesStream', null, note);
	}

	@bindThis
	public publishAdminStream<K extends keyof AdminEventTypes>(userId: MiUser['id'], type: K, value?: AdminEventTypes[K]): void {
		this.publish(`adminStream:${userId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishChatUserStream<K extends keyof ChatEventTypes>(fromUserId: MiUser['id'], toUserId: MiUser['id'], type: K, value?: ChatEventTypes[K]): void {
		this.publish(`chatUserStream:${fromUserId}-${toUserId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishChatRoomStream<K extends keyof ChatEventTypes>(toRoomId: MiChatRoom['id'], type: K, value?: ChatEventTypes[K]): void {
		this.publish(`chatRoomStream:${toRoomId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishReversiStream<K extends keyof ReversiEventTypes>(userId: MiUser['id'], type: K, value?: ReversiEventTypes[K]): void {
		this.publish(`reversiStream:${userId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishReversiGameStream<K extends keyof ReversiGameEventTypes>(gameId: MiReversiGame['id'], type: K, value?: ReversiGameEventTypes[K]): void {
		this.publish(`reversiGameStream:${gameId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishGomokuStream<K extends keyof GomokuEventTypes>(userId: MiUser['id'], type: K, value?: GomokuEventTypes[K]): void {
		this.publish(`gomokuStream:${userId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishGomokuGameStream<K extends keyof GomokuGameEventTypes>(gameId: MiGomokuGame['id'], type: K, value?: GomokuGameEventTypes[K]): void {
		this.publish(`gomokuGameStream:${gameId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishWerewolfStream<K extends keyof WerewolfEventTypes>(userId: MiUser['id'], type: K, value?: WerewolfEventTypes[K]): void {
		this.publish(`werewolfStream:${userId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishWerewolfLobbyStream<K extends keyof WerewolfEventTypes>(type: K, value?: WerewolfEventTypes[K]): void {
		this.publish('werewolfLobbyStream', type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishWerewolfGameStream<K extends keyof WerewolfGameEventTypes>(gameId: MiWerewolfGame['id'], type: K, value?: WerewolfGameEventTypes[K]): void {
		this.publish(`werewolfGameStream:${gameId}`, type, typeof value === 'undefined' ? null : value);
	}
}
