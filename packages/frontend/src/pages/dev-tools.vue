<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
	<PageWithHeader>
		<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
			<div class="_gaps_m">
				<MkFolder>
					<template #label>{{ i18n.ts._devTools.brainfuckInterpreter }}</template>
					<div class="_gaps_m">
						<MkSelect v-model="selectedExample">
							<template #label>{{ i18n.ts._devTools.examples }}</template>
							<option value="">{{ i18n.ts._devTools.selectExample }}</option>
							<option v-for="(example, index) in brainfuckExamples" :key="index" :value="index">
								{{ example[0] }}
							</option>
						</MkSelect>

						<MkTextarea v-model="brainfuckCode" :rows="6">
							<template #label>{{ i18n.ts._devTools.brainfuckCode }}</template>
							<template #caption>{{ i18n.ts._devTools.brainfuckCodeCaption }}</template>
						</MkTextarea>

						<MkInput v-model="brainfuckInput" type="text">
							<template #label>{{ i18n.ts._devTools.input }}</template>
							<template #caption>{{ i18n.ts._devTools.brainfuckInputCaption }}</template>
						</MkInput>

						<div style="display: flex; gap: 8px; flex-wrap: wrap;">
							<MkButton rounded primary :disabled="brainfuckRunning" @click="runBrainfuck">
								<i class="ti ti-player-play"></i>{{ i18n.ts._devTools.run }}
							</MkButton>
							<MkButton rounded :disabled="brainfuckRunning" @click="stepBrainfuck">
								<i class="ti ti-player-step-forward"></i>{{ i18n.ts._devTools.step }}
							</MkButton>
							<MkButton rounded @click="resetBrainfuck">
								<i class="ti ti-refresh"></i>{{ i18n.ts.reset }}
							</MkButton>
							<MkButton rounded @click="validateBrainfuck">
								<i class="ti ti-check"></i>{{ i18n.ts._devTools.validate }}
							</MkButton>
						</div>

						<div v-if="brainfuckResult.output" class="_gaps_s">
							<div style="font-weight: bold;">{{ i18n.ts._devTools.output }}:</div>
							<div style="background: var(--MI_THEME-panel); padding: 12px; border-radius: 6px; font-family: monospace; white-space: pre-wrap; word-break: break-all;">{{ brainfuckResult.output }}</div>
						</div>

						<div v-if="brainfuckResult.error" class="_gaps_s">
							<div style="color: var(--MI_THEME-error); font-weight: bold;">{{ i18n.ts._devTools.error }}:</div>
							<div style="background: var(--MI_THEME-panel); padding: 12px; border-radius: 6px; color: var(--MI_THEME-error);">{{ brainfuckResult.error }}</div>
						</div>

						<div v-if="brainfuckResult.steps_executed !== undefined" class="_gaps_s">
							<div style="font-size: 0.9em; color: var(--MI_THEME-fgTransparent);">
								{{ i18n.tsx._devTools.executionStats({
									steps: brainfuckResult.steps_executed,
									pointer: brainfuckResult.pointer,
									instructionPointer: brainfuckResult.instruction_pointer
								}) }}
							</div>
						</div>

						<div v-if="brainfuckResult.memory && brainfuckResult.memory.length > 0" class="_gaps_s">
							<details>
								<summary style="cursor: pointer; font-weight: bold;">{{ i18n.ts._devTools.memoryView }}</summary>
								<div style="background: var(--MI_THEME-panel); padding: 12px; border-radius: 6px; font-family: monospace; font-size: 0.8em; margin-top: 8px;">
									<div v-for="(value, index) in brainfuckResult.memory.slice(0, 50)" :key="index"
									     :style="{ display: 'inline-block', margin: '2px', padding: '2px 4px', borderRadius: '2px',
									               background: index === brainfuckResult.pointer ? 'var(--MI_THEME-accent)' : 'var(--MI_THEME-buttonBg)',
									               color: index === brainfuckResult.pointer ? 'var(--MI_THEME-accentFg)' : 'inherit' }">
										{{ index }}:{{ value }}
									</div>
								</div>
							</details>
						</div>
					</div>
				</MkFolder>

				<MkFolder>
					<template #label>{{ i18n.ts._devTools.timestampIdConversion }}</template>
					<div class="_gaps_m">
						<MkSelect v-model="value1" required="required">
							<template #label>{{ i18n.ts._devTools.inputType }}</template>
							<option v-for="opt in optionsForOneTIC" :key="opt.value" :value="opt.value">
								{{ opt.text }}
							</option>
						</MkSelect>

						<MkSelect v-model="value2" required="required">
							<template #label>{{ i18n.ts._devTools.outputType }}</template>
							<option v-for="opt in optionsForTwo" :key="opt.value" :value="opt.value">
								{{ opt.text }}
							</option>
						</MkSelect>

						<MkInput v-model="inputValue" type="text" required="required">
							<template #label>{{ i18n.ts._devTools.input }}</template>
						</MkInput>
						<MkButton rounded primary @click="cal">
							<i class="ti ti-calculator"></i>{{ i18n.ts._devTools.calculate }}
						</MkButton>
					</div>
				</MkFolder>
			</div>
		</div>
	</PageWithHeader>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { i18n } from "@/i18n.js";
import MkButton from "@/components/MkButton.vue";
import MkInput from "@/components/MkInput.vue";
import MkSelect from "@/components/MkSelect.vue";
import MkTextarea from "@/components/MkTextarea.vue";
import { transform } from '@/utility/convert-id.js';
import * as os from '@/os.js';
import MkFolder from "@/components/MkFolder.vue";
import { definePage } from "@/page.js";

const allTICOptions = ref([
	{ value: 'aid', text: 'aid' },
	{ value: 'aidx', text: 'aidx' },
	{ value: 'meid', text: 'meid' },
	{ value: 'meidg', text: 'meidg' },
	{ value: 'ulid', text: 'ulid' },
	{ value: 'objectid', text: 'objectid' },
	{ value: 'timestamp', text: i18n.ts._devTools.timestamp },
]);

const value1 = ref('aidx');
const value2 = ref('timestamp');
const inputValue = ref('');
const outputValue = ref('');

const brainfuckCode = ref('');
const brainfuckInput = ref('');
const brainfuckResult = ref({});
const brainfuckRunning = ref(false);
const selectedExample = ref('');
const brainfuckExamples = ref([
	['Hello World', '++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.>>.<-.<.+++.------.--------.>>+.>++.'],
	['Add two single digits', ',>,<[>+<-]>.'],
	['Cat program (echo input)', ',[.,]'],
	['Print numbers 1-10', '+++++++++++++++++++++++++++++++++++++++++++++++++>++++++++++>+++++++++[<<.+>.>-]+++++++++[<<->>-]<<.-.>.'],
	['Simple counter', '++++++++++[>++++++++++<-]>+.[-]>++++++++++[>++++++++++<-]>++.'],
	['Fibonacci sequence', '>++++++++++>+>+[[+++++[>++++++++<-]>.<++++++[>--------<-]+<<<]>.>>[[-]<[>+<-]>>[<<+>+>-]<[>+<-[>+<-[>+<-[>+<-[>+<-[>+<- [>+<-[>+<-[>+<-[>[-]>+>+<<<-[>+<-]]]]]]]]]]]+>>>]<<<]'],
]);

let brainfuckInterpreter = null;

const optionsForOneTIC = computed(() => {
	return allTICOptions.value.filter(opt => opt.value !== value2.value);
});

const optionsForTwo = computed(() => {
	return allTICOptions.value.filter(opt => opt.value !== value1.value);
});

watch(value1, (newValue) => {
	if (newValue === value2.value) {
		value2.value = optionsForTwo.value[0]?.value;
	}
});

watch(value2, (newValue) => {
	if (newValue === value1.value) {
		value1.value = optionsForOneTIC.value[0]?.value;
	}
});

watch(selectedExample, (newValue) => {
	if (newValue !== '' && brainfuckExamples.value[newValue]) {
		brainfuckCode.value = brainfuckExamples.value[newValue][1];
		if (brainfuckExamples.value[newValue][0].includes('Add')) {
			brainfuckInput.value = '23';
		} else if (brainfuckExamples.value[newValue][0].includes('Cat')) {
			brainfuckInput.value = 'Hello!';
		} else {
			brainfuckInput.value = '';
		}
	}
});

async function initBrainfuckInterpreter() {
	try {
		if (!brainfuckInterpreter) {
			const wasmModule = await import('wasm-brainfuck');
			await wasmModule.default();
			brainfuckInterpreter = new wasmModule.BrainfuckInterpreter();
		}
		return true;
	} catch (error) {
		console.error('Failed to initialize Brainfuck interpreter:', error);
		os.alert({
			type: 'error',
			text: i18n.ts._devTools.loadFailed
		});
		return false;
	}
}

async function runBrainfuck() {
	if (!brainfuckCode.value.trim()) {
		os.alert({
			type: 'error',
			text: i18n.ts._devTools.emptyCode
		});
		return;
	}

	if (!(await initBrainfuckInterpreter())) return;

	brainfuckRunning.value = true;
	try {
		brainfuckInterpreter.load_program(brainfuckCode.value);
		brainfuckInterpreter.set_input(brainfuckInput.value);
		brainfuckResult.value = brainfuckInterpreter.run(10000);
	} catch (error) {
		console.error('Brainfuck execution error:', error);
		brainfuckResult.value = { error: 'Execution failed: ' + error.message };
	} finally {
		brainfuckRunning.value = false;
	}
}

async function stepBrainfuck() {
	if (!brainfuckCode.value.trim()) {
		os.alert({
			type: 'error',
			text: i18n.ts._devTools.emptyCode
		});
		return;
	}

	if (!(await initBrainfuckInterpreter())) return;

	try {
		if (brainfuckInterpreter.is_finished()) {
			os.alert({
				type: 'info',
				text: i18n.ts._devTools.finished
			});
			return;
		}

		brainfuckInterpreter.step();
		brainfuckResult.value = brainfuckInterpreter.get_result();
	} catch (error) {
		console.error('Brainfuck step error:', error);
		brainfuckResult.value = { error: 'Step failed: ' + error.message };
	}
}

async function resetBrainfuck() {
	if (!(await initBrainfuckInterpreter())) return;

	try {
		brainfuckInterpreter.reset();
		brainfuckInterpreter.load_program(brainfuckCode.value);
		brainfuckInterpreter.set_input(brainfuckInput.value);
		brainfuckResult.value = {};
		brainfuckRunning.value = false;
	} catch (error) {
		console.error('Brainfuck reset error:', error);
	}
}

async function validateBrainfuck() {
	if (!brainfuckCode.value.trim()) {
		os.alert({
			type: 'error',
			text: i18n.ts._devTools.emptyCode
		});
		return;
	}

	try {
		const wasmModule = await import('wasm-brainfuck');
		const errors = wasmModule.BrainfuckInterpreter.validate_program(brainfuckCode.value);

		if (errors && errors.length > 0) {
			os.alert({
				type: 'error',
				text: i18n.ts._devTools.invalidSyntax + '\n' + errors.join('\n')
			});
		} else {
			os.alert({
				type: 'success',
				text: i18n.ts._devTools.validSyntax
			});
		}
	} catch (error) {
		os.alert({
			type: 'error',
			text: i18n.ts._devTools.wasmNotAvailable
		});
	}
}

function cal() {
	if (!value1.value || !value2.value || !inputValue.value) {
		os.alert({ type: 'error' });
		return;
	}

	const validInput = /^[0-9a-zA-Z]+$/.test(inputValue.value);
	if (!validInput) {
		os.alert({
			type: 'error',
		});
		return;
	}

	outputValue.value = transform(value1.value, value2.value, inputValue.value);
	os.alert({
		type: 'info',
		text: outputValue.value,
	});
}

definePage(() => ({
	title: i18n.ts._devTools.devTools,
	icon: 'ti ti-terminal-2',
}));
</script>
