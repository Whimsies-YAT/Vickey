<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_selectable">
	<div :class="$style.label" @click="focus"><slot name="label"></slot></div>

	<div v-if="isDateTimeType" :class="$style.dateTimeWrapper">
		<MkDateTimePicker
			v-model="dateTimeValue"
			:placeholder="placeholder"
			:disabled="disabled"
			:required="required"
			:readonly="readonly"
			:timeOnly="type === 'time'"
			:dateOnly="type === 'date'"
			:enableSeconds="false"
			@focus="focused = true"
			@blur="focused = false"
			@update:modelValue="onDateTimeUpdate"
		>
			<template v-if="$slots.prefix" #prefix>
				<slot name="prefix"></slot>
			</template>
		</MkDateTimePicker>
	</div>

	<div v-else :class="[$style.input, { [$style.inline]: inline, [$style.disabled]: disabled, [$style.focused]: focused }]">
		<div ref="prefixEl" :class="$style.prefix"><slot name="prefix"></slot></div>
		<input
			ref="inputEl"
			v-model="v"
			v-adaptive-border
			:class="$style.inputCore"
			:type="type"
			:disabled="disabled"
			:required="required"
			:readonly="readonly"
			:placeholder="placeholder"
			:pattern="pattern"
			:autocomplete="autocomplete"
			:autocapitalize="autocapitalize"
			:spellcheck="spellcheck"
			:inputmode="inputmode"
			:step="step"
			:list="id"
			:min="min"
			:max="max"
			:style="{
				paddingLeft: prefixWidth ? prefixWidth + 'px' : undefined,
				paddingRight: suffixWidth ? suffixWidth + 'px' : undefined,
			}"
			@focus="focused = true"
			@blur="focused = false"
			@keydown="onKeydown($event)"
			@input="onInput"
		>
		<datalist v-if="datalist" :id="id">
			<option v-for="data in datalist" :key="data" :value="data"></option>
		</datalist>
		<div ref="suffixEl" :class="$style.suffix"><slot name="suffix"></slot></div>
	</div>
	<div :class="$style.caption"><slot name="caption"></slot></div>

	<MkButton v-if="manualSave && changed" primary :class="$style.save" @click="updated"><i class="ti ti-check"></i> {{ i18n.ts.save }}</MkButton>
</div>
</template>

<script lang="ts">
type SupportedTypes = 'text' | 'password' | 'email' | 'url' | 'tel' | 'number' | 'search' | 'date' | 'time' | 'datetime-local' | 'color' | 'range';
type ModelValueType<T extends SupportedTypes> =
	T extends 'number' | 'range' ? number :
	T extends 'text' | 'password' | 'email' | 'url' | 'tel' | 'search' | 'date' | 'time' | 'datetime-local' | 'color' ? string :
	never;
</script>

<script lang="ts" setup generic="T extends SupportedTypes = 'text'">
import { onMounted, onUnmounted, nextTick, ref, useTemplateRef, watch, computed, toRefs } from 'vue';
import { debounce } from 'throttle-debounce';
import { useInterval } from '@@/js/use-interval.js';
import MkDateTimePicker from './MkDateTimePicker.vue';
import type { InputHTMLAttributes } from 'vue';
import type { SuggestionType } from '@/utility/autocomplete.js';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { Autocomplete } from '@/utility/autocomplete.js';
import { genId } from '@/utility/id.js';

const props = defineProps<{
	modelValue: ModelValueType<T> | null;
	type?: T;
	required?: boolean;
	readonly?: boolean;
	disabled?: boolean;
	pattern?: string;
	placeholder?: string;
	autofocus?: boolean;
	autocomplete?: string;
	mfmAutocomplete?: boolean | SuggestionType[],
	autocapitalize?: string;
	spellcheck?: boolean;
	inputmode?: InputHTMLAttributes['inputmode'];
	step?: InputHTMLAttributes['step'];
	datalist?: string[];
	min?: number;
	max?: number;
	inline?: boolean;
	debounce?: boolean;
	manualSave?: boolean;
	small?: boolean;
	large?: boolean;
	modelModifiers?: Record<string, boolean>;
}>();

const emit = defineEmits<{
	(ev: 'change', _ev: InputEvent): void;
	(ev: 'keydown', _ev: KeyboardEvent): void;
	(ev: 'enter', _ev: KeyboardEvent): void;
	(ev: 'update:modelValue', value: ModelValueType<T>): void;
	(ev: 'savingStateChange', saved: boolean, invalid: boolean): void;
}>();

const { modelValue } = toRefs(props);
const v = ref<ModelValueType<T> | null>(modelValue.value);
const dateTimeValue = ref<string | Date | null | undefined>(modelValue.value);
const id = genId();
const focused = ref(false);
const changed = ref(false);
const invalid = ref(false);
const filled = computed(() => v.value !== '' && v.value != null);
const inputEl = useTemplateRef('inputEl');
const prefixEl = useTemplateRef('prefixEl');
const suffixEl = useTemplateRef('suffixEl');
const height =
	props.small ? 33 :
	props.large ? 39 :
	36;
let autocompleteWorker: Autocomplete | null = null;
const prefixWidth = ref<number | null>(null);
const suffixWidth = ref<number | null>(null);
let resizeObserver: ResizeObserver | null = null;

const isDateTimeType = computed(() => {
	return props.type === 'date' || props.type === 'time' || props.type === 'datetime-local';
});

const onDateTimeUpdate = (value: string | Date | null) => {
	let formattedValue = '';

	if (value) {
		if (typeof value === 'string') {
			formattedValue = value;
		} else {
			if (props.type === 'date') {
				formattedValue = `${value.getFullYear()}-${(value.getMonth() + 1).toString().padStart(2, '0')}-${value.getDate().toString().padStart(2, '0')}`;
			} else if (props.type === 'time') {
				formattedValue = `${value.getHours().toString().padStart(2, '0')}:${value.getMinutes().toString().padStart(2, '0')}:${value.getSeconds().toString().padStart(2, '0')}`;
			} else if (props.type === 'datetime-local') {
				formattedValue = `${value.getFullYear()}-${(value.getMonth() + 1).toString().padStart(2, '0')}-${value.getDate().toString().padStart(2, '0')}T${value.getHours().toString().padStart(2, '0')}:${value.getMinutes().toString().padStart(2, '0')}:${value.getSeconds().toString().padStart(2, '0')}`;
			}
		}
	}

	v.value = formattedValue as ModelValueType<T>;
	changed.value = true;
};

const focus = () => inputEl.value?.focus();
const onInput = (event: InputEvent) => {
	changed.value = true;
	emit('change', event);
};
const onKeydown = (ev: KeyboardEvent) => {
	if (ev.isComposing || ev.key === 'Process' || ev.keyCode === 229) return;

	emit('keydown', ev);

	if (ev.code === 'Enter') {
		emit('enter', ev);
	}
};

const updated = () => {
	changed.value = false;
	if (props.type === 'number') {
		emit('update:modelValue', typeof v.value === 'number' ? v.value as ModelValueType<T> : parseFloat(v.value ?? '0') as ModelValueType<T>);
	} else {
		emit('update:modelValue', v.value ?? '');
	}
};

const debouncedUpdated = debounce(1000, updated);

watch(modelValue, newValue => {
	v.value = newValue;
	dateTimeValue.value = newValue;
});

watch(v, () => {
	if (!props.manualSave) {
		if (props.debounce) {
			debouncedUpdated();
		} else {
			updated();
		}
	}

	invalid.value = inputEl.value?.validity.badInput ?? true;
});

watch([changed, invalid], ([newChanged, newInvalid]) => {
	emit('savingStateChange', newChanged, newInvalid);
}, { immediate: true });

onMounted(() => {
	nextTick(() => {
		if (props.autofocus) {
			focus();
		}
		updateWidths();
	});

	if (props.mfmAutocomplete && inputEl.value) {
		autocompleteWorker = new Autocomplete(inputEl.value, v, props.mfmAutocomplete === true ? undefined : props.mfmAutocomplete);
	}

	const updateWidths = () => {
		if (prefixEl.value) {
			const w = prefixEl.value.offsetWidth;
			prefixWidth.value = w ? w + 12 : null;
		} else {
			prefixWidth.value = null;
		}

		if (suffixEl.value) {
			const w = suffixEl.value.offsetWidth;
			suffixWidth.value = w ? w + 12 : null;
		} else {
			suffixWidth.value = null;
		}
	};

	resizeObserver = new ResizeObserver(() => {
		updateWidths();
	});

	if (prefixEl.value) resizeObserver.observe(prefixEl.value);
	if (suffixEl.value) resizeObserver.observe(suffixEl.value);

	window.addEventListener('resize', updateWidths);
});

onUnmounted(() => {
	if (autocompleteWorker) {
		autocompleteWorker.detach();
	}
	if (resizeObserver) {
		resizeObserver.disconnect();
	}
	window.removeEventListener('resize', updateWidths);
});

defineExpose({
	focus,
});
</script>

<style lang="scss" module>
.label {
	font-size: 0.85em;
	padding: 0 0 8px 0;
	user-select: none;

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

.input {
	position: relative;

	&.inline {
		display: inline-block;
		margin: 0;
	}

	&.focused {
		> .inputCore {
			border-color: var(--MI_THEME-accent) !important;
			//box-shadow: 0 0 0 4px var(--MI_THEME-focus);
		}
	}

	&.disabled {
		opacity: 0.7;

		&,
		> .inputCore {
			cursor: not-allowed !important;
		}
	}
}

.inputCore {
	appearance: none;
	-webkit-appearance: none;
	display: block;
	height: v-bind("height + 'px'");
	width: 100%;
	margin: 0;
	padding: 0 12px;
	font: inherit;
	font-weight: normal;
	font-size: 1em;
	color: var(--MI_THEME-fg);
	background: var(--MI_THEME-panel);
	border: solid 1px var(--MI_THEME-panel);
	border-radius: 6px;
	outline: none;
	box-shadow: none;
	box-sizing: border-box;
	transition: border-color 0.1s ease-out;

	&:hover {
		border-color: var(--MI_THEME-inputBorderHover) !important;
	}
}

.inputCore[type="range"] {
	padding: 0;
	background: transparent;

	&::-webkit-slider-runnable-track {
		width: 100%;
		height: 8px;
		cursor: pointer;
		background: color(from var(--MI_THEME-accent) srgb r g b / 0.25);
		border-radius: 4px;
	}

	&::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		height: 20px;
		width: 20px;
		border-radius: 50%;
		background: var(--MI_THEME-accent);
		cursor: pointer;
		margin-top: -6px;
		transition: transform 0.1s ease;
	}

	&::-moz-range-track {
		width: 100%;
		height: 8px;
		cursor: pointer;
		background: color(from var(--MI_THEME-accent) srgb r g b / 0.25);
		border-radius: 4px;
	}

	&::-moz-range-thumb {
		height: 20px;
		width: 20px;
		border-radius: 50%;
		background: var(--MI_THEME-accent);
		cursor: pointer;
		border: none;
		transition: transform 0.1s ease;
	}

	&:focus::-webkit-slider-thumb {
		box-shadow: 0 0 0 4px var(--MI_THEME-focus);
	}
	&:focus::-moz-range-thumb {
		box-shadow: 0 0 0 4px var(--MI_THEME-focus);
	}
}

.inputCore[type="date"],
.inputCore[type="time"],
.inputCore[type="datetime-local"] {
	appearance: none;
	-webkit-appearance: none;
	-moz-appearance: textfield;
	color: var(--MI_THEME-fg) !important;
	background: var(--MI_THEME-panel) !important;
	border: solid 1px var(--MI_THEME-panel) !important;
	font-family: inherit !important;
	font-size: 1em !important;

	&:hover {
		border-color: var(--MI_THEME-inputBorderHover) !important;
	}

	&:focus {
		border-color: var(--MI_THEME-accent) !important;
	}

	&:invalid {
		border-color: var(--MI_THEME-error) !important;
	}
}

.prefix,
.suffix {
	display: flex;
	align-items: center;
	position: absolute;
	z-index: 1;
	top: 0;
	padding: 0 12px;
	font-size: 1em;
	height: v-bind("height + 'px'");
	min-width: 16px;
	max-width: 150px;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
	box-sizing: border-box;
	pointer-events: none;

	&:empty {
		display: none;
	}
}

.prefix {
	left: 0;
	padding-right: 6px;
}

.suffix {
	right: 0;
	padding-left: 6px;
}
.save {
	margin: 8px 0 0 0;
}

.dateTimeWrapper {
	position: relative;
	display: block;
	width: 100%;
	z-index: 1;
}
</style>
