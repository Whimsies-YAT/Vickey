/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Directive } from 'vue';
import { getBgColor } from '@/utility/get-bg-color.js';
import { themeManager } from '@/theme.js';

const handlerMap = new WeakMap<HTMLElement, () => void>();
const cachedResults = new WeakMap<any, string>();

function debounce<T extends (...args: any[]) => any>(func: T, wait: number): T {
	let timeout: number | undefined;
	return ((...args: any[]) => {
		if (timeout !== undefined) {
			window.clearTimeout(timeout);
		}
		timeout = window.setTimeout(() => func(...args), wait);
	}) as T;
}

export const adaptiveBorderDirective = {
	mounted(src) {
		function calc() {
			const parentBg = getBgColor(src.parentElement) ?? 'transparent';
			const myBg = window.getComputedStyle(src).backgroundColor;

			const cacheKey = `${parentBg}-${myBg}`;
			const cached = cachedResults.get(src);

			if (cached === cacheKey) {
				return;
			}

			let borderColor: string;
			if (parentBg === myBg) {
				borderColor = 'var(--MI_THEME-divider)';
			} else {
				borderColor = myBg;
			}

			if (src.style.borderColor !== borderColor) {
				src.style.borderColor = borderColor;
			}

			cachedResults.set(src, cacheKey);
		}

		const debouncedCalc = debounce(calc, 16);

		handlerMap.set(src, debouncedCalc);

		calc();

		themeManager.on('themeChanged', calc);
	},

	unmounted(src) {
		themeManager.off('themeChanged', handlerMap.get(src));
		cachedResults.delete(src);
	},
} as Directive<HTMLElement>;
