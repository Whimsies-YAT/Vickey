<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :reversed="tab === 'chat'" :tabs="headerTabs" :actions="headerActions">
	<div v-if="tab === 'chat'" class="_spacer" style="--MI_SPACER-w: 700px;">
		<div class="_gaps">
			<MkResult v-if="error === 'notFoundUser'" type="notFound" :text="i18n.ts.noSuchUser">
				<MkButton :class="$style.retryButton" rounded @click="initialize()">{{ i18n.ts.retry }}</MkButton>
			</MkResult>
			<MkResult v-else-if="error === 'notFoundRoom'" type="notFound" :text="i18n.ts.noSuchRoom">
				<MkButton :class="$style.retryButton" rounded @click="initialize()">{{ i18n.ts.retry }}</MkButton>
			</MkResult>
			<MkError v-else-if="error === 'error'" @retry="initialize()"/>

			<div v-else-if="initializing">
				<MkLoading/>
			</div>

			<div v-else-if="messages.length === 0">
				<div class="_gaps" style="text-align: center;">
					<div>{{ i18n.ts._chat.noMessagesYet }}</div>
					<template v-if="user">
						<div v-if="user.chatScope === 'followers'">{{ i18n.ts._chat.thisUserAllowsChatOnlyFromFollowers }}</div>
						<div v-else-if="user.chatScope === 'following'">{{ i18n.ts._chat.thisUserAllowsChatOnlyFromFollowing }}</div>
						<div v-else-if="user.chatScope === 'mutual'">{{ i18n.ts._chat.thisUserAllowsChatOnlyFromMutualFollowing }}</div>
						<div v-else-if="user.chatScope === 'none'">{{ i18n.ts._chat.thisUserNotAllowedChatAnyone }}</div>
					</template>
					<template v-else-if="room">
						<div>{{ i18n.ts._chat.inviteUserToChat }}</div>
					</template>
				</div>
			</div>

			<div v-else ref="timelineEl" class="_gaps">
				<div v-if="canFetchMore">
					<MkButton :class="$style.more" :wait="moreFetching" primary rounded @click="fetchMore">{{ i18n.ts.loadMore }}</MkButton>
				</div>

				<TransitionGroup
					:enterActiveClass="prefer.s.animation ? $style.transition_x_enterActive : ''"
					:leaveActiveClass="prefer.s.animation ? $style.transition_x_leaveActive : ''"
					:enterFromClass="prefer.s.animation ? $style.transition_x_enterFrom : ''"
					:leaveToClass="prefer.s.animation ? $style.transition_x_leaveTo : ''"
					:moveClass="prefer.s.animation ? $style.transition_x_move : ''"
					tag="div" class="_gaps"
				>
					<template v-for="item in timeline.toReversed()" :key="item.id">
						<XMessage v-if="item.type === 'item'" :message="item.data"/>
						<div v-else-if="item.type === 'date'" :class="$style.dateDivider">
							<span><i class="ti ti-chevron-up"></i> {{ item.nextText }}</span>
							<span style="height: 1em; width: 1px; background: var(--MI_THEME-divider);"></span>
							<span>{{ item.prevText }} <i class="ti ti-chevron-down"></i></span>
						</div>
					</template>
				</TransitionGroup>
			</div>

			<div v-if="user && (!user.canChat || user.host !== null)">
				<MkInfo warn>{{ i18n.ts._chat.chatNotAvailableInOtherAccount }}</MkInfo>
			</div>

			<MkInfo v-if="$i.policies.chatAvailability !== 'available'" warn>{{ $i.policies.chatAvailability === 'readonly' ? i18n.ts._chat.chatIsReadOnlyForThisAccountOrServer : i18n.ts._chat.chatNotAvailableForThisAccountOrServer }}</MkInfo>
		</div>
	</div>

	<div v-else-if="tab === 'search'" class="_spacer" style="--MI_SPACER-w: 700px;">
		<XSearch :userId="userId" :roomId="roomId"/>
	</div>

	<div v-else-if="tab === 'members'" class="_spacer" style="--MI_SPACER-w: 700px;">
		<XMembers v-if="room != null" :room="room" @inviteUser="inviteUser"/>
	</div>

	<div v-else-if="tab === 'info'" class="_spacer" style="--MI_SPACER-w: 700px;">
		<XInfo v-if="room != null" :room="room"/>
	</div>

	<template #footer>
		<div v-if="tab === 'chat'" :class="$style.footer">
			<div class="_gaps">
				<!-- Voice Call Status Banner -->
				<Transition name="fade">
					<div v-if="voiceCall.currentCall.value" :class="$style.voiceCallBanner">
						<div :class="$style.voiceCallContent">
							<div :class="$style.voiceCallIcon">
								<i v-if="voiceCall.currentCall.value.state === 'calling'" class="ti ti-phone-calling"></i>
								<i v-else-if="voiceCall.currentCall.value.state === 'ringing'" class="ti ti-phone-incoming"></i>
								<i v-else-if="voiceCall.currentCall.value.state === 'connecting'" class="ti ti-loader-2"></i>
								<i v-else-if="voiceCall.currentCall.value.state === 'connected'" class="ti ti-phone"></i>
							</div>
							<div :class="$style.voiceCallInfo">
								<div :class="$style.voiceCallState">
									<template v-if="voiceCall.currentCall.value.state === 'calling'">
										{{ i18n.ts._chat.calling }}...
									</template>
									<template v-else-if="voiceCall.currentCall.value.state === 'ringing'">
										{{ i18n.ts._chat.incomingCall }}
									</template>
									<template v-else-if="voiceCall.currentCall.value.state === 'connecting'">
										{{ i18n.ts._chat.connecting }}...
									</template>
									<template v-else-if="voiceCall.currentCall.value.state === 'connected'">
										<i class="ti ti-point-filled" :class="[$style.statusDot, voiceCall.connectionState.value === 'connected' ? $style.statusConnected : $style.statusConnecting]"></i>
										{{ formatCallDuration(voiceCall.callDuration.value) }}
									</template>
								</div>
								<div v-if="user" :class="$style.voiceCallUser">
									{{ user.name || user.username }}
								</div>
							</div>
							<div v-if="voiceCall.currentCall.value.state === 'ringing' && voiceCall.currentCall.value.isIncoming" :class="$style.voiceCallControls">
								<button class="_button" :class="$style.voiceCallAnswerButton" @click="answerVoiceCall">
									<i class="ti ti-phone"></i>
									{{ i18n.ts._chat.answer }}
								</button>
								<button class="_button" :class="$style.voiceCallEndButton" @click="rejectVoiceCall">
									<i class="ti ti-phone-off"></i>
									{{ i18n.ts._chat.reject }}
								</button>
							</div>
							<div v-else-if="voiceCall.currentCall.value.state === 'connected'" :class="$style.voiceCallControls">
								<button class="_button" :class="$style.voiceCallControlButton" @click="toggleMute">
									<i :class="voiceCall.localMuted.value ? 'ti ti-microphone-off' : 'ti ti-microphone'"></i>
								</button>
								<div :class="$style.volumeControl">
									<i class="ti ti-volume"></i>
									<input
										type="range"
										min="0"
										max="100"
										:value="voiceCall.remoteVolume.value * 100"
										:class="$style.volumeSlider"
										@input="onVolumeChange"
									/>
								</div>
								<button class="_button" :class="$style.voiceCallEndButton" @click="endVoiceCall">
									<i class="ti ti-phone-off"></i>
								</button>
							</div>
							<div v-else :class="$style.voiceCallControls">
								<button class="_button" :class="$style.voiceCallEndButton" @click="endVoiceCall">
									<i class="ti ti-phone-off"></i>
								</button>
							</div>
						</div>
					</div>
				</Transition>

				<Transition name="fade">
					<div v-show="showIndicator" :class="$style.new">
						<button class="_buttonPrimary" :class="$style.newButton" @click="onIndicatorClick">
							<i class="fas ti-fw fa-arrow-circle-down" :class="$style.newIcon"></i>{{ i18n.ts._chat.newMessage }}
						</button>
					</div>
				</Transition>
				<XForm v-if="initialized" :user="user" :room="room" :class="$style.form"/>
			</div>
		</div>
		<audio ref="remoteAudioEl" autoplay playsinline muted="false" style="display: none;"></audio>
	</template>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef, computed, onMounted, onBeforeUnmount, onDeactivated, onActivated, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { getScrollContainer } from '@@/js/scroll.js';
import XMessage from './XMessage.vue';
import XForm from './room.form.vue';
import XSearch from './room.search.vue';
import XMembers from './room.members.vue';
import XInfo from './room.info.vue';
import type { MenuItem } from '@/types/menu.js';
import type { PageHeaderItem } from '@/types/page-header.js';
import * as os from '@/os.js';
import { useStream } from '@/stream.js';
import * as sound from '@/utility/sound.js';
import { i18n } from '@/i18n.js';
import { ensureSignin } from '@/i.js';
import { instance } from '@/instance.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { prefer } from '@/preferences.js';
import MkButton from '@/components/MkButton.vue';
import { useRouter } from '@/router.js';
import { useMutationObserver } from '@/composables/use-mutation-observer.js';
import MkInfo from '@/components/MkInfo.vue';
import { makeDateSeparatedTimelineComputedRef } from '@/utility/timeline-date-separate.js';
import { useVoiceCall } from '@/composables/useVoiceCall.js';

const $i = ensureSignin();
const router = useRouter();

const props = defineProps<{
	userId?: string;
	roomId?: string;
}>();

export type NormalizedChatMessage = Omit<Misskey.entities.ChatMessageLite, 'fromUser' | 'reactions'> & {
	fromUser: Misskey.entities.UserLite;
	reactions: (Misskey.entities.ChatMessageLite['reactions'][number] & {
		user: Misskey.entities.UserLite;
	})[];
};

const initializing = ref(false);
const initialized = ref(false);
const moreFetching = ref(false);
const messages = ref<NormalizedChatMessage[]>([]);
const canFetchMore = ref(false);
const user = ref<Misskey.entities.UserDetailed | null>(null);
const room = ref<Misskey.entities.ChatRoom | null>(null);
const connection = ref<Misskey.IChannelConnection<Misskey.Channels['chatUser']> | Misskey.IChannelConnection<Misskey.Channels['chatRoom']> | null>(null);
const showIndicator = ref(false);
const error = ref<'notFoundUser' | 'notFoundRoom' | 'error' | null>(null);
const timelineEl = useTemplateRef('timelineEl');
const timeline = makeDateSeparatedTimelineComputedRef(messages);

const SCROLL_HEAD_THRESHOLD = 200;

// column-reverseなので本来はスクロール位置の最下部への追従は不要なはずだが、おそらくブラウザのバグにより、最下部にスクロールした状態でも追従されない場合がある(スクロール位置が少数になることがあるのが関わっていそう)
// そのため補助としてMutationObserverを使って追従を行う
useMutationObserver(timelineEl, {
	subtree: true,
	childList: true,
	attributes: false,
}, () => {
	const scrollContainer = getScrollContainer(timelineEl.value)!;
	// column-reverseなのでscrollTopは負になる
	if (-scrollContainer.scrollTop < SCROLL_HEAD_THRESHOLD) {
		scrollContainer.scrollTo({
			top: 0,
			behavior: 'instant',
		});
	}
});

function normalizeMessage(message: Misskey.entities.ChatMessageLite | Misskey.entities.ChatMessage): NormalizedChatMessage {
	return {
		...message,
		fromUser: message.fromUser ?? (message.fromUserId === $i.id ? $i : user.value!),
		reactions: message.reactions.map(record => ({
			...record,
			user: record.user ?? (message.fromUserId === $i.id ? user.value! : $i),
		})),
	};
}

async function initialize() {
	const LIMIT = 20;

	if (initializing.value) return;

	initializing.value = true;
	initialized.value = false;

	if (props.userId) {
		try {
			const [u, m] = await Promise.all([
				misskeyApi('users/show', { userId: props.userId }),
				misskeyApi('chat/messages/user-timeline', { userId: props.userId, limit: LIMIT }),
			]);

			user.value = u as Misskey.entities.UserDetailed;
			messages.value = m.map(x => normalizeMessage(x));
			error.value = null;

			if (messages.value.length === LIMIT) {
				canFetchMore.value = true;
			}

			connection.value = useStream().useChannel('chatUser', {
				otherId: user.value.id,
			});
			connection.value.on('message', onMessage);
			connection.value.on('deleted', onDeleted);
			connection.value.on('react', onReact);
			connection.value.on('unreact', onUnreact);
		} catch (err: any) {
			if (err.code === 'NO_SUCH_USER') {
				error.value = 'notFoundUser';
			} else {
				error.value = 'error';
			}
			initializing.value = false;
			return;
		}
	} else if (props.roomId) {
		const [rResult, mResult] = await Promise.allSettled([
			misskeyApi('chat/rooms/show', { roomId: props.roomId }),
			misskeyApi('chat/messages/room-timeline', { roomId: props.roomId, limit: LIMIT }),
		]);

		if (rResult.status === 'rejected') {
			const err: any = rResult.reason;
			if (err.code === 'NO_SUCH_ROOM') {
				error.value = 'notFoundRoom';
			} else {
				error.value = 'error';
			}
			initializing.value = false;
			return;
		}

		const r = rResult.value as Misskey.entities.ChatRoomsShowResponse;
		error.value = null;

		if (r.invitationExists) {
			const confirm = await os.confirm({
				type: 'question',
				title: r.name,
				text: i18n.ts._chat.youAreNotAMemberOfThisRoomButInvited + '\n' + i18n.ts._chat.doYouAcceptInvitation,
			});
			if (confirm.canceled) {
				initializing.value = false;
				router.push('/chat');
				return;
			} else {
				await os.apiWithDialog('chat/rooms/join', { roomId: r.id });
				initializing.value = false;
				initialize();
				return;
			}
		}

		const m = mResult.status === 'fulfilled' ? mResult.value as Misskey.entities.ChatMessagesRoomTimelineResponse : [];

		room.value = r;
		messages.value = m.map(x => normalizeMessage(x));

		if (messages.value.length === LIMIT) {
			canFetchMore.value = true;
		}

		connection.value = useStream().useChannel('chatRoom', {
			roomId: room.value.id,
		});
		connection.value.on('message', onMessage);
		connection.value.on('deleted', onDeleted);
		connection.value.on('react', onReact);
		connection.value.on('unreact', onUnreact);
	}

	window.document.addEventListener('visibilitychange', onVisibilitychange);

	initialized.value = true;
	initializing.value = false;
}

let isActivated = true;

onActivated(() => {
	isActivated = true;
});

onDeactivated(() => {
	isActivated = false;
});

async function fetchMore() {
	const LIMIT = 30;

	moreFetching.value = true;

	const newMessages = props.userId ? await misskeyApi('chat/messages/user-timeline', {
		userId: user.value!.id,
		limit: LIMIT,
		untilId: messages.value[messages.value.length - 1].id,
	}) : await misskeyApi('chat/messages/room-timeline', {
		roomId: room.value!.id,
		limit: LIMIT,
		untilId: messages.value[messages.value.length - 1].id,
	});

	messages.value.push(...newMessages.map(x => normalizeMessage(x)));

	canFetchMore.value = newMessages.length === LIMIT;
	moreFetching.value = false;
}

function onMessage(message: Misskey.entities.ChatMessageLite) {
	sound.playMisskeySfx('chatMessage');

	messages.value.unshift(normalizeMessage(message));

	// TODO: DOM的にバックグラウンドになっていないかどうかも考慮する
	if (message.fromUserId !== $i.id && !window.document.hidden && isActivated) {
		connection.value?.send('read', {
			id: message.id,
		});
	}

	if (message.fromUserId !== $i.id) {
		//notifyNewMessage();
	}
}

function onDeleted(id: string) {
	const index = messages.value.findIndex(m => m.id === id);
	if (index !== -1) {
		messages.value.splice(index, 1);
	}
}

function onReact(ctx: Parameters<Misskey.Channels['chatUser']['events']['react']>[0] | Parameters<Misskey.Channels['chatRoom']['events']['react']>[0]) {
	const message = messages.value.find(m => m.id === ctx.messageId);
	if (message) {
		if (room.value == null) { // 1on1の時はuserは省略される
			message.reactions.push({
				reaction: ctx.reaction,
				user: message.fromUserId === $i.id ? user.value! : $i,
			});
		} else {
			message.reactions.push({
				reaction: ctx.reaction,
				user: ctx.user!,
			});
		}
	}
}

function onUnreact(ctx: Parameters<Misskey.Channels['chatUser']['events']['unreact']>[0] | Parameters<Misskey.Channels['chatRoom']['events']['unreact']>[0]) {
	const message = messages.value.find(m => m.id === ctx.messageId);
	if (message) {
		const index = message.reactions.findIndex(r => r.reaction === ctx.reaction && r.user.id === ctx.user!.id);
		if (index !== -1) {
			message.reactions.splice(index, 1);
		}
	}
}

function onIndicatorClick() {
	showIndicator.value = false;
}

function notifyNewMessage() {
	showIndicator.value = true;
}

function onVisibilitychange() {
	if (window.document.hidden) return;
	// TODO
}

onMounted(() => {
	initialize();
});

onActivated(() => {
	if (!initialized.value) {
		initialize();
	}
});

onBeforeUnmount(() => {
	connection.value?.dispose();
	window.document.removeEventListener('visibilitychange', onVisibilitychange);
});

async function inviteUser() {
	if (room.value == null) return;

	const invitee = await os.selectUser({ includeSelf: false, localOnly: true });
	os.apiWithDialog('chat/rooms/invitations/create', {
		roomId: room.value.id,
		userId: invitee.id,
	});
}

async function leaveRoom() {
	if (room.value == null) return;

	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts.areYouSure,
	});
	if (canceled) return;

	misskeyApi('chat/rooms/leave', {
		roomId: room.value.id,
	});
	router.push('/chat');
}

function showMenu(ev: MouseEvent) {
	const menuItems: MenuItem[] = [];

	if (room.value) {
		if (room.value.ownerId === $i.id) {
			menuItems.push({
				text: i18n.ts._chat.inviteUser,
				icon: 'ti ti-user-plus',
				action: () => {
					inviteUser();
				},
			});
		} else {
			menuItems.push({
				text: i18n.ts._chat.leave,
				icon: 'ti ti-x',
				action: () => {
					leaveRoom();
				},
			});
		}
	}

	os.popupMenu(menuItems, ev.currentTarget ?? ev.target);
}

const tab = ref('chat');

const headerTabs = computed(() => room.value ? [{
	key: 'chat',
	title: i18n.ts._chat.messages,
	icon: 'ti ti-messages',
}, {
	key: 'members',
	title: i18n.ts._chat.members,
	icon: 'ti ti-users',
}, {
	key: 'search',
	title: i18n.ts.search,
	icon: 'ti ti-search',
}, {
	key: 'info',
	title: i18n.ts.info,
	icon: 'ti ti-info-circle',
}] : [{
	key: 'chat',
	title: i18n.ts._chat.messages,
	icon: 'ti ti-messages',
}, {
	key: 'search',
	title: i18n.ts.search,
	icon: 'ti ti-search',
}]);

const voiceCall = useVoiceCall();
const isVoiceCallDialogOpen = ref(false);
const remoteAudioEl = useTemplateRef<HTMLAudioElement>('remoteAudioEl');
let incomingCallDialog: { close: () => void } | null = null;
let voiceCallNotificationId: Notification | null = null;
const ringtoneAudio = new Audio('/client-assets/sounds/vickey/phone-ring.wav');
ringtoneAudio.loop = true;
let isRingtonePlaying = false;
let lastHandledCallId: string | null = null;

function playRingtone() {
	if (isRingtonePlaying) return;
	isRingtonePlaying = true;
	ringtoneAudio.currentTime = 0;
	ringtoneAudio.play().catch(console.error);
}

function stopRingtone() {
	if (!isRingtonePlaying) return;
	isRingtonePlaying = false;
	ringtoneAudio.pause();
	ringtoneAudio.currentTime = 0;
}

function showVoiceCallNotification(state: string, userName: string) {
	if (voiceCallNotificationId) {
		voiceCallNotificationId.close();
		voiceCallNotificationId = null;
	}

	let message = '';

	switch (state) {
		case 'ringing':
			message = i18n.tsx._chat.incomingCallFrom({ name: userName });
			break;
		case 'calling':
			message = `${i18n.ts._chat.calling} ${userName}...`;
			break;
		case 'connecting':
			message = `${i18n.ts._chat.connecting} ${userName}...`;
			break;
		case 'connected':
			message = `${i18n.ts._chat.voiceCallInProgress} - ${userName}`;
			break;
	}

	if (window.Notification && Notification.permission === 'granted') {
		voiceCallNotificationId = new Notification(i18n.ts._chat.incomingCall, {
			body: message,
			tag: 'voice-call',
		});
	} else {
		os.toast(message);
	}
}

function closeVoiceCallNotification() {
	if (voiceCallNotificationId) {
		voiceCallNotificationId.close();
		voiceCallNotificationId = null;
	}
	stopRingtone();
}

watch(() => voiceCall.currentCall.value, (call, oldCall) => {
	const userName = user.value?.name ?? user.value?.username ?? i18n.ts.unknown;

	if (call) {
		showVoiceCallNotification(call.state, userName);

		if (call.state === 'ringing' && call.isIncoming) {
			playRingtone();

			if (call.callId !== lastHandledCallId) {
				lastHandledCallId = call.callId;
				handleIncomingCall(call);
			}
		} else {
			stopRingtone();
		}
	}
	if (oldCall && !call) {
		lastHandledCallId = null;
		isVoiceCallDialogOpen.value = false;
		closeVoiceCallNotification();

		const duration = voiceCall.callDuration.value;
		if (duration > 0) {
			const durationText = formatCallDuration(duration);
			os.toast(i18n.tsx._chat.callDuration({ duration: durationText }));
		}

		if (incomingCallDialog) {
			incomingCallDialog.close();
			incomingCallDialog = null;
		}
	}
}, { deep: true });

watch(() => voiceCall.remoteStream.value, async (stream) => {
	console.log('Remote stream changed:', stream);
	if (stream && remoteAudioEl.value) {
		console.log('Setting remote audio stream');

		const audioEl = remoteAudioEl.value;
		audioEl.srcObject = stream;
		audioEl.volume = 1.0;
		audioEl.muted = false;

		const audioTracks = stream.getAudioTracks();
		console.log('Stream audio tracks:', audioTracks.length);
		audioTracks.forEach((track, index) => {
			console.log(`Track ${index}:`, {
				id: track.id,
				label: track.label,
				enabled: track.enabled,
				muted: track.muted,
				readyState: track.readyState,
			});
		});

		await new Promise(resolve => window.setTimeout(resolve, 100));

		try {
			await audioEl.play();
			console.log('Remote audio playing successfully');

			console.log('Audio element state:', {
				paused: audioEl.paused,
				muted: audioEl.muted,
				volume: audioEl.volume,
				readyState: audioEl.readyState,
			});
		} catch (error) {
			console.error('Failed to play remote audio:', error);

			const playAudio = () => {
				audioEl.play()
					.then(() => {
						console.log('Audio playing after user interaction');
						window.document.removeEventListener('click', playAudio);
					})
					.catch(err => console.error('Still failed to play:', err));
			};
			window.document.addEventListener('click', playAudio, { once: true });
		}
	}
}, { immediate: true });

async function handleIncomingCall(call: any) {
	const userName = user.value?.name ?? user.value?.username ?? i18n.ts.unknown;
	const dialogPromise = os.confirmAdvanced({
		type: 'question',
		title: i18n.ts._chat.incomingCall,
		text: i18n.tsx._chat.incomingCallFrom({ name: userName }),
	});

	incomingCallDialog = dialogPromise;
	const { canceled } = await dialogPromise;
	incomingCallDialog = null;

	if (canceled) {
		voiceCall.reject();
	} else {
		isVoiceCallDialogOpen.value = true;
		await voiceCall.answer();
	}
}

async function startVoiceCall() {
	if (!user.value) return;
	if (!instance.enableCloudflareSfu) {
		os.alert({
			type: 'error',
			text: i18n.ts._chat.voiceCallNotEnabled,
		});
		return;
	}

	isVoiceCallDialogOpen.value = true;

	try {
		await voiceCall.call(user.value.id, 'sfu');
	} catch (error) {
		os.alert({
			type: 'error',
			text: i18n.ts._chat.failedToStartVoiceCall,
		});
		isVoiceCallDialogOpen.value = false;
	}
}

function endVoiceCall() {
	voiceCall.end();
	isVoiceCallDialogOpen.value = false;
}

async function answerVoiceCall() {
	if (incomingCallDialog) {
		incomingCallDialog.close();
		incomingCallDialog = null;
	}
	isVoiceCallDialogOpen.value = true;
	await voiceCall.answer();
}

function rejectVoiceCall() {
	if (incomingCallDialog) {
		incomingCallDialog.close();
		incomingCallDialog = null;
	}
	voiceCall.reject();
}

function formatCallDuration(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function toggleMute() {
	voiceCall.toggleLocalMute();
}

function onVolumeChange(event: Event) {
	const target = event.target as HTMLInputElement;
	const volume = parseInt(target.value) / 100;
	voiceCall.setRemoteVolume(volume);
	if (remoteAudioEl.value) {
		remoteAudioEl.value.volume = volume;
	}
}

onMounted(() => {
	console.log('Remote audio element ready');
	if (voiceCall.remoteStream.value && remoteAudioEl.value) {
		console.log('Connecting existing remote stream');
		remoteAudioEl.value.srcObject = voiceCall.remoteStream.value;
		remoteAudioEl.value.volume = 1.0;
		remoteAudioEl.value.play().catch(console.error);
	}
});

onBeforeUnmount(() => {
	if (voiceCall.currentCall.value) {
		voiceCall.end();
	}
	if (remoteAudioEl.value) {
		remoteAudioEl.value.srcObject = null;
	}
});

const headerActions = computed<PageHeaderItem[]>(() => {
	const actions: PageHeaderItem[] = [];

	if (user.value && instance.enableCloudflareSfu) {
		actions.push({
			icon: voiceCall.currentCall.value ? 'ti ti-phone-off' : 'ti ti-phone',
			text: voiceCall.currentCall.value ? i18n.ts._chat.endCall : i18n.ts._chat.startVoiceCall,
			handler: voiceCall.currentCall.value ? endVoiceCall : startVoiceCall,
		});
	}

	actions.push({
		icon: 'ti ti-dots',
		handler: showMenu,
	});

	return actions;
});

definePage(computed(() => {
	if (initialized.value) {
		if (user.value) {
			return {
				userName: user.value,
				title: user.value.name ?? user.value.username,
				avatar: user.value,
			};
		} else if (room.value) {
			return {
				title: room.value.name,
				icon: 'ti ti-users',
			};
		} else {
			return {
				title: i18n.ts.directMessage,
			};
		}
	} else {
		return {
			title: i18n.ts.directMessage,
		};
	}
}));
</script>

<style lang="scss" module>
.transition_x_move,
.transition_x_enterActive,
.transition_x_leaveActive {
	transition: opacity 0.2s cubic-bezier(0,.5,.5,1), transform 0.2s cubic-bezier(0,.5,.5,1) !important;
}
.transition_x_enterFrom,
.transition_x_leaveTo {
	opacity: 0;
	transform: translateY(80px);
}
.transition_x_leaveActive {
	position: absolute;
}

.more {
	margin: 0 auto;
}

.footer {
	width: 100%;
	padding-top: 8px;
}

.new {
	width: 100%;
	padding-bottom: 8px;
	text-align: center;
}

.newButton {
	display: inline-block;
	margin: 0;
	padding: 0 12px;
	line-height: 32px;
	font-size: 12px;
	border-radius: 16px;
}

.newIcon {
	display: inline-block;
	margin-right: 8px;
}

.form {
	margin: 0 auto;
	width: 100%;
	max-width: 700px;
}

.fade-enter-active, .fade-leave-active {
	transition: opacity 0.1s;
}

.fade-enter-from, .fade-leave-to {
	transition: opacity 0.5s;
	opacity: 0;
}

.dateDivider {
	display: flex;
	font-size: 85%;
	align-items: center;
	justify-content: center;
	gap: 0.5em;
	opacity: 0.75;
	border: solid 0.5px var(--MI_THEME-divider);
	border-radius: 999px;
	width: fit-content;
	padding: 0.5em 1em;
	margin: 0 auto;
}

.voiceCallBanner {
	width: 100%;
	background: linear-gradient(135deg, var(--MI_THEME-accent) 0%, color-mix(in srgb, var(--MI_THEME-accent) 80%, black) 100%);
	color: var(--MI_THEME-fgOnAccent);
	border-radius: 6px;
	padding: 6px 16px;
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
	backdrop-filter: blur(10px);
}

@keyframes pulse {
	0%, 100% {
		opacity: 1;
		transform: scale(1);
	}
	50% {
		opacity: 0.9;
		transform: scale(0.98);
	}
}

.voiceCallContent {
	display: flex;
	align-items: center;
	gap: 10px;
}

.voiceCallIcon {
	font-size: 20px;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 40px;
	height: 40px;
	background: rgba(255, 255, 255, 0.15);
	border-radius: 50%;

	i {
		display: block;
		animation: iconPulse 1.5s ease-in-out infinite;
	}
}

@keyframes iconPulse {
	0%, 100% {
		transform: scale(1);
	}
	50% {
		transform: scale(1.1);
	}
}

.voiceCallInfo {
	flex: 1;
	min-width: 0;
}

.voiceCallState {
	font-weight: bold;
	font-size: 14px;
}

.voiceCallUser {
	font-size: 12px;
	opacity: 0.9;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.statusDot {
	font-size: 12px;
	margin-right: 4px;
	vertical-align: middle;
}

.statusConnected {
	color: var(--MI_THEME-success);
	animation: blink 2s ease-in-out infinite;
}

.statusConnecting {
	color: var(--MI_THEME-warn);
	animation: blink 1s ease-in-out infinite;
}

@keyframes blink {
	0%, 100% {
		opacity: 1;
	}
	50% {
		opacity: 0.3;
	}
}

.voiceCallControls {
	display: flex;
	align-items: center;
	gap: 8px;
}

.voiceCallControlButton {
	background: rgba(255, 255, 255, 0.15);
	color: var(--MI_THEME-fgOnAccent);
	border-radius: 50%;
	width: 36px;
	height: 36px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 16px;
	transition: all 0.2s;

	&:hover {
		background: rgba(255, 255, 255, 0.25);
		transform: scale(1.05);
	}

	&:active {
		transform: scale(0.95);
	}
}

.volumeControl {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 14px;
}

.volumeSlider {
	width: 80px;
	height: 4px;
	-webkit-appearance: none;
	appearance: none;
	background: rgba(255, 255, 255, 0.3);
	border-radius: 2px;
	outline: none;

	&::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 14px;
		height: 14px;
		background: var(--MI_THEME-fgOnAccent);
		border-radius: 50%;
		cursor: pointer;
		transition: all 0.2s;

		&:hover {
			transform: scale(1.2);
		}
	}

	&::-moz-range-thumb {
		width: 14px;
		height: 14px;
		background: var(--MI_THEME-fgOnAccent);
		border-radius: 50%;
		cursor: pointer;
		border: none;
		transition: all 0.2s;

		&:hover {
			transform: scale(1.2);
		}
	}
}

.voiceCallAnswerButton {
	background: color-mix(in srgb, var(--MI_THEME-success) 90%, transparent);
	color: var(--MI_THEME-fgOnAccent);
	border-radius: 20px;
	padding: 8px 16px;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	font-size: 14px;
	font-weight: bold;
	transition: all 0.2s;
	box-shadow: 0 2px 8px color-mix(in srgb, var(--MI_THEME-success) 30%, transparent);

	&:hover {
		background: var(--MI_THEME-success);
		transform: scale(1.05);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--MI_THEME-success) 40%, transparent);
	}

	&:active {
		transform: scale(0.95);
	}
}

.voiceCallEndButton {
	background: color-mix(in srgb, var(--MI_THEME-error) 90%, transparent);
	color: var(--MI_THEME-fgOnAccent);
	border-radius: 50%;
	width: 40px;
	height: 40px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 18px;
	transition: all 0.2s;
	box-shadow: 0 2px 8px color-mix(in srgb, var(--MI_THEME-error) 30%, transparent);

	&:hover {
		background: var(--MI_THEME-error);
		transform: scale(1.05);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--MI_THEME-error) 40%, transparent);
	}

	&:active {
		transform: scale(0.95);
	}
}

.retryButton {
	margin: 0 auto;
}
</style>
