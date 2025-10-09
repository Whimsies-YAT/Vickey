<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_formBlock">
	<div v-if="label" class="label">{{ label }}</div>
	<div :class="$style.inputWrapper">
		<div ref="prefixEl" :class="$style.prefix"><slot name="prefix"></slot></div>
		<input
			ref="inputEl"
			:class="$style.input"
			:value="displayValue"
			:placeholder="placeholder"
			:disabled="disabled"
			:readonly="readonly"
			:required="required"
			@click="showPicker"
			@focus="showPicker"
		/>
	</div>
	<div v-if="caption" class="caption">{{ caption }}</div>
</div>

<teleport to="body">
	<div v-if="showDropdown" :class="$style.dropdown" data-mk-datetime-dropdown @click.stop>
			<div v-if="!timeOnly && (showDateView || dateOnly)" :class="$style.calendar">
				<div :class="$style.header">
					<button type="button" :class="$style.navButton" @click="prevMonth">‹</button>
					<div :class="$style.monthYear" @click="showYearMonthPicker = !showYearMonthPicker">
						{{ currentMonthYear }}
						<i class="ti ti-chevron-down" :class="{ [$style.rotated]: showYearMonthPicker }"></i>
					</div>
					<button type="button" :class="$style.navButton" @click="nextMonth">›</button>
				</div>
				<div v-if="showYearMonthPicker" :class="$style.yearMonthPicker">
					<div :class="$style.yearPicker">
						<select v-model="selectedYear" :class="$style.selectInput">
							<option v-for="year in availableYears" :key="year" :value="year">{{ year }}</option>
						</select>
					</div>
					<div :class="$style.monthPicker">
						<select v-model="selectedMonth" :class="$style.selectInput">
							<option v-for="(month, index) in monthNames" :key="index" :value="index">{{ month }}</option>
						</select>
					</div>
				</div>
				<div :class="$style.weekDays">
					<div v-for="(day, index) in weekDays" :key="index" :class="$style.weekDay">{{ day }}</div>
				</div>
				<div :class="$style.days">
					<button
						v-for="day in calendarDays"
						:key="day.key"
						type="button"
						:class="[
							$style.day,
							{ [$style.otherMonth]: day.otherMonth },
							{ [$style.today]: day.isToday },
							{ [$style.selected]: day.isSelected }
						]"
						@click="selectDate(day)"
					>
						{{ day.date }}
					</button>
				</div>
			</div>
			<div v-if="!dateOnly && (showTimeView || timeOnly)" :class="$style.timePicker">
				<div :class="$style.timeControls">
					<div :class="$style.timeGroup">
						<label>{{ i18n.ts.hour || 'H' }}</label>
						<div :class="$style.timeInput">
							<button type="button" :class="$style.timeButton" @click="adjustTime('hour', 1)">▲</button>
							<input
								v-model.number="selectedHour"
								type="number"
								min="0"
								max="23"
								:class="$style.timeValue"
							/>
							<button type="button" :class="$style.timeButton" @click="adjustTime('hour', -1)">▼</button>
						</div>
					</div>
					<div :class="$style.timeGroup">
						<label>{{ i18n.ts.minute || 'M' }}</label>
						<div :class="$style.timeInput">
							<button type="button" :class="$style.timeButton" @click="adjustTime('minute', 1)">▲</button>
							<input
								v-model.number="selectedMinute"
								type="number"
								min="0"
								max="59"
								:class="$style.timeValue"
							/>
							<button type="button" :class="$style.timeButton" @click="adjustTime('minute', -1)">▼</button>
						</div>
					</div>
					<div v-if="enableSeconds" :class="$style.timeGroup">
						<label>{{ i18n.ts.second || 'S' }}</label>
						<div :class="$style.timeInput">
							<button type="button" :class="$style.timeButton" @click="adjustTime('second', 1)">▲</button>
							<input
								v-model.number="selectedSecond"
								type="number"
								min="0"
								max="59"
								:class="$style.timeValue"
							/>
							<button type="button" :class="$style.timeButton" @click="adjustTime('second', -1)">▼</button>
						</div>
					</div>
				</div>
			</div>
			<div v-if="!dateOnly && !timeOnly" :class="$style.viewToggle">
				<button type="button" :class="[$style.toggleButton, { [$style.active]: showDateView }]" @click="toggleView('date')">
					<i class="ti ti-calendar"></i>
					{{ i18n.ts.date || 'Date' }}
				</button>
				<button type="button" :class="[$style.toggleButton, { [$style.active]: showTimeView }]" @click="toggleView('time')">
					<i class="ti ti-clock"></i>
					{{ i18n.ts.time || 'Time' }}
				</button>
			</div>
			<div :class="$style.actions">
				<button type="button" :class="$style.actionButton" @click="setToday">{{ i18n.ts.now || 'Now' }}</button>
				<div :class="$style.actionRight">
					<button type="button" :class="[$style.actionButton, $style.cancel]" @click="cancel">{{ i18n.ts.cancel || 'Cancel' }}</button>
					<button type="button" :class="[$style.actionButton, $style.confirm]" @click="confirm">{{ i18n.ts.ok || 'OK' }}</button>
				</div>
			</div>
		</div>
</teleport>
</template>

<script lang="ts" setup>
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	modelValue?: string | Date | null;
	placeholder?: string;
	label?: string;
	caption?: string;
	disabled?: boolean;
	readonly?: boolean;
	required?: boolean;
	timeOnly?: boolean;
	dateOnly?: boolean;
	enableSeconds?: boolean;
}>();

const emit = defineEmits<{
	'update:modelValue': [value: string | Date | null];
	'open': [];
	'closed': [];
	'focus': [];
	'blur': [];
}>();

const inputEl = useTemplateRef('inputEl');
const showDropdown = ref(false);
const showYearMonthPicker = ref(false);
const showDateView = ref(true);
const showTimeView = ref(false);

const currentDate = ref(new Date());
const selectedDate = ref<Date | null>(null);
const selectedHour = ref(0);
const selectedMinute = ref(0);
const selectedSecond = ref(0);
const selectedYear = ref(new Date().getFullYear());
const selectedMonth = ref(new Date().getMonth());

const initializeDateTime = () => {
	const value = props.modelValue;
	let date: Date;

	if (value) {
		if (typeof value === 'string') {
			if (props.timeOnly) {
				const timeParts = value.split(':');
				const today = new Date();
				date = new Date(today.getFullYear(), today.getMonth(), today.getDate(),
					parseInt(timeParts[0]) || 0,
					parseInt(timeParts[1]) || 0,
					parseInt(timeParts[2]) || 0);
			} else if (props.dateOnly) {
				const dateParts = value.split('-');
				date = new Date(
					parseInt(dateParts[0]) || new Date().getFullYear(),
					(parseInt(dateParts[1]) || 1) - 1,
					parseInt(dateParts[2]) || 1,
					0, 0, 0, 0
				);
			} else {
				if (value.includes('T')) {
					const [datePart, timePart] = value.split('T');
					const [year, month, day] = datePart.split('-').map(Number);
					const timeSegments = timePart.split(':');
					const hour = parseInt(timeSegments[0]) || 0;
					const minute = parseInt(timeSegments[1]) || 0;
					const second = parseInt(timeSegments[2]) || 0;
					date = new Date(year, month - 1, day, hour, minute, second, 0);
				} else if (value.match(/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/)) {
					const [datePart, timePart] = value.split(' ');
					const [year, month, day] = datePart.split('-').map(Number);
					const timeSegments = timePart.split(':');
					const hour = parseInt(timeSegments[0]) || 0;
					const minute = parseInt(timeSegments[1]) || 0;
					const second = parseInt(timeSegments[2]) || 0;
					date = new Date(year, month - 1, day, hour, minute, second, 0);
				} else {
					const parsedDate = new Date(value);
					if (!isNaN(parsedDate.getTime())) {
						date = new Date(
							parsedDate.getFullYear(),
							parsedDate.getMonth(),
							parsedDate.getDate(),
							parsedDate.getHours(),
							parsedDate.getMinutes(),
							parsedDate.getSeconds(),
							0
						);
					} else {
						date = new Date();
					}
				}
			}
		} else {
			date = new Date(
				value.getFullYear(),
				value.getMonth(),
				value.getDate(),
				value.getHours(),
				value.getMinutes(),
				value.getSeconds(),
				0
			);
		}
	} else {
		date = new Date();
	}

	if (!isNaN(date.getTime())) {
		selectedDate.value = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
		selectedHour.value = date.getHours();
		selectedMinute.value = date.getMinutes();
		selectedSecond.value = date.getSeconds();
		currentDate.value = new Date(date.getFullYear(), date.getMonth(), 1);
		selectedYear.value = date.getFullYear();
		selectedMonth.value = date.getMonth();
	}

	if (props.timeOnly) {
		showDateView.value = false;
		showTimeView.value = true;
	} else if (props.dateOnly) {
		showDateView.value = true;
		showTimeView.value = false;
	} else {
		showDateView.value = true;
		showTimeView.value = false;
	}
};

onMounted(() => {
	initializeDateTime();
	window.document.addEventListener('click', handleOutsideClick);
});

onUnmounted(() => {
	window.document.removeEventListener('click', handleOutsideClick);
});

watch(() => props.modelValue, () => {
	initializeDateTime();
});

const displayValue = computed(() => {
	if (!selectedDate.value) return '';

	const date = new Date(
		selectedDate.value.getFullYear(),
		selectedDate.value.getMonth(),
		selectedDate.value.getDate(),
		selectedHour.value,
		selectedMinute.value,
		selectedSecond.value
	);

	if (props.timeOnly) {
		return `${selectedHour.value.toString().padStart(2, '0')}:${selectedMinute.value.toString().padStart(2, '0')}${props.enableSeconds ? ':' + selectedSecond.value.toString().padStart(2, '0') : ''}`;
	}

	if (props.dateOnly) {
		return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
	}

	return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${selectedHour.value.toString().padStart(2, '0')}:${selectedMinute.value.toString().padStart(2, '0')}${props.enableSeconds ? ':' + selectedSecond.value.toString().padStart(2, '0') : ''}`;
});

const currentMonthYear = computed(() => {
	const year = currentDate.value.getFullYear();
	const month = currentDate.value.getMonth() + 1;
	return `${year}/${month.toString().padStart(2, '0')}`;
});

const weekDays = computed(() => [
	i18n.ts.sunday || 'Sun',
	i18n.ts.monday || 'Mon',
	i18n.ts.tuesday || 'Tue',
	i18n.ts.wednesday || 'Wed',
	i18n.ts.thursday || 'Thu',
	i18n.ts.friday || 'Fri',
	i18n.ts.saturday || 'Sat'
]);

const monthNames = computed(() => [
	i18n.ts.january || 'Jan',
	i18n.ts.february || 'Feb',
	i18n.ts.march || 'Mar',
	i18n.ts.april || 'Apr',
	i18n.ts.may || 'May',
	i18n.ts.june || 'Jun',
	i18n.ts.july || 'Jul',
	i18n.ts.august || 'Aug',
	i18n.ts.september || 'Sep',
	i18n.ts.october || 'Oct',
	i18n.ts.november || 'Nov',
	i18n.ts.december || 'Dec'
]);

const availableYears = computed(() => {
	const currentYear = new Date().getFullYear();
	const years: number[] = [];
	for (let i = currentYear - 50; i <= currentYear + 50; i++) {
		years.push(i);
	}
	return years;
});

const calendarDays = computed(() => {
	const year = currentDate.value.getFullYear();
	const month = currentDate.value.getMonth();
	const firstDay = new Date(year, month, 1);
	const startDate = new Date(firstDay);
	startDate.setDate(startDate.getDate() - firstDay.getDay());

	const days: {
		key: string;
		date: number;
		fullDate: Date;
		otherMonth: boolean;
		isSelected: boolean;
		isToday: boolean;
	}[] = [];
	const today = new Date();

	for (let i = 0; i < 42; i++) {
		const date = new Date(startDate);
		date.setDate(startDate.getDate() + i);

		const isSelected = selectedDate.value ?
			date.getFullYear() === selectedDate.value.getFullYear() &&
			date.getMonth() === selectedDate.value.getMonth() &&
			date.getDate() === selectedDate.value.getDate() : false;

		const isToday =
			date.getFullYear() === today.getFullYear() &&
			date.getMonth() === today.getMonth() &&
			date.getDate() === today.getDate();

		days.push({
			key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
			date: date.getDate(),
			fullDate: new Date(date),
			otherMonth: date.getMonth() !== month,
			isSelected,
			isToday
		});
	}

	return days;
});

const showPicker = () => {
	if (props.disabled || props.readonly) return;
	showDropdown.value = true;
	emit('open');

	nextTick(() => {
		positionDropdown();
	});
};

const positionDropdown = () => {
	if (!inputEl.value) return;

	const inputRect = inputEl.value.getBoundingClientRect();
	const dropdown = window.document.querySelector('[data-mk-datetime-dropdown]') as HTMLElement;

	if (dropdown) {
		dropdown.style.left = `${inputRect.left}px`;
		dropdown.style.top = `${inputRect.bottom + 8}px`;
		dropdown.style.zIndex = '999999';
	}
};

const handleOutsideClick = (event: Event) => {
	if (!showDropdown.value) return;

	const target = event.target as Element;
	if (!inputEl.value?.contains(target) && !target.closest('[data-mk-datetime-dropdown]')) {
		showDropdown.value = false;
		emit('closed');
	}
};

const selectDate = (day: { fullDate: Date }) => {
	selectedDate.value = new Date(day.fullDate);
};

const prevMonth = () => {
	currentDate.value = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth() - 1, 1);
};

const nextMonth = () => {
	currentDate.value = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth() + 1, 1);
};

const adjustTime = (type: 'hour' | 'minute' | 'second', delta: number) => {
	if (type === 'hour') {
		selectedHour.value = Math.max(0, Math.min(23, selectedHour.value + delta));
	} else if (type === 'minute') {
		selectedMinute.value = Math.max(0, Math.min(59, selectedMinute.value + delta));
	} else if (type === 'second') {
		selectedSecond.value = Math.max(0, Math.min(59, selectedSecond.value + delta));
	}
};

const setToday = () => {
	const now = new Date();
	selectedDate.value = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
	selectedHour.value = now.getHours();
	selectedMinute.value = now.getMinutes();
	selectedSecond.value = now.getSeconds();
	currentDate.value = new Date(now.getFullYear(), now.getMonth(), 1);
	selectedYear.value = now.getFullYear();
	selectedMonth.value = now.getMonth();
};

const confirm = () => {
	if (!selectedDate.value) {
		selectedDate.value = new Date();
	}

	let finalDate: Date | string;

	if (props.timeOnly) {
		finalDate = `${selectedHour.value.toString().padStart(2, '0')}:${selectedMinute.value.toString().padStart(2, '0')}${props.enableSeconds ? ':' + selectedSecond.value.toString().padStart(2, '0') : ''}`;
	} else if (props.dateOnly) {
		finalDate = `${selectedDate.value.getFullYear()}-${(selectedDate.value.getMonth() + 1).toString().padStart(2, '0')}-${selectedDate.value.getDate().toString().padStart(2, '0')}`;
	} else {
		finalDate = new Date(
			selectedDate.value.getFullYear(),
			selectedDate.value.getMonth(),
			selectedDate.value.getDate(),
			selectedHour.value,
			selectedMinute.value,
			selectedSecond.value,
			0
		);
	}

	emit('update:modelValue', finalDate);
	showDropdown.value = false;
	emit('closed');
};

const cancel = () => {
	initializeDateTime();
	showDropdown.value = false;
	emit('closed');
};

const toggleView = (view: 'date' | 'time') => {
	if (view === 'date') {
		showDateView.value = true;
		showTimeView.value = false;
	} else {
		showDateView.value = false;
		showTimeView.value = true;
	}
};

watch([selectedYear, selectedMonth], ([newYear, newMonth]) => {
	currentDate.value = new Date(newYear, newMonth, 1);
	showYearMonthPicker.value = false;
});
</script>

<style lang="scss" module>
.input {
	appearance: none;
	display: block;
	height: 42px;
	width: 100%;
	margin: 0;
	padding: 0 16px;
	font: inherit;
	font-weight: 500;
	font-size: 1em;
	color: var(--MI_THEME-fg);
	background: var(--MI_THEME-panel);
	border: solid 2px var(--MI_THEME-divider);
	border-radius: 12px;
	outline: none;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	box-sizing: border-box;
	transition: all 0.3s ease;
	cursor: pointer;

	&:hover {
		border-color: var(--MI_THEME-inputBorderHover);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
	}

	&:focus {
		border-color: var(--MI_THEME-accent);
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
	}

	&:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	&::placeholder {
		color: var(--MI_THEME-fgTransparentWeak);
	}
}

.inputWrapper:has(.prefix:not(:empty)) .input {
	padding-left: 48px;
}

.dropdown {
	position: fixed;
	background: var(--MI_THEME-panel);
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 16px;
	box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15), 0 8px 24px rgba(0, 0, 0, 0.1);
	animation: fadeIn 0.2s ease-out;
	backdrop-filter: blur(8px);
	overflow: visible;
	min-width: 320px;
	width: auto;
	max-width: 400px;
	z-index: 999999 !important;
}

@keyframes fadeIn {
	from {
		opacity: 0;
		transform: translateY(-8px) scale(0.95);
	}
	to {
		opacity: 1;
		transform: translateY(0) scale(1);
	}
}

.calendar {
	padding: 16px;
}

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 16px;
}

.navButton {
	background: var(--MI_THEME-bg);
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 8px;
	width: 32px;
	height: 32px;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	color: var(--MI_THEME-fg);
	font-size: 18px;
	transition: all 0.2s ease;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
		border-color: var(--MI_THEME-accent);
		color: var(--MI_THEME-accent);
		transform: scale(1.05);
	}
}

.monthYear {
	font-weight: 600;
	font-size: 1.1em;
	color: var(--MI_THEME-fg);
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 8px;
	transition: color 0.2s ease;

	&:hover {
		color: var(--MI_THEME-accent);
	}

	i {
		font-size: 0.8em;
		transition: transform 0.2s ease;

		&.rotated {
			transform: rotate(180deg);
		}
	}
}

.weekDays {
	display: grid;
	grid-template-columns: repeat(7, 1fr);
	gap: 4px;
	margin-bottom: 8px;
}

.weekDay {
	text-align: center;
	font-size: 0.9em;
	font-weight: 600;
	color: var(--MI_THEME-fgTransparentWeak);
	padding: 8px 0;
}

.days {
	display: grid;
	grid-template-columns: repeat(7, 1fr);
	gap: 4px;
}

.day {
	background: transparent;
	border: none;
	border-radius: 8px;
	padding: 8px;
	text-align: center;
	cursor: pointer;
	color: var(--MI_THEME-fg);
	font-weight: 500;
	transition: all 0.15s ease;
	position: relative;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
		color: var(--MI_THEME-accent);
		transform: scale(1.05);
	}

	&.otherMonth {
		color: var(--MI_THEME-fgTransparentWeak);
		opacity: 0.5;
	}

	&.today {
		font-weight: 600;
		position: relative;

		&::after {
			content: '';
			position: absolute;
			bottom: 2px;
			left: 50%;
			transform: translateX(-50%);
			width: 6px;
			height: 2px;
			background: var(--MI_THEME-accent);
			border-radius: 1px;
		}
	}

	&.selected {
		background: var(--MI_THEME-accent);
		color: var(--MI_THEME-fgOnAccent);
		transform: scale(1.1);

		&:hover {
			background: var(--MI_THEME-accent);
			color: var(--MI_THEME-fgOnAccent);
		}
	}
}

.timePicker {
	border-top: 1px solid var(--MI_THEME-divider);
	padding: 16px;
}

.timeControls {
	display: flex;
	gap: 16px;
	justify-content: center;
}

.timeGroup {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;

	label {
		font-size: 0.9em;
		font-weight: 600;
		color: var(--MI_THEME-fgTransparentWeak);
	}
}

.timeInput {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
}

.timeButton {
	background: var(--MI_THEME-bg);
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 6px;
	width: 28px;
	height: 24px;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 12px;
	transition: all 0.2s ease;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
		border-color: var(--MI_THEME-accent);
		color: var(--MI_THEME-accent);
		transform: scale(1.1);
	}
}

.timeValue {
	background: var(--MI_THEME-bg);
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 6px;
	width: 60px;
	padding: 6px 8px;
	text-align: center;
	font-weight: 500;
	color: var(--MI_THEME-fg);
	transition: all 0.2s ease;

	&:focus {
		border-color: var(--MI_THEME-accent);
		outline: none;
		box-shadow: 0 0 0 2px color(from var(--MI_THEME-accent) srgb r g b / 0.2);
	}

	&::-webkit-outer-spin-button,
	&::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
}

.actions {
	border-top: 1px solid var(--MI_THEME-divider);
	padding: 12px 16px;
	display: flex;
	justify-content: space-between;
	align-items: center;
}

.actionRight {
	display: flex;
	gap: 8px;
}

.actionButton {
	background: var(--MI_THEME-bg);
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 8px;
	padding: 8px 16px;
	cursor: pointer;
	font-weight: 500;
	transition: all 0.2s ease;
	color: var(--MI_THEME-fg);

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
		border-color: var(--MI_THEME-accent);
		color: var(--MI_THEME-accent);
		transform: translateY(-1px);
	}

	&.confirm {
		background: var(--MI_THEME-accent);
		color: var(--MI_THEME-fgOnAccent);
		border-color: var(--MI_THEME-accent);

		&:hover {
			background: color(from var(--MI_THEME-accent) srgb r g b / 0.9);
			transform: translateY(-1px) scale(1.02);
		}
	}

	&.cancel {
		&:hover {
			background: var(--MI_THEME-error);
			border-color: var(--MI_THEME-error);
			color: var(--MI_THEME-fgOnError);
		}
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
		padding: 0 16px;
		font-size: 1em;
		height: 42px;
		min-width: 16px;
		max-width: 150px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		box-sizing: border-box;
		pointer-events: none;
		color: var(--MI_THEME-fgTransparentWeak);
		font-weight: 500;

		&:empty {
			display: none;
		}
	}
}

.yearMonthPicker {
	display: flex;
	gap: 12px;
	margin-bottom: 16px;
	padding: 12px;
	background: var(--MI_THEME-bg);
	border-radius: 8px;
}

.yearPicker,
.monthPicker {
	flex: 1;
}

.selectInput {
	appearance: none;
	-webkit-appearance: none;
	-moz-appearance: none;
	width: 100%;
	background: var(--MI_THEME-panel);
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 6px;
	color: var(--MI_THEME-fg);
	font-weight: 500;
	cursor: pointer;
	transition: all 0.2s ease;
	position: relative;
	z-index: 10001;

	&:hover {
		border-color: var(--MI_THEME-accent);
	}

	&:focus {
		border-color: var(--MI_THEME-accent);
		outline: none;
		box-shadow: 0 0 0 2px color(from var(--MI_THEME-accent) srgb r g b / 0.2);
		z-index: 10002;
	}

	background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
	background-repeat: no-repeat;
	background-position: right 8px center;
	background-size: 16px;
	padding: 8px 32px 8px 12px;
}

.viewToggle {
	border-top: 1px solid var(--MI_THEME-divider);
	padding: 12px 16px;
	display: flex;
	gap: 8px;
}

.toggleButton {
	flex: 1;
	background: var(--MI_THEME-bg);
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 8px;
	padding: 8px 12px;
	cursor: pointer;
	font-weight: 500;
	transition: all 0.2s ease;
	color: var(--MI_THEME-fgTransparentWeak);
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
		border-color: var(--MI_THEME-accent);
		color: var(--MI_THEME-accent);
	}

	&.active {
		background: var(--MI_THEME-accent);
		color: var(--MI_THEME-fgOnAccent);
		border-color: var(--MI_THEME-accent);

		&:hover {
			background: color(from var(--MI_THEME-accent) srgb r g b / 0.9);
		}
	}

	i {
		font-size: 1em;
	}
}
</style>
