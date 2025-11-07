/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
	FindOneOptions,
	InsertQueryBuilder,
	ObjectLiteral,
	QueryRunner,
	Repository,
	SelectQueryBuilder,
} from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { RelationCountLoader } from 'typeorm/query-builder/relation-count/RelationCountLoader.js';
import { RelationIdLoader } from 'typeorm/query-builder/relation-id/RelationIdLoader.js';
import {
	RawSqlResultsToEntityTransformer,
} from 'typeorm/query-builder/transformer/RawSqlResultsToEntityTransformer.js';
import { MiAbuseReportNotificationRecipient } from '@/models/AbuseReportNotificationRecipient.js';
import { MiAbuseNoteAutoCheck } from '@/models/AbuseNoteAutoCheck.js';
import { MiAbuseUserReport } from '@/models/AbuseUserReport.js';
import { MiOAuthClientConfig } from '@/models/OAuthClientConfig.js';
import { MiAccessToken } from '@/models/AccessToken.js';
import { MiAd } from '@/models/Ad.js';
import { MiAnnouncement } from '@/models/Announcement.js';
import { MiAnnouncementRead } from '@/models/AnnouncementRead.js';
import { MiAntenna } from '@/models/Antenna.js';
import { MiApp } from '@/models/App.js';
import { MiAuthSession } from '@/models/AuthSession.js';
import { MiAvatarDecoration } from '@/models/AvatarDecoration.js';
import { MiBlocking } from '@/models/Blocking.js';
import { MiBubbleGameRecord } from '@/models/BubbleGameRecord.js';
import { MiChannel } from '@/models/Channel.js';
import { MiChannelFavorite } from '@/models/ChannelFavorite.js';
import { MiChannelFollowing } from '@/models/ChannelFollowing.js';
import { MiChannelMuting } from "@/models/ChannelMuting.js";
import { MiChatApproval } from '@/models/ChatApproval.js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiChatRoom } from '@/models/ChatRoom.js';
import { MiChatRoomInvitation } from '@/models/ChatRoomInvitation.js';
import { MiChatRoomMembership } from '@/models/ChatRoomMembership.js';
import { MiClip } from '@/models/Clip.js';
import { MiClipFavorite } from '@/models/ClipFavorite.js';
import { MiClipNote } from '@/models/ClipNote.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { MiDriveFolder } from '@/models/DriveFolder.js';
import { MiEmailTemplates } from '@/models/EmailTemplates.js';
import { MiEmoji } from '@/models/Emoji.js';
import { MiFlash } from '@/models/Flash.js';
import { MiFlashLike } from '@/models/FlashLike.js';
import { MiFollowing } from '@/models/Following.js';
import { MiFollowRequest } from '@/models/FollowRequest.js';
import { MiGalleryLike } from '@/models/GalleryLike.js';
import { MiGalleryPost } from '@/models/GalleryPost.js';
import { MiHashtag } from '@/models/Hashtag.js';
import { MiInstance } from '@/models/Instance.js';
import { MiMeta } from '@/models/Meta.js';
import { MiModerationLog } from '@/models/ModerationLog.js';
import { MiMuting } from '@/models/Muting.js';
import { MiNote } from '@/models/Note.js';
import { MiNoteDraft } from '@/models/NoteDraft.js';
import { MiNoteFavorite } from '@/models/NoteFavorite.js';
import { MiNoteReaction } from '@/models/NoteReaction.js';
import { MiNoteThreadMuting } from '@/models/NoteThreadMuting.js';
import { MiPage } from '@/models/Page.js';
import { MiPageLike } from '@/models/PageLike.js';
import { MiPasswordResetRequest } from '@/models/PasswordResetRequest.js';
import { MiPoll } from '@/models/Poll.js';
import { MiPollVote } from '@/models/PollVote.js';
import { MiPromoNote } from '@/models/PromoNote.js';
import { MiPromoRead } from '@/models/PromoRead.js';
import { MiRegistrationTicket } from '@/models/RegistrationTicket.js';
import { MiRegistryItem } from '@/models/RegistryItem.js';
import { MiRelay } from '@/models/Relay.js';
import { MiRenoteMuting } from '@/models/RenoteMuting.js';
import { MiRetentionAggregation } from '@/models/RetentionAggregation.js';
import { MiReversiGame } from '@/models/ReversiGame.js';
import { MiGomokuGame } from '@/models/GomokuGame.js';
import { MiWerewolfGame } from '@/models/WerewolfGame.js';
import { MiRole } from '@/models/Role.js';
import { MiRoleAssignment } from '@/models/RoleAssignment.js';
import { MiSignin } from '@/models/Signin.js';
import { MiSwSubscription } from '@/models/SwSubscription.js';
import { MiSystemAccount } from '@/models/SystemAccount.js';
import { MiSystemWebhook } from '@/models/SystemWebhook.js';
import { MiUsedUsername } from '@/models/UsedUsername.js';
import { MiUser } from '@/models/User.js';
import { MiUserSession } from '@/models/UserSession.js';
import { MiUserIp } from '@/models/UserIp.js';
import { MiUserKeypair } from '@/models/UserKeypair.js';
import { MiUserList } from '@/models/UserList.js';
import { MiUserListFavorite } from '@/models/UserListFavorite.js';
import { MiUserListMembership } from '@/models/UserListMembership.js';
import { MiUserMemo } from '@/models/UserMemo.js';
import { MiUserNotePining } from '@/models/UserNotePining.js';
import { MiUserPending } from '@/models/UserPending.js';
import { MiUserProfile } from '@/models/UserProfile.js';
import { MiUserPublickey } from '@/models/UserPublickey.js';
import { MiUserSecurityKey } from '@/models/UserSecurityKey.js';
import { MiUserSessions } from '@/models/UserSessions.js';
import { MiWebhook } from '@/models/Webhook.js';
import { MiUserRiskScoreHistory } from '@/models/UserRiskScoreHistory.js';
import { MiRiskEventLog } from '@/models/RiskEventLog.js';
import { MiUserMultiAccountLink } from '@/models/UserMultiAccountLink.js';
import { MiUserRecommendationProfile } from '@/models/UserRecommendationProfile.js';
import { MiContentRecommendationLog } from '@/models/ContentRecommendationLog.js';
import { MiUserInteractionHistory } from '@/models/UserInteractionHistory.js';
import { MiContentEmbedding } from '@/models/ContentEmbedding.js';
import { MiUserInterestEmbedding } from '@/models/UserInterestEmbedding.js';
import { MiEmbeddingBatchQueue } from '@/models/EmbeddingBatchQueue.js';
import { MiStripeCustomer } from '@/models/StripeCustomer.js';
import { MiStripePayment } from '@/models/StripePayment.js';
import { MiStripeSubscription } from '@/models/StripeSubscription.js';
import { MiStripeRefund } from '@/models/StripeRefund.js';
import { MiElasticsearchReindexState } from '@/models/ElasticsearchReindexState.js';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';

export interface MiRepository<T extends ObjectLiteral> {
	createTableColumnNames(this: Repository<T> & MiRepository<T>): string[];

	insertOne(this: Repository<T> & MiRepository<T>, entity: QueryDeepPartialEntity<T>, findOptions?: Pick<FindOneOptions<T>, 'relations'>): Promise<T>;

	insertOneImpl(this: Repository<T> & MiRepository<T>, entity: QueryDeepPartialEntity<T>, findOptions?: Pick<FindOneOptions<T>, 'relations'>, queryRunner?: QueryRunner): Promise<T>;

	selectAliasColumnNames(this: Repository<T> & MiRepository<T>, queryBuilder: InsertQueryBuilder<T>, builder: SelectQueryBuilder<T>): void;
}

export const miRepository = {
	createTableColumnNames() {
		return this.metadata.columns.filter(column => column.isSelect && !column.isVirtual).map(column => column.databaseName);
	},
	async insertOne(entity, findOptions?) {
		const opt = this.manager.connection.options as PostgresConnectionOptions;
		if (opt.replication) {
			const queryRunner = this.manager.connection.createQueryRunner('master');
			try {
				return this.insertOneImpl(entity, findOptions, queryRunner);
			} finally {
				await queryRunner.release();
			}
		} else {
			return this.insertOneImpl(entity, findOptions);
		}
	},
	async insertOneImpl(entity, findOptions?, queryRunner?) {
		// ---- insert + returningの結果を共通テーブル式(CTE)に保持するクエリを生成 ----

		const queryBuilder = this.createQueryBuilder().insert().values(entity);
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const mainAlias = queryBuilder.expressionMap.mainAlias!;
		const name = mainAlias.name;
		mainAlias.name = 't';
		const columnNames = this.createTableColumnNames();
		queryBuilder.returning(columnNames.reduce((a, c) => `${a}, ${queryBuilder.escape(c)}`, '').slice(2));

		// ---- 共通テーブル式(CTE)から結果を取得 ----
		const builder = this.createQueryBuilder(undefined, queryRunner).addCommonTableExpression(queryBuilder, 'cte', { columnNames });
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		builder.expressionMap.mainAlias!.tablePath = 'cte';
		this.selectAliasColumnNames(queryBuilder, builder);
		if (findOptions) {
			builder.setFindOptions(findOptions);
		}
		const raw = await builder.execute();
		mainAlias.name = name;
		const relationId = await new RelationIdLoader(builder.connection, this.queryRunner, builder.expressionMap.relationIdAttributes).load(raw);
		const relationCount = await new RelationCountLoader(builder.connection, this.queryRunner, builder.expressionMap.relationCountAttributes).load(raw);
		const result = new RawSqlResultsToEntityTransformer(builder.expressionMap, builder.connection.driver, relationId, relationCount, this.queryRunner).transform(raw, mainAlias);
		return result[0];
	},
	selectAliasColumnNames(queryBuilder, builder) {
		let selectOrAddSelect = (selection: string, selectionAliasName?: string) => {
			selectOrAddSelect = (selection, selectionAliasName) => builder.addSelect(selection, selectionAliasName);
			return builder.select(selection, selectionAliasName);
		};
		for (const columnName of this.createTableColumnNames()) {
			selectOrAddSelect(`${builder.alias}.${columnName}`, `${builder.alias}_${columnName}`);
		}
	},
} satisfies MiRepository<ObjectLiteral>;

export {
	MiAbuseNoteAutoCheck,
	MiAbuseUserReport,
	MiAbuseReportNotificationRecipient,
	MiAccessToken,
	MiAd,
	MiAnnouncement,
	MiAnnouncementRead,
	MiAntenna,
	MiApp,
	MiAvatarDecoration,
	MiAuthSession,
	MiBlocking,
	MiChannelFollowing,
	MiChannelFavorite,
	MiChannelMuting,
	MiClip,
	MiClipNote,
	MiClipFavorite,
	MiDriveFile,
	MiDriveFolder,
	MiEmoji,
	MiEmailTemplates,
	MiFollowing,
	MiFollowRequest,
	MiGalleryLike,
	MiGalleryPost,
	MiHashtag,
	MiInstance,
	MiMeta,
	MiModerationLog,
	MiMuting,
	MiRenoteMuting,
	MiNote,
	MiNoteDraft,
	MiNoteFavorite,
	MiNoteReaction,
	MiNoteThreadMuting,
	MiPage,
	MiPageLike,
	MiPasswordResetRequest,
	MiPoll,
	MiPollVote,
	MiPromoNote,
	MiPromoRead,
	MiRegistrationTicket,
	MiRegistryItem,
	MiRelay,
	MiSignin,
	MiSwSubscription,
	MiSystemAccount,
	MiUsedUsername,
	MiUser,
	MiUserIp,
	MiUserKeypair,
	MiUserList,
	MiUserListFavorite,
	MiUserListMembership,
	MiUserNotePining,
	MiUserPending,
	MiUserProfile,
	MiUserPublickey,
	MiUserSecurityKey,
	MiWebhook,
	MiSystemWebhook,
	MiChannel,
	MiRetentionAggregation,
	MiRole,
	MiRoleAssignment,
	MiFlash,
	MiFlashLike,
	MiUserMemo,
	MiChatMessage,
	MiChatRoom,
	MiChatRoomMembership,
	MiChatRoomInvitation,
	MiChatApproval,
	MiBubbleGameRecord,
	MiReversiGame,
	MiGomokuGame,
	MiWerewolfGame,
	MiUserSessions,
	MiOAuthClientConfig,
	MiUserSession,
	MiUserRiskScoreHistory,
	MiRiskEventLog,
	MiUserMultiAccountLink,
	MiUserRecommendationProfile,
	MiContentRecommendationLog,
	MiUserInteractionHistory,
	MiContentEmbedding,
	MiUserInterestEmbedding,
	MiEmbeddingBatchQueue,
	MiStripeCustomer,
	MiStripePayment,
	MiStripeSubscription,
	MiStripeRefund,
	MiElasticsearchReindexState,
};

type MiRepositoryType<T extends ObjectLiteral> = Repository<T> & MiRepository<T>;

export type AbuseNoteAutoCheckRepository = MiRepositoryType<MiAbuseNoteAutoCheck>;
export type AbuseUserReportsRepository = MiRepositoryType<MiAbuseUserReport>;
export type AbuseReportNotificationRecipientRepository = MiRepositoryType<MiAbuseReportNotificationRecipient>;
export type AccessTokensRepository = MiRepositoryType<MiAccessToken>;
export type AdsRepository = MiRepositoryType<MiAd>;
export type AnnouncementsRepository = MiRepositoryType<MiAnnouncement>;
export type AnnouncementReadsRepository = MiRepositoryType<MiAnnouncementRead>;
export type AntennasRepository = MiRepositoryType<MiAntenna>;
export type AppsRepository = MiRepositoryType<MiApp>;
export type AvatarDecorationsRepository = MiRepositoryType<MiAvatarDecoration>;
export type AuthSessionsRepository = MiRepositoryType<MiAuthSession>;
export type BlockingsRepository = MiRepositoryType<MiBlocking>;
export type ChannelFollowingsRepository = MiRepositoryType<MiChannelFollowing>;
export type ChannelFavoritesRepository = MiRepositoryType<MiChannelFavorite>;
export type ChannelMutingRepository = MiRepository<MiChannelMuting>;
export type ClipsRepository = MiRepositoryType<MiClip>;
export type ClipNotesRepository = MiRepositoryType<MiClipNote>;
export type ClipFavoritesRepository = MiRepositoryType<MiClipFavorite>;
export type DriveFilesRepository = MiRepositoryType<MiDriveFile>;
export type DriveFoldersRepository = MiRepositoryType<MiDriveFolder>;
export type EmojisRepository = MiRepositoryType<MiEmoji>;
export type EmailTemplatesRepository = MiRepositoryType<MiEmailTemplates>;
export type FollowingsRepository = MiRepositoryType<MiFollowing>;
export type FollowRequestsRepository = MiRepositoryType<MiFollowRequest>;
export type GalleryLikesRepository = MiRepositoryType<MiGalleryLike>;
export type GalleryPostsRepository = MiRepositoryType<MiGalleryPost>;
export type HashtagsRepository = MiRepositoryType<MiHashtag>;
export type InstancesRepository = MiRepositoryType<MiInstance>;
export type MetasRepository = MiRepositoryType<MiMeta>;
export type ModerationLogsRepository = MiRepositoryType<MiModerationLog>;
export type MutingsRepository = MiRepositoryType<MiMuting>;
export type RenoteMutingsRepository = MiRepositoryType<MiRenoteMuting>;
export type NotesRepository = MiRepositoryType<MiNote>;
export type NoteDraftsRepository = MiRepositoryType<MiNoteDraft>;
export type NoteFavoritesRepository = MiRepositoryType<MiNoteFavorite>;
export type NoteReactionsRepository = MiRepositoryType<MiNoteReaction>;
export type NoteThreadMutingsRepository = MiRepositoryType<MiNoteThreadMuting>;
export type PagesRepository = MiRepositoryType<MiPage>;
export type PageLikesRepository = MiRepositoryType<MiPageLike>;
export type PasswordResetRequestsRepository = MiRepositoryType<MiPasswordResetRequest>;
export type PollsRepository = MiRepositoryType<MiPoll>;
export type PollVotesRepository = MiRepositoryType<MiPollVote>;
export type PromoNotesRepository = MiRepositoryType<MiPromoNote>;
export type PromoReadsRepository = MiRepositoryType<MiPromoRead>;
export type RegistrationTicketsRepository = MiRepositoryType<MiRegistrationTicket>;
export type RegistryItemsRepository = MiRepositoryType<MiRegistryItem>;
export type RelaysRepository = MiRepositoryType<MiRelay>;
export type SigninsRepository = MiRepositoryType<MiSignin>;
export type SwSubscriptionsRepository = MiRepositoryType<MiSwSubscription>;
export type SystemAccountsRepository = MiRepositoryType<MiSystemAccount>;
export type UsedUsernamesRepository = MiRepositoryType<MiUsedUsername>;
export type UsersRepository = MiRepositoryType<MiUser>;
export type UserIpsRepository = MiRepositoryType<MiUserIp>;
export type UserKeypairsRepository = MiRepositoryType<MiUserKeypair>;
export type UserListsRepository = MiRepositoryType<MiUserList>;
export type UserListFavoritesRepository = MiRepositoryType<MiUserListFavorite>;
export type UserListMembershipsRepository = MiRepositoryType<MiUserListMembership>;
export type UserNotePiningsRepository = MiRepositoryType<MiUserNotePining>;
export type UserPendingsRepository = MiRepositoryType<MiUserPending>;
export type UserProfilesRepository = MiRepositoryType<MiUserProfile>;
export type UserPublickeysRepository = MiRepositoryType<MiUserPublickey>;
export type UserSecurityKeysRepository = MiRepositoryType<MiUserSecurityKey>;
export type WebhooksRepository = MiRepositoryType<MiWebhook>;
export type SystemWebhooksRepository = MiRepositoryType<MiSystemWebhook>;
export type ChannelsRepository = MiRepositoryType<MiChannel>;
export type RetentionAggregationsRepository = MiRepositoryType<MiRetentionAggregation>;
export type RolesRepository = MiRepositoryType<MiRole>;
export type RoleAssignmentsRepository = MiRepositoryType<MiRoleAssignment>;
export type FlashsRepository = MiRepositoryType<MiFlash>;
export type FlashLikesRepository = MiRepositoryType<MiFlashLike>;
export type UserMemoRepository = MiRepositoryType<MiUserMemo>;
export type ChatMessagesRepository = MiRepositoryType<MiChatMessage>;
export type ChatRoomsRepository = MiRepositoryType<MiChatRoom>;
export type ChatRoomMembershipsRepository = MiRepositoryType<MiChatRoomMembership>;
export type ChatRoomInvitationsRepository = MiRepositoryType<MiChatRoomInvitation>;
export type ChatApprovalsRepository = MiRepositoryType<MiChatApproval>;
export type BubbleGameRecordsRepository = MiRepositoryType<MiBubbleGameRecord>;
export type ReversiGamesRepository = MiRepositoryType<MiReversiGame>;
export type GomokuGamesRepository = MiRepositoryType<MiGomokuGame>;
export type WerewolfGamesRepository = MiRepositoryType<MiWerewolfGame>;
export type UserSessionsRepository = MiRepositoryType<MiUserSessions>;
export type UserSessionRepository = MiRepositoryType<MiUserSession>;
export type OAuthClientConfigsRepository = MiRepositoryType<MiOAuthClientConfig>;
export type UserRiskScoreHistoryRepository = MiRepositoryType<MiUserRiskScoreHistory>;
export type RiskEventLogRepository = MiRepositoryType<MiRiskEventLog>;
export type UserMultiAccountLinkRepository = MiRepositoryType<MiUserMultiAccountLink>;
export type UserRecommendationProfileRepository = MiRepositoryType<MiUserRecommendationProfile>;
export type ContentRecommendationLogRepository = MiRepositoryType<MiContentRecommendationLog>;
export type UserInteractionHistoryRepository = MiRepositoryType<MiUserInteractionHistory>;
export type ContentEmbeddingRepository = MiRepositoryType<MiContentEmbedding>;
export type UserInterestEmbeddingRepository = MiRepositoryType<MiUserInterestEmbedding>;
export type EmbeddingBatchQueueRepository = MiRepositoryType<MiEmbeddingBatchQueue>;
export type StripeCustomersRepository = MiRepositoryType<MiStripeCustomer>;
export type StripePaymentsRepository = MiRepositoryType<MiStripePayment>;
export type StripeSubscriptionsRepository = MiRepositoryType<MiStripeSubscription>;
export type StripeRefundsRepository = MiRepositoryType<MiStripeRefund>;
export type ElasticsearchReindexStatesRepository = MiRepositoryType<MiElasticsearchReindexState>;
