/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';

import { FanoutTimelineEndpointService } from '@/core/FanoutTimelineEndpointService.js';
import { AbuseReportService } from '@/core/AbuseReportService.js';
import { SystemWebhookEntityService } from '@/core/entities/SystemWebhookEntityService.js';
import {
	AbuseReportNotificationRecipientEntityService,
} from '@/core/entities/AbuseReportNotificationRecipientEntityService.js';
import { AbuseReportNotificationService } from '@/core/AbuseReportNotificationService.js';
import { SystemWebhookService } from '@/core/SystemWebhookService.js';
import { UserSearchService } from '@/core/UserSearchService.js';
import { WebhookTestService } from '@/core/WebhookTestService.js';
import { FlashService } from '@/core/FlashService.js';
import { ChannelMutingService } from '@/core/ChannelMutingService.js';

import { AccountMoveService } from './AccountMoveService.js';
import { AccountUpdateService } from './AccountUpdateService.js';
import { AiService } from './AiService.js';
import { AnnouncementService } from './AnnouncementService.js';
import { AntennaService } from './AntennaService.js';
import { AppLockService } from './AppLockService.js';
import { AchievementService } from './AchievementService.js';
import { AvatarDecorationService } from './AvatarDecorationService.js';
import { CaptchaService } from './CaptchaService.js';
import { CheckSecurityUpdateService } from "@/core/CheckSecurityUpdateService.js";
import { CustomEmojiService } from './CustomEmojiService.js';
import { DeleteAccountService } from './DeleteAccountService.js';
import { DownloadService } from './DownloadService.js';
import { DriveService } from './DriveService.js';
import { EmailService } from './EmailService.js';
import { EmailTemplatesService } from './EmailTemplatesService.js';
import { FederatedInstanceService } from './FederatedInstanceService.js';
import { FetchInstanceMetadataService } from './FetchInstanceMetadataService.js';
import { GlobalEventService } from './GlobalEventService.js';
import { HashtagService } from './HashtagService.js';
import { HttpRequestService } from './HttpRequestService.js';
import { IdService } from './IdService.js';
import { ImageProcessingService } from './ImageProcessingService.js';
import { SystemAccountService } from './SystemAccountService.js';
import { InternalStorageService } from './InternalStorageService.js';
import { IP2LocationService } from './IP2LocationService.js';

import { UserRiskScoreService } from './UserRiskScoreService.js';
import { DynamicScoringService } from './DynamicScoringService.js';
import { RiskScoreAlgorithmsService } from './RiskScoreAlgorithmsService.js';
import { RiskScoreCacheService } from './RiskScoreCacheService.js';
import { RiskScoreRehabilitationService } from './RiskScoreRehabilitationService.js';
import { MultiAccountDetectionService } from './MultiAccountDetectionService.js';
import { RiskEventLogService } from './RiskEventLogService.js';
import { SessionRiskAnalysisService } from './SessionRiskAnalysisService.js';

import { MetaService } from './MetaService.js';
import { MfmService } from './MfmService.js';
import { MLReportService } from './MLReportService.js';
import { ModerationLogService } from './ModerationLogService.js';
import { NoteCreateService } from './NoteCreateService.js';
import { NoteDeleteService } from './NoteDeleteService.js';
import { NotePiningService } from './NotePiningService.js';
import { NoteDraftService } from './NoteDraftService.js';
import { NotificationService } from './NotificationService.js';
import { PdqService } from './PdqService.js';
import { PollService } from './PollService.js';
import { PushNotificationService } from './PushNotificationService.js';
import { QueryService } from './QueryService.js';
import { ReactionService } from './ReactionService.js';
import { ReactionsBufferingService } from './ReactionsBufferingService.js';
import { RelayService } from './RelayService.js';
import { RoleService } from './RoleService.js';
import { S3Service } from './S3Service.js';
import { SecurityCoreService } from './SecurityCoreService.js';
import { SignupService } from './SignupService.js';
import { WebAuthnService } from './WebAuthnService.js';

import { UserBlockingService } from './UserBlockingService.js';
import { CacheService } from './CacheService.js';
import { UserService } from './UserService.js';
import { UserFollowingService } from './UserFollowingService.js';
import { UserKeypairService } from './UserKeypairService.js';
import { UserListService } from './UserListService.js';
import { UserMutingService } from './UserMutingService.js';
import { UserRenoteMutingService } from './UserRenoteMutingService.js';
import { UserSuspendService } from './UserSuspendService.js';
import { UserAuthService } from './UserAuthService.js';

import { VideoProcessingService } from './VideoProcessingService.js';
import { UserWebhookService } from './UserWebhookService.js';
import { UtilityService } from './UtilityService.js';
import { ContentRecommendationService } from './ContentRecommendationService.js';
import { RecommendationAlgorithms } from './RecommendationAlgorithms.js';
import { SmartTimelineService } from './SmartTimelineService.js';
import { HybridTimelineService } from './HybridTimelineService.js';
import { LocalAIContentAnalysisService } from './LocalAIContentAnalysisService.js';
import { FileInfoService } from './FileInfoService.js';
import { SearchService } from './SearchService.js';
import { OfflineGeocodingService } from './OfflineGeocodingService.js';
import { ClipService } from './ClipService.js';
import { FeaturedService } from './FeaturedService.js';
import { FanoutTimelineService } from './FanoutTimelineService.js';
import { ChannelFollowingService } from './ChannelFollowingService.js';
import { ChatService } from './ChatService.js';
import { RegistryApiService } from './RegistryApiService.js';
import { ReversiService } from './ReversiService.js';
import { GomokuService } from './GomokuService.js';
import { WerewolfService } from './WerewolfService.js';
import { UserSessionsService } from './UserSessionsService.js';
import { PageService } from './PageService.js';

import { ChartLoggerService } from './chart/ChartLoggerService.js';
import FederationChart from './chart/charts/federation.js';
import NotesChart from './chart/charts/notes.js';
import UsersChart from './chart/charts/users.js';
import ActiveUsersChart from './chart/charts/active-users.js';
import InstanceChart from './chart/charts/instance.js';
import PerUserNotesChart from './chart/charts/per-user-notes.js';
import PerUserPvChart from './chart/charts/per-user-pv.js';
import DriveChart from './chart/charts/drive.js';
import PerUserReactionsChart from './chart/charts/per-user-reactions.js';
import PerUserFollowingChart from './chart/charts/per-user-following.js';
import PerUserDriveChart from './chart/charts/per-user-drive.js';
import ApRequestChart from './chart/charts/ap-request.js';
import { ChartManagementService } from './chart/ChartManagementService.js';

import { AbuseUserReportEntityService } from './entities/AbuseUserReportEntityService.js';
import { AnnouncementEntityService } from './entities/AnnouncementEntityService.js';
import { AntennaEntityService } from './entities/AntennaEntityService.js';
import { AppEntityService } from './entities/AppEntityService.js';
import { AuthSessionEntityService } from './entities/AuthSessionEntityService.js';
import { BlockingEntityService } from './entities/BlockingEntityService.js';
import { ChannelEntityService } from './entities/ChannelEntityService.js';
import { ChatEntityService } from './entities/ChatEntityService.js';
import { ClipEntityService } from './entities/ClipEntityService.js';
import { DriveFileEntityService } from './entities/DriveFileEntityService.js';
import { DriveFolderEntityService } from './entities/DriveFolderEntityService.js';
import { EmojiEntityService } from './entities/EmojiEntityService.js';
import { FollowingEntityService } from './entities/FollowingEntityService.js';
import { FollowRequestEntityService } from './entities/FollowRequestEntityService.js';
import { GalleryLikeEntityService } from './entities/GalleryLikeEntityService.js';
import { GalleryPostEntityService } from './entities/GalleryPostEntityService.js';
import { HashtagEntityService } from './entities/HashtagEntityService.js';
import { InstanceEntityService } from './entities/InstanceEntityService.js';
import { InviteCodeEntityService } from './entities/InviteCodeEntityService.js';
import { ModerationLogEntityService } from './entities/ModerationLogEntityService.js';
import { MutingEntityService } from './entities/MutingEntityService.js';
import { RenoteMutingEntityService } from './entities/RenoteMutingEntityService.js';
import { NoteEntityService } from './entities/NoteEntityService.js';
import { NoteFavoriteEntityService } from './entities/NoteFavoriteEntityService.js';
import { NoteReactionEntityService } from './entities/NoteReactionEntityService.js';
import { NoteDraftEntityService } from './entities/NoteDraftEntityService.js';
import { NotificationEntityService } from './entities/NotificationEntityService.js';
import { PageEntityService } from './entities/PageEntityService.js';
import { PageLikeEntityService } from './entities/PageLikeEntityService.js';
import { SigninEntityService } from './entities/SigninEntityService.js';
import { UserSessionEntityService } from './entities/UserSessionEntityService.js';
import { UserEntityService } from './entities/UserEntityService.js';
import { UserListEntityService } from './entities/UserListEntityService.js';
import { FlashEntityService } from './entities/FlashEntityService.js';
import { FlashLikeEntityService } from './entities/FlashLikeEntityService.js';
import { RoleEntityService } from './entities/RoleEntityService.js';
import { ReversiGameEntityService } from './entities/ReversiGameEntityService.js';
import { GomokuGameEntityService } from './entities/GomokuGameEntityService.js';
import { WerewolfGameEntityService } from './entities/WerewolfGameEntityService.js';
import { MetaEntityService } from './entities/MetaEntityService.js';

import { ApAudienceService } from './activitypub/ApAudienceService.js';
import { ApDbResolverService } from './activitypub/ApDbResolverService.js';
import { ApDeliverManagerService } from './activitypub/ApDeliverManagerService.js';
import { ApInboxService } from './activitypub/ApInboxService.js';
import { ApLoggerService } from './activitypub/ApLoggerService.js';
import { ApMfmService } from './activitypub/ApMfmService.js';
import { ApRendererService } from './activitypub/ApRendererService.js';
import { ApRequestService } from './activitypub/ApRequestService.js';
import { ApResolverService } from './activitypub/ApResolverService.js';
import { JsonLdService } from './activitypub/JsonLdService.js';
import { RemoteLoggerService } from './RemoteLoggerService.js';
import { RemoteUserResolveService } from './RemoteUserResolveService.js';
import { WebfingerService } from './WebfingerService.js';
import { ApImageService } from './activitypub/models/ApImageService.js';
import { ApMentionService } from './activitypub/models/ApMentionService.js';
import { ApNoteService } from './activitypub/models/ApNoteService.js';
import { ApPersonService } from './activitypub/models/ApPersonService.js';
import { ApQuestionService } from './activitypub/models/ApQuestionService.js';
import { QueueModule } from './QueueModule.js';
import { QueueService } from './QueueService.js';
import { LoggerService } from './LoggerService.js';
import { LogObserverService } from './LogObserverService.js';
import { StripeService } from './StripeService.js';
import { StripeSubscriptionService } from './StripeSubscriptionService.js';
import { StripeWebhookService } from './StripeWebhookService.js';
import { CloudflareCallsService } from './CloudflareCallsService.js';
import { VoiceCallService } from './VoiceCallService.js';
import { WerewolfVoiceService } from './WerewolfVoiceService.js';

// EventBus infrastructure (NEW - for gradual migration)
import { EventBus } from './events/EventBus.js';
import { EventMetrics } from './events/EventMetrics.js';
import { NoteEventHandlers } from './handlers/NoteEventHandlers.js';

// Timeline Warming Feature (DDD Architecture)
import { TimelineWarmingService } from './timeline/application/TimelineWarmingService.js';
import { TimelineWarmingEventHandler } from './timeline/handlers/TimelineWarmingEventHandler.js';

const serviceClasses = [
	LoggerService, LogObserverService, AbuseReportService, AbuseReportNotificationService, AccountMoveService,
	AccountUpdateService, AiService, AnnouncementService, AntennaService, AppLockService,
	AchievementService, AvatarDecorationService, CaptchaService, CheckSecurityUpdateService,
	CustomEmojiService, DeleteAccountService, DownloadService, DriveService, EmailService,
	EmailTemplatesService, FederatedInstanceService, FetchInstanceMetadataService,
	GlobalEventService, HashtagService, HttpRequestService, IdService, ImageProcessingService,
	InternalStorageService, IP2LocationService, UserRiskScoreService, DynamicScoringService,
	RiskScoreAlgorithmsService, RiskScoreCacheService, RiskScoreRehabilitationService,
	MultiAccountDetectionService, RiskEventLogService, SessionRiskAnalysisService,
	MetaService, MfmService, MLReportService, ModerationLogService, NoteCreateService,
	NoteDeleteService, NotePiningService, NoteDraftService, NotificationService, PdqService, PollService,
	SystemAccountService, PushNotificationService, QueryService, ReactionService,
	ReactionsBufferingService, RelayService, RoleService, S3Service, SecurityCoreService,
	SignupService, WebAuthnService, UserBlockingService, CacheService, UserService,
	UserFollowingService, UserKeypairService, UserListService, UserMutingService,
	UserRenoteMutingService, UserSearchService, UserSuspendService, UserAuthService,
	VideoProcessingService, UserWebhookService, SystemWebhookService, WebhookTestService,
	UtilityService, ContentRecommendationService, RecommendationAlgorithms, SmartTimelineService,
	HybridTimelineService, LocalAIContentAnalysisService, FileInfoService, FlashService,
	SearchService, OfflineGeocodingService, ClipService, FeaturedService, FanoutTimelineService, FanoutTimelineEndpointService,
	ChannelFollowingService, ChannelMutingService, ChatService, RegistryApiService, ReversiService, GomokuService, WerewolfService, UserSessionsService,
	PageService, ChartLoggerService, FederationChart, NotesChart, UsersChart, ActiveUsersChart,
	InstanceChart, PerUserNotesChart, PerUserPvChart, DriveChart, PerUserReactionsChart,
	PerUserFollowingChart, PerUserDriveChart, ApRequestChart, ChartManagementService,
	AbuseUserReportEntityService, AnnouncementEntityService, AbuseReportNotificationRecipientEntityService,
	AntennaEntityService, AppEntityService, AuthSessionEntityService, BlockingEntityService,
	ChannelEntityService, ChatEntityService, ClipEntityService, DriveFileEntityService,
	DriveFolderEntityService, EmojiEntityService, FollowingEntityService, FollowRequestEntityService,
	GalleryLikeEntityService, GalleryPostEntityService, HashtagEntityService, InstanceEntityService,
	InviteCodeEntityService, ModerationLogEntityService, MutingEntityService, RenoteMutingEntityService,
	NoteEntityService, NoteFavoriteEntityService, NoteReactionEntityService, NoteDraftEntityService,
	NotificationEntityService, PageEntityService, PageLikeEntityService, SigninEntityService,
	UserSessionEntityService, UserEntityService, UserListEntityService, FlashEntityService, FlashLikeEntityService,
	RoleEntityService, ReversiGameEntityService, GomokuGameEntityService, WerewolfGameEntityService, MetaEntityService, SystemWebhookEntityService,
	ApAudienceService, ApDbResolverService, ApDeliverManagerService, ApInboxService, ApLoggerService,
	ApMfmService, ApRendererService, ApRequestService, ApResolverService, JsonLdService,
	RemoteLoggerService, RemoteUserResolveService, WebfingerService, ApImageService, ApMentionService,
	ApNoteService, ApPersonService, ApQuestionService, QueueService, StripeService, StripeSubscriptionService,
	StripeWebhookService, CloudflareCallsService, VoiceCallService, WerewolfVoiceService,
	// EventBus infrastructure (NEW)
	EventBus, EventMetrics,
	// Event handlers (NEW)
	NoteEventHandlers,
	// Timeline Warming (DDD Architecture)
	TimelineWarmingService, TimelineWarmingEventHandler,
];

const stringProviders: Provider[] = serviceClasses.map(ServiceClass => ({
	provide: ServiceClass.name,
	useExisting: ServiceClass
}));

@Module({
	imports: [
		QueueModule,
	],
	providers: [
		...serviceClasses,
		...stringProviders
	],
	exports: [
		QueueModule,
		...serviceClasses,
		...stringProviders
	],
})
export class CoreModule { }
