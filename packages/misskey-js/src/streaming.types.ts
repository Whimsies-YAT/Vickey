import {
	Antenna,
	ChatMessage,
	ChatMessageLite,
	DriveFile,
	DriveFolder,
	Note,
	Notification,
	GomokuGameDetailed,
	Signin,
	User,
	UserDetailed,
	UserDetailedNotMe,
	UserLite,
	WerewolfGameDetailed,
	WerewolfGameLite,
} from './autogen/models.js';
import {
	AnnouncementCreated,
	EmojiAdded, EmojiDeleted,
	EmojiUpdated,
	PageEvent,
	QueueStats,
	QueueStatsLog,
	ServerStats,
	ServerStatsLog,
	ReversiGameDetailed,
} from './entities.js';
import {
	ReversiUpdateKey,
} from './consts.js';

type ReversiUpdateSettings<K extends ReversiUpdateKey> = {
	key: K;
	value: ReversiGameDetailed[K];
};

type IceServer = {
	urls: string | string[];
	username?: string;
	credential?: string;
};

export type Channels = {
	main: {
		params: null;
		events: {
			notification: (payload: Notification) => void;
			mention: (payload: Note) => void;
			reply: (payload: Note) => void;
			renote: (payload: Note) => void;
			follow: (payload: UserDetailedNotMe) => void; // 自分が他人をフォローしたとき
			followed: (payload: UserDetailed | UserLite) => void; // 他人が自分をフォローしたとき
			unfollow: (payload: UserDetailed) => void; // 自分が他人をフォロー解除したとき
			meUpdated: (payload: UserDetailed) => void;
			pageEvent: (payload: PageEvent) => void;
			urlUploadFinished: (payload: { marker: string; file: DriveFile; }) => void;
			readAllNotifications: () => void;
			unreadNotification: (payload: Notification) => void;
			notificationFlushed: () => void;
			notificationDeleted: (payload: { notificationId: string; notifierId?: string; reaction?: string; }) => void;
			unreadAntenna: (payload: Antenna) => void;
			newChatMessage: (payload: ChatMessage) => void;
			readAllAnnouncements: () => void;
			myTokenRegenerated: () => void;
			signin: (payload: Signin) => void;
			registryUpdated: (payload: {
				scope?: string[];
				key: string;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				value: any | null;
			}) => void;
			driveFileCreated: (payload: DriveFile) => void;
			readAntenna: (payload: Antenna) => void;
			receiveFollowRequest: (payload: User) => void;
			announcementCreated: (payload: AnnouncementCreated) => void;
			voiceCall: (payload: {
				type: 'incoming' | 'initiated' | 'answered' | 'ready' | 'rejected' | 'ended' | 'signal' | 'error' | 'tracksAnswered' | 'tracksReady' | 'readyToPull' | 'pullAnswered' | 'pullCompleted' | 'switchToSfu' | 'switchedToSfu' | 'restored' | 'groupMemberLeft' | 'groupMemberJoined';
				callId?: string;
				from?: string;
				peerId?: string;
				userId?: string;
				isIncoming?: boolean;
				state?: 'ringing' | 'connecting' | 'connected';
				mode?: 'auto' | 'p2p' | 'sfu';
				currentMode?: 'p2p' | 'sfu';
				iceServers?: IceServer[];
				sessionId?: string;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				answer?: any;
				signalType?: string;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				signalData?: any;
				message?: string;
			}) => void;
		};
		receives: {
			'voiceCall:initiate': {
				recipientId: string;
				mode?: 'auto' | 'p2p' | 'sfu';
			};
			'voiceCall:answer': {
				callId: string;
			};
			'voiceCall:reject': {
				callId: string;
			};
			'voiceCall:end': {
				callId: string;
			};
			'voiceCall:pushTracks': {
				callId: string;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				offer: any;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				tracks: any[];
			};
			'voiceCall:tracksReady': {
				callId: string;
			};
			'voiceCall:pullTracks': {
				callId: string;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				offer: any;
			};
			'voiceCall:answerPull': {
				callId: string;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				answer: any;
			};
			'voiceCall:signal': {
				callId: string;
				signalType: string;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				signalData: any;
			};
			'voiceCall:switchToSfu': {
				callId: string;
			};
		};
	};
	homeTimeline: {
		params: {
			withRenotes?: boolean;
			withFiles?: boolean;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	localTimeline: {
		params: {
			withRenotes?: boolean;
			withReplies?: boolean;
			withFiles?: boolean;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	hybridTimeline: {
		params: {
			withRenotes?: boolean;
			withReplies?: boolean;
			withFiles?: boolean;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	smartTimeline: {
		params: {
			withRenotes?: boolean;
			withReplies?: boolean;
			withFiles?: boolean;
			algorithm?: 'smart' | 'hybrid' | 'social' | 'discovery';
			diversityLevel?: 'low' | 'medium' | 'high';
			freshnessWeight?: number;
			qualityThreshold?: number;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	globalTimeline: {
		params: {
			withRenotes?: boolean;
			withFiles?: boolean;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	userList: {
		params: {
			listId: string;
			withFiles?: boolean;
			withRenotes?: boolean;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	hashtag: {
		params: {
			q: string[][];
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	roleTimeline: {
		params: {
			roleId: string;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	antenna: {
		params: {
			antennaId: string;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	channel: {
		params: {
			channelId: string;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	drive: {
		params: null;
		events: {
			fileCreated: (payload: DriveFile) => void;
			fileDeleted: (payload: DriveFile['id']) => void;
			fileUpdated: (payload: DriveFile) => void;
			folderCreated: (payload: DriveFolder) => void;
			folderDeleted: (payload: DriveFolder['id']) => void;
			folderUpdated: (payload: DriveFolder) => void;
		};
		receives: null;
	};
	serverStats: {
		params: null;
		events: {
			stats: (payload: ServerStats) => void;
			statsLog: (payload: ServerStatsLog) => void;
		};
		receives: {
			requestLog: {
				id: string | number;
				length: number;
			};
		};
	};
	queueStats: {
		params: null;
		events: {
			stats: (payload: QueueStats) => void;
			statsLog: (payload: QueueStatsLog) => void;
		};
		receives: {
			requestLog: {
				id: string | number;
				length: number;
			};
		};
	};
	admin: {
		params: null;
		events: {
			newAbuseUserReport: {
				id: string;
				targetUserId: string;
				reporterId: string;
				comment: string;
			}
		};
		receives: null;
	};
	reversi: {
		params: null;
		events: {
			matched: (payload: { game: ReversiGameDetailed }) => void;
			invited: (payload: { user: User }) => void;
		};
		receives: null;
	};
	reversiGame: {
		params: {
			gameId: string;
		};
		events: {
			started: (payload: { game: ReversiGameDetailed; }) => void;
			ended: (payload: { winnerId: User['id'] | null; game: ReversiGameDetailed; }) => void;
			canceled: (payload: { userId: User['id']; }) => void;
			changeReadyStates: (payload: { user1: boolean; user2: boolean; }) => void;
			updateSettings: <K extends ReversiUpdateKey>(payload: { userId: User['id']; key: K; value: ReversiGameDetailed[K]; }) => void;
			log: (payload: Record<string, unknown>) => void;
		};
		receives: {
			putStone: {
				pos: number;
				id: string;
			};
			ready: boolean;
			cancel: null | Record<string, never>;
			updateSettings: ReversiUpdateSettings<ReversiUpdateKey>;
			claimTimeIsUp: null | Record<string, never>;
		}
	};
	chatUser: {
		params: {
			otherId: string;
		};
		events: {
			message: (payload: ChatMessageLite) => void;
			deleted: (payload: ChatMessageLite['id']) => void;
			react: (payload: {
				reaction: string;
				user?: UserLite;
				messageId: ChatMessageLite['id'];
			}) => void;
			unreact: (payload: {
				reaction: string;
				user?: UserLite;
				messageId: ChatMessageLite['id'];
			}) => void;
		};
		receives: {
			read: {
				id: ChatMessageLite['id'];
			};
		};
	};
	chatRoom: {
		params: {
			roomId: string;
		};
		events: {
			message: (payload: ChatMessageLite) => void;
			deleted: (payload: ChatMessageLite['id']) => void;
			react: (payload: {
				reaction: string;
				user?: UserLite;
				messageId: ChatMessageLite['id'];
			}) => void;
			unreact: (payload: {
				reaction: string;
				user?: UserLite;
				messageId: ChatMessageLite['id'];
			}) => void;
		};
		receives: {
			read: {
				id: ChatMessageLite['id'];
			};
		};
	};
	gomoku: {
		params: null;
		events: {
			matched: (payload: { game: GomokuGameDetailed }) => void;
			invited: (payload: { user: UserLite }) => void;
		};
		receives: null;
	};
	gomokuGame: {
		params: {
			gameId: string;
		};
		events: {
			started: (payload: { game: GomokuGameDetailed }) => void;
			canceled: (payload: { userId: string }) => void;
		};
		receives: null;
	};
	werewolf: {
		params: null;
		events: {
			matched: (payload: { game: WerewolfGameDetailed }) => void;
			invited: (payload: { user: User }) => void;
			canceled: (payload: { game: WerewolfGameLite }) => void;
		};
		receives: null;
	};
	werewolfGame: {
		params: {
			gameId: string;
		};
		events: {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			seatChanged: (payload: {
				seats: any[];
				players?: any[];
				userId?: string;
				seatNumber?: number | null;
			}) => void;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			playerReady: (payload: {
				userId: string;
				readyPlayers: string[];
			}) => void;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			playerUnready: (payload: {
				userId: string;
				readyPlayers: string[];
			}) => void;
			countdownStarted: (payload: {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				countdownStartedAt: any;
			}) => void;
			countdownTick: (payload: {
				remaining: number;
			}) => void;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			countdownCancelled: (payload: any) => void;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			playerKicked: (payload: {
				userId: string;
				reason: string;
			}) => void;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			gameStarted: (payload: { game: any }) => void;
			phaseChanged: (payload: {
				phase: string;
				dayNumber?: number;
				subPhase?: string;
			}) => void;
			subPhaseChanged: (payload: {
				subPhase?: string;
			}) => void;
			speakerChanged: (payload: {
				userId: string | null;
				timeLimit?: number;
				isTestament?: boolean;
			}) => void;
			speechTimeUpdate: (payload: {
				remaining: number;
			}) => void;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			discussionEnded: (payload: any) => void;
			testamentNext: (payload: {
				userId: string;
			}) => void;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			playerDied: (payload: {
				userId: string;
				reason: string;
				revealRole?: boolean;
				role?: string;
				players?: any[];
			}) => void;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			message: (payload: {
				channel: string;
				userId: string;
				message: string;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				timestamp: any;
			}) => void;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			gameEnded: (payload: {
				winnerTeam?: string | null;
				game: any;
			}) => void;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			gameCanceled: (payload: any) => void;
			voiceTrackReady: (payload: {
				userId: string;
				sessionId: string;
				trackName: string;
			}) => void;
			voiceTrackAdded: (payload: {
				userId: string;
			}) => void;
			votingTied: (payload: {
				round: number;
				tiedPlayers: string[];
			}) => void;
			secondRoundDiscussionStarted: (payload: {
				tiedPlayers: string[];
				speechOrder: string[] | null;
			}) => void;
			nightPhaseTimeUpdate: (payload: {
				role: string;
				subPhase: string;
				elapsed: number;
				remaining: number;
				total: number;
			}) => void;
			witchTimeWindowUpdate: (payload: {
				window: string;
				windowRemaining: number;
				allowedActions: string[];
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				uiState: any;
				hasSubmitted: boolean;
			}) => void;
			votingTimeUpdate: (payload: {
				elapsed: number;
				remaining: number;
				total: number;
				round: number;
			}) => void;
		};
		receives: null;
	};
};

export type NoteUpdatedEvent = { id: Note['id'] } & ({
	type: 'reacted';
	body: {
		reaction: string;
		emoji: string | null;
		userId: User['id'];
	};
} | {
	type: 'unreacted';
	body: {
		reaction: string;
		userId: User['id'];
	};
} | {
	type: 'deleted';
	body: {
		deletedAt: string;
	};
} | {
	type: 'pollVoted';
	body: {
		choice: number;
		userId: User['id'];
	};
});

export type BroadcastEvents = {
	noteUpdated: (payload: NoteUpdatedEvent) => void;
	emojiAdded: (payload: EmojiAdded) => void;
	emojiUpdated: (payload: EmojiUpdated) => void;
	emojiDeleted: (payload: EmojiDeleted) => void;
	announcementCreated: (payload: AnnouncementCreated) => void;
};
