import 'misskey-js';
import type * as Misskey from 'misskey-js';

declare module 'misskey-js' {
	namespace Channels {
		interface gomokuGame {
			events: Channels['gomokuGame']['events'] & {
				log: (payload: [number, number]) => void;
				ended: (payload: { game: Misskey.entities.GomokuGameDetailed }) => void;
				changeReadyStates: (payload: { user1: boolean; user2: boolean }) => void;
			};
		}

		interface werewolfGame {
			events: Channels['werewolfGame']['events'] & {
				transitionDelay: (payload: { remaining: number; reason?: string }) => void;
			};
		}
	}
}
