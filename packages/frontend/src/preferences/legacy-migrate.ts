/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DeckProfile } from '@/deck.js';
import { genId } from '@/utility/id.js';
import { get as idbGet } from '@/utility/idb-proxy.js';
import { prefer } from '@/preferences.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';

type LegacyRecord = Record<string, any>;
type PreferenceKey = Parameters<typeof prefer.commit>[0];

type LegacySources = {
	baseDevice: LegacyRecord;
	baseDeviceAccount: LegacyRecord;
	baseAccount: LegacyRecord;
	deckDeviceAccount: LegacyRecord;
};

function isObject(value: unknown): value is LegacyRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): LegacyRecord {
	return isObject(value) ? value : {};
}

function hasOwn(source: LegacyRecord, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(source, key);
}

function commitPreference(key: PreferenceKey, value: unknown): void {
	prefer.commit(key, value as never);
}

function commitIfPresent(key: string, source: LegacyRecord, prefKey: PreferenceKey) {
	if (hasOwn(source, key)) {
		commitPreference(prefKey, source[key]);
	}
}

async function loadLegacySources(): Promise<LegacySources> {
	const accountSuffix = $i ? `::${$i.id}` : '';
	const [baseDevice, baseDeviceAccount, baseAccount, deckDeviceAccount] = await Promise.all([
		idbGet('pizzax::base'),
		$i ? idbGet(`pizzax::base${accountSuffix}`) : Promise.resolve({}),
		$i ? idbGet(`pizzax::base::cache${accountSuffix}`) : Promise.resolve({}),
		$i ? idbGet(`pizzax::deck${accountSuffix}`) : Promise.resolve({}),
	]);

	return {
		baseDevice: toRecord(baseDevice),
		baseDeviceAccount: toRecord(baseDeviceAccount),
		baseAccount: toRecord(baseAccount),
		deckDeviceAccount: toRecord(deckDeviceAccount),
	};
}

async function migrateLegacyThemes() {
	if (!$i) return;

	const themes = await misskeyApi('i/registry/get', { scope: ['client'], key: 'themes' }).catch(() => []);
	if (Array.isArray(themes) && themes.length > 0) {
		commitPreference('themes', themes);
	}
}

async function migrateLegacyDeckProfiles(currentProfile: unknown) {
	if (!$i) return;

	if (typeof currentProfile === 'string') {
		commitPreference('deck.profile', currentProfile);
	}

	const keys = await misskeyApi('i/registry/keys', {
		scope: ['client', 'deck', 'profiles'],
	}).catch(() => []);

	const profiles: DeckProfile[] = [];
	for (const key of keys) {
		const deck = await misskeyApi('i/registry/get', {
			scope: ['client', 'deck', 'profiles'],
			key,
		}).catch(() => null);
		if (!isObject(deck) || !Array.isArray(deck.columns) || !Array.isArray(deck.layout)) continue;
		profiles.push({
			id: genId(),
			name: key,
			columns: deck.columns,
			layout: deck.layout,
		});
	}

	if (profiles.length > 0) {
		commitPreference('deck.profiles', profiles);
	}
}

function migrateLegacyEmojiPalettes(account: LegacyRecord) {
	const hasReactions = hasOwn(account, 'reactions') && Array.isArray(account['reactions']);
	const hasPinnedEmojis = hasOwn(account, 'pinnedEmojis') && Array.isArray(account['pinnedEmojis']);
	if (!hasReactions && !hasPinnedEmojis) return;

	commitPreference('emojiPalettes', [{
		id: 'reactions',
		name: '',
		emojis: hasReactions ? account['reactions'] : prefer.s.emojiPalettes[0]?.emojis ?? [],
	}, {
		id: 'pinnedEmojis',
		name: '',
		emojis: hasPinnedEmojis ? account['pinnedEmojis'] : [],
	}]);
	commitPreference('emojiPaletteForMain', 'pinnedEmojis');
	commitPreference('emojiPaletteForReaction', 'reactions');
}

function migrateLegacyBaseSettings(sources: LegacySources) {
	const { baseDevice: device, baseDeviceAccount: deviceAccount, baseAccount: account } = sources;

	migrateLegacyEmojiPalettes(account);

	commitIfPresent('widgets', account, 'widgets');
	commitIfPresent('keepCw', account, 'keepCw');
	commitIfPresent('collapseRenotes', account, 'collapseRenotes');
	commitIfPresent('rememberNoteVisibility', account, 'rememberNoteVisibility');
	commitIfPresent('uploadFolder', account, 'uploadFolder');
	commitIfPresent('pinnedUserLists', deviceAccount, 'pinnedUserLists');
	commitIfPresent('statusbars', deviceAccount, 'statusbars');
	commitIfPresent('overridedDeviceKind', device, 'overridedDeviceKind');
	commitIfPresent('serverDisconnectedBehavior', device, 'serverDisconnectedBehavior');
	commitIfPresent('nsfw', device, 'nsfw');
	commitIfPresent('highlightSensitiveMedia', device, 'highlightSensitiveMedia');
	commitIfPresent('animation', device, 'animation');
	commitIfPresent('animatedMfm', device, 'animatedMfm');
	commitIfPresent('advancedMfm', device, 'advancedMfm');
	commitIfPresent('showReactionsCount', device, 'showReactionsCount');
	commitIfPresent('enableQuickAddMfmFunction', device, 'enableQuickAddMfmFunction');
	commitIfPresent('loadRawImages', device, 'loadRawImages');
	commitIfPresent('imageNewTab', device, 'imageNewTab');
	commitIfPresent('disableShowingAnimatedImages', device, 'disableShowingAnimatedImages');
	commitIfPresent('emojiStyle', device, 'emojiStyle');
	commitIfPresent('menuStyle', device, 'menuStyle');
	commitIfPresent('useBlurEffectForModal', device, 'useBlurEffectForModal');
	commitIfPresent('useBlurEffect', device, 'useBlurEffect');
	commitIfPresent('showFixedPostForm', device, 'showFixedPostForm');
	commitIfPresent('showFixedPostFormInChannel', device, 'showFixedPostFormInChannel');
	commitIfPresent('enableInfiniteScroll', device, 'enableInfiniteScroll');
	commitIfPresent('useReactionPickerForContextMenu', device, 'useReactionPickerForContextMenu');
	commitIfPresent('instanceTicker', device, 'instanceTicker');
	commitIfPresent('emojiPickerScale', device, 'emojiPickerScale');
	commitIfPresent('emojiPickerWidth', device, 'emojiPickerWidth');
	commitIfPresent('emojiPickerHeight', device, 'emojiPickerHeight');
	commitIfPresent('emojiPickerStyle', device, 'emojiPickerStyle');
	commitIfPresent('reportError', device, 'reportError');
	commitIfPresent('squareAvatars', device, 'squareAvatars');
	commitIfPresent('showAvatarDecorations', device, 'showAvatarDecorations');
	commitIfPresent('numberOfPageCache', device, 'numberOfPageCache');
	commitIfPresent('showNoteActionsOnlyHover', device, 'showNoteActionsOnlyHover');
	commitIfPresent('showClipButtonInNoteFooter', device, 'showClipButtonInNoteFooter');
	commitIfPresent('reactionsDisplaySize', device, 'reactionsDisplaySize');
	commitIfPresent('limitWidthOfReaction', device, 'limitWidthOfReaction');
	commitIfPresent('forceShowAds', device, 'forceShowAds');
	commitIfPresent('aiChanMode', device, 'aiChanMode');
	commitIfPresent('devMode', device, 'devMode');
	commitIfPresent('mediaListWithOneImageAppearance', device, 'mediaListWithOneImageAppearance');
	commitIfPresent('notificationPosition', device, 'notificationPosition');
	commitIfPresent('notificationStackAxis', device, 'notificationStackAxis');
	commitIfPresent('enableCondensedLine', device, 'enableCondensedLine');
	commitIfPresent('keepScreenOn', device, 'keepScreenOn');
	commitIfPresent('useGroupedNotifications', device, 'useGroupedNotifications');
	commitIfPresent('enableSeasonalScreenEffect', device, 'enableSeasonalScreenEffect');
	commitIfPresent('enableHorizontalSwipe', device, 'enableHorizontalSwipe');
	commitIfPresent('hemisphere', device, 'hemisphere');
	commitIfPresent('keepOriginalFilename', device, 'keepOriginalFilename');
	commitIfPresent('alwaysConfirmFollow', device, 'alwaysConfirmFollow');
	commitIfPresent('confirmWhenRevealingSensitiveMedia', device, 'confirmWhenRevealingSensitiveMedia');
	commitIfPresent('contextMenu', device, 'contextMenu');
	commitIfPresent('skipNoteRender', device, 'skipNoteRender');
	commitIfPresent('showSoftWordMutedWord', device, 'showSoftWordMutedWord');
	commitIfPresent('confirmOnReact', device, 'confirmOnReact');
	commitIfPresent('defaultNoteVisibility', account, 'defaultNoteVisibility');
	commitIfPresent('defaultNoteLocalOnly', account, 'defaultNoteLocalOnly');

	if (hasOwn(deviceAccount, 'menu') && Array.isArray(deviceAccount['menu'])) {
		const menu = deviceAccount['menu'].includes('chat') ? deviceAccount['menu'] : [...deviceAccount['menu'], 'chat'];
		commitPreference('menu', menu);
	}

	if (hasOwn(device, 'dataSaver') && isObject(device['dataSaver'])) {
		commitPreference('dataSaver', {
			...prefer.s.dataSaver,
			media: device['dataSaver'].media ?? prefer.s.dataSaver.media,
			avatar: device['dataSaver'].avatar ?? prefer.s.dataSaver.avatar,
			urlPreviewThumbnail: device['dataSaver'].urlPreview ?? prefer.s.dataSaver.urlPreviewThumbnail,
			code: device['dataSaver'].code ?? prefer.s.dataSaver.code,
		});
	}

	if (hasOwn(device, 'useNativeUIForVideoAudioPlayer')) {
		commitPreference('useNativeUiForVideoAudioPlayer', device['useNativeUIForVideoAudioPlayer']);
	}
	if (hasOwn(account, 'defaultWithReplies')) {
		commitPreference('defaultFollowWithReplies', account['defaultWithReplies']);
	}
	if (hasOwn(device, 'dropAndFusion')) {
		commitPreference('game.dropAndFusion', device['dropAndFusion']);
	}

	commitIfPresent('sound_masterVolume', device, 'sound.masterVolume');
	commitIfPresent('sound_notUseSound', device, 'sound.notUseSound');
	commitIfPresent('sound_useSoundOnlyWhenActive', device, 'sound.useSoundOnlyWhenActive');
	commitIfPresent('sound_note', device, 'sound.on.note');
	commitIfPresent('sound_noteMy', device, 'sound.on.noteMy');
	commitIfPresent('sound_notification', device, 'sound.on.notification');
	commitIfPresent('sound_reaction', device, 'sound.on.reaction');
}

export async function migrateOldSettings() {
	const sources = await loadLegacySources();
	await Promise.all([
		migrateLegacyThemes(),
		migrateLegacyDeckProfiles(sources.deckDeviceAccount['profile']),
	]);
	migrateLegacyBaseSettings(sources);
}
