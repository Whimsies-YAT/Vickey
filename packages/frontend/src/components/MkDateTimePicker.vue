<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_formBlock">
	<div class="label" v-if="label">{{ label }}</div>
	<div :class="$style.inputWrapper">
		<div ref="prefixEl" :class="$style.prefix"><slot name="prefix"></slot></div>
		<VueDatePicker
			v-model="internalValue"
			:placeholder="placeholder"
			:format="format"
			:disabled="disabled"
			:readonly="readonly"
			:required="required"
			:time-picker="timeOnly"
			:date-picker="dateOnly"
			:enable-time-picker="enableTimePicker"
			:month-picker="monthOnly"
			:year-picker="yearOnly"
			:range="range"
			:multi-calendars="multiCalendars"
			:locale="locale"
			:clearable="clearable"
			:close-on-select="closeOnSelect"
			:close-on-auto-apply="closeOnAutoApply"
			:auto-apply="autoApply"
			:dark="isDark"
			:teleport="true"
			:class="$style.datePicker"
			@update:model-value="onUpdate"
			@open="onOpen"
			@closed="onClosed"
			@focus="onFocus"
			@blur="onBlur"
		/>
	</div>
	<div class="caption" v-if="caption">{{ caption }}</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch, useTemplateRef } from 'vue';
import VueDatePicker from '@vuepic/vue-datepicker';
import { store } from '@/store.js';
import { lang } from '@@/js/config.js';
import { useInterval } from '@@/js/use-interval.js';
import '@vuepic/vue-datepicker/dist/main.css';

const props = defineProps<{
	modelValue?: string | Date | null;
	placeholder?: string;
	label?: string;
	caption?: string;
	format?: string | ((date: Date) => string);
	disabled?: boolean;
	readonly?: boolean;
	required?: boolean;
	timeOnly?: boolean;
	dateOnly?: boolean;
	enableTimePicker?: boolean;
	monthOnly?: boolean;
	yearOnly?: boolean;
	range?: boolean;
	multiCalendars?: boolean;
	clearable?: boolean;
	closeOnSelect?: boolean;
	closeOnAutoApply?: boolean;
	autoApply?: boolean;
}>();

const emit = defineEmits<{
	'update:modelValue': [value: string | Date | null];
	'open': [];
	'closed': [];
	'focus': [];
	'blur': [];
}>();

const internalValue = ref(props.modelValue);
const prefixEl = useTemplateRef('prefixEl');

watch(() => props.modelValue, (newValue) => {
	internalValue.value = newValue;
});

const isDark = computed(() => {
	return store.s.darkMode;
});

const locale = computed(() => {
	return lang.split('-')[0] || 'en';
});

const onUpdate = (value: string | Date | null) => {
	internalValue.value = value;
	emit('update:modelValue', value);
};

const onOpen = () => {
	emit('open');
};

const onClosed = () => {
	emit('closed');
};

const onFocus = () => {
	emit('focus');
};

const onBlur = () => {
	emit('blur');
};

useInterval(() => {
	const inputWrap = document.querySelector('.dp__input_wrap .dp__input') as HTMLElement;
	if (!inputWrap || !prefixEl.value) return;

	if (prefixEl.value.offsetWidth) {
		inputWrap.style.paddingLeft = prefixEl.value.offsetWidth + 'px';
	}
}, 100, {
	immediate: true,
	afterMounted: true,
});
</script>

<style lang="scss" module>
.datePicker {
	width: 100%;

	:global(.dp__input_wrap) {
		position: relative;
	}

	:global(.dp__input) {
		appearance: none;
		-webkit-appearance: none;
		display: block;
		height: 36px;
		width: 100%;
		margin: 0;
		padding: 0 12px;
		font: inherit;
		font-weight: normal;
		font-size: 1em;
		color: var(--MI_THEME-fg) !important;
		background: var(--MI_THEME-panel) !important;
		border: solid 1px var(--MI_THEME-panel) !important;
		border-radius: 6px !important;
		outline: none;
		box-shadow: none;
		box-sizing: border-box;
		transition: border-color 0.1s ease-out;

		&:hover {
			border-color: var(--MI_THEME-inputBorderHover) !important;
		}

		&:focus {
			border-color: var(--MI_THEME-accent) !important;
		}

		&:disabled {
			opacity: 0.7;
			cursor: not-allowed;
		}

		&::placeholder {
			color: var(--MI_THEME-fgTransparentWeak) !important;
		}
	}

	:global(.dp__clear_icon) {
		color: var(--MI_THEME-fgTransparentWeak) !important;

		&:hover {
			color: var(--MI_THEME-accent) !important;
		}
	}

	:global(.dp__input_icon) {
		color: var(--MI_THEME-fgTransparentWeak) !important;

		&:hover {
			color: var(--MI_THEME-accent) !important;
		}
	}

	:global(.dp__menu) {
		background: var(--MI_THEME-panel) !important;
		border: 1px solid var(--MI_THEME-divider) !important;
		border-radius: 8px !important;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
		color: var(--MI_THEME-fg) !important;
		z-index: 1000000 !important;
	}

	:global(.dp__calendar_header) {
		background: var(--MI_THEME-panel) !important;
		color: var(--MI_THEME-fg) !important;
	}

	:global(.dp__calendar_header_item) {
		color: var(--MI_THEME-fgTransparentWeak) !important;
		font-weight: 600 !important;
	}

	:global(.dp__month_year_wrap) {
		background: var(--MI_THEME-panel) !important;
	}

	:global(.dp__month_year_select) {
		color: var(--MI_THEME-fg) !important;
		background: var(--MI_THEME-panel) !important;

		&:hover {
			background: var(--MI_THEME-buttonHoverBg) !important;
			color: var(--MI_THEME-accent) !important;
		}
	}

	:global(.dp__arrow_top),
	:global(.dp__arrow_bottom),
	:global(.dp__inner_nav) {
		color: var(--MI_THEME-fgTransparentWeak) !important;

		&:hover {
			background: var(--MI_THEME-buttonHoverBg) !important;
			color: var(--MI_THEME-accent) !important;
		}
	}

	:global(.dp__calendar_item) {
		color: var(--MI_THEME-fg) !important;
		border-radius: 4px !important;

		&:hover {
			background: var(--MI_THEME-buttonHoverBg) !important;
			color: var(--MI_THEME-accent) !important;
		}
	}

	:global(.dp__active_date) {
		background: var(--MI_THEME-accent) !important;
		color: var(--MI_THEME-fgOnAccent) !important;

		&:hover {
			background: var(--MI_THEME-accent) !important;
			color: var(--MI_THEME-fgOnAccent) !important;
		}
	}

	:global(.dp__today) {
		border: 1px solid var(--MI_THEME-accent) !important;

		&:hover {
			background: var(--MI_THEME-buttonHoverBg) !important;
		}
	}

	:global(.dp__calendar_item.dp__date_hover_start),
	:global(.dp__calendar_item.dp__date_hover_end),
	:global(.dp__calendar_item.dp__date_hover) {
		background: var(--MI_THEME-buttonHoverBg) !important;
	}

	:global(.dp__calendar_item.dp__cell_disabled) {
		color: var(--MI_THEME-fgTransparentWeak) !important;
		opacity: 0.5 !important;
		cursor: not-allowed !important;

		&:hover {
			background: transparent !important;
		}
	}

	:global(.dp__time_picker) {
		background: var(--MI_THEME-panel) !important;
		border-top: 1px solid var(--MI_THEME-divider) !important;
	}

	:global(.dp__time_input) {
		color: var(--MI_THEME-fg) !important;
		background: var(--MI_THEME-panel) !important;
		border: 1px solid var(--MI_THEME-divider) !important;
		border-radius: 4px !important;

		&:focus {
			border-color: var(--MI_THEME-accent) !important;
			outline: none !important;
		}
	}

	:global(.dp__action_buttons) {
		background: var(--MI_THEME-panel) !important;
		border-top: 1px solid var(--MI_THEME-divider) !important;
	}

	:global(.dp__action_button) {
		background: var(--MI_THEME-panel) !important;
		color: var(--MI_THEME-fg) !important;
		border: 1px solid var(--MI_THEME-divider) !important;
		border-radius: 4px !important;

		&:hover {
			background: var(--MI_THEME-buttonHoverBg) !important;
			color: var(--MI_THEME-accent) !important;
		}
	}

	:global(.dp__selection_preview) {
		color: var(--MI_THEME-fgTransparentWeak) !important;
	}
}

.label {
	font-size: 0.85em;
	padding: 0 0 8px 0;
	user-select: none;
	color: var(--MI_THEME-fg);

	&:empty {
		display: none;
	}
}

.caption {
	font-size: 0.85em;
	padding: 8px 0 0 0;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);

	&:empty {
		display: none;
	}
}

.inputWrapper {
	position: relative;

	.prefix {
		display: flex;
		align-items: center;
		position: absolute;
		z-index: 10;
		top: 0;
		left: 0;
		padding: 0 12px;
		font-size: 1em;
		height: 36px;
		min-width: 16px;
		max-width: 150px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		box-sizing: border-box;
		pointer-events: none;
		color: var(--MI_THEME-fgTransparentWeak);

		&:empty {
			display: none;
		}
	}
}

.inputWrapper .datePicker :global(.dp__input) {
	padding-left: 40px !important;
}
</style>
