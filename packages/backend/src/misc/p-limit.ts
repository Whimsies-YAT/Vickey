/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

type QueueItem<T> = {
	fn: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (error: any) => void;
};

export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new TypeError('Expected `concurrency` to be a positive integer');
	}

	const queue: QueueItem<any>[] = [];
	let activeCount = 0;

	const next = () => {
		activeCount--;
		if (queue.length > 0) {
			const item = queue.shift()!;
			run(item.fn, item.resolve, item.reject);
		}
	};

	const run = <T>(fn: () => Promise<T>, resolve: (value: T) => void, reject: (error: any) => void) => {
		activeCount++;
		(async () => {
			try {
				resolve(await fn());
			} catch (error) {
				reject(error);
			} finally {
				next();
			}
		})();
	};

	return <T>(fn: () => Promise<T>): Promise<T> => {
		return new Promise((resolve, reject) => {
			if (activeCount < concurrency) {
				run(fn, resolve, reject);
			} else {
				queue.push({ fn, resolve, reject });
			}
		});
	};
}

export async function pMap<T, R>(
	items: readonly T[],
	mapper: (item: T, index: number) => Promise<R>,
	concurrency: number,
): Promise<R[]> {
	if (concurrency === Infinity || concurrency >= items.length) {
		return Promise.all(items.map(mapper));
	}

	const limit = pLimit(concurrency);
	return Promise.all(items.map((item, index) => limit(() => mapper(item, index))));
}
