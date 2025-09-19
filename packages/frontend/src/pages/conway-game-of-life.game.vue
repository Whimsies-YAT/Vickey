<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.header">
		<div :class="$style.controls">
			<div :class="$style.mainControls">
				<MkButton v-if="!isPlaying" primary @click="play">
					<i class="ti ti-player-play"></i> {{ i18n.ts.start }}
				</MkButton>
				<MkButton v-else @click="pause">
					<i class="ti ti-player-pause"></i> {{ i18n.ts.pause }}
				</MkButton>
				<MkButton :disabled="isPlaying" @click="step">
					<i class="ti ti-player-step-forward"></i> {{ i18n.ts._conway.step }}
				</MkButton>
				<MkButton @click="clear">
					<i class="ti ti-clear-all"></i> {{ i18n.ts._conway.clear }}
				</MkButton>
				<MkButton @click="randomize">
					<i class="ti ti-dice"></i> {{ i18n.ts._conway.random }}
				</MkButton>
			</div>

			<div :class="$style.patternControls">
				<div :class="$style.controlGroup">
					<label>Pattern:</label>
					<MkSelect v-model="selectedPattern" :items="patternOptions">
					</MkSelect>
					<MkButton @click="placePattern">{{ i18n.ts._conway.place }}</MkButton>
				</div>
			</div>
		</div>

		<div :class="$style.stats">
			<div :class="$style.statItem">
				<span :class="$style.statLabel">{{ i18n.ts._conway.generationText }}</span>
				<span :class="$style.statValue">{{ generation }}</span>
			</div>
			<div :class="$style.statItem">
				<span :class="$style.statLabel">{{ i18n.ts._conway.liveCellsText }}</span>
				<span :class="$style.statValue">{{ liveCells }}</span>
			</div>
			<div :class="$style.statItem">
				<span :class="$style.statLabel">{{ i18n.ts._conway.fpsText }}</span>
				<span :class="$style.statValue">{{ currentFps }}</span>
			</div>
		</div>

		<div :class="$style.speedControl">
			<label for="speed-slider">{{ i18n.tsx._conway.speedControl({ targetFps }) }}</label>
			<input
				id="speed-slider"
				v-model="targetFps"
				type="range"
				min="1"
				max="60"
				:class="$style.slider"
			/>
		</div>
	</div>

	<div :class="$style.gameArea">
		<canvas
			ref="canvasRef"
			:class="$style.canvas"
			@click="handleCanvasClick"
			@mousemove="handleMouseMove"
			@mouseleave="handleMouseLeave"
		></canvas>
		<div v-if="placingPattern" :class="$style.instruction">
			{{ i18n.tsx._conway.placingPattern({ selectedPattern }) }}
		</div>
	</div>

	<div :class="$style.footer">
		<MkButton @click="goBack">
			<i class="ti ti-arrow-left"></i> {{ i18n.ts._conway.back }}
		</MkButton>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';
import { i18n } from '@/i18n.js';

interface Props {
	gridSize: number;
	startingPattern: string;
	gameSpeed: string;
}

interface Emits {
	(ev: 'end'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const canvasRef = ref<HTMLCanvasElement>();
const isPlaying = ref(false);
const generation = ref(0);
const liveCells = ref(0);
const currentFps = ref(0);
const targetFps = ref(10);
const selectedPattern = ref('glider');
const placingPattern = ref(false);
const isStable = ref(false);
const stableDetection = ref(true);

const patternOptions = [
	{ value: 'glider', label: i18n.ts._conway.glider },
	{ value: 'block', label: i18n.ts._conway.block },
	{ value: 'beehive', label: i18n.ts._conway.beehive },
	{ value: 'blinker', label: i18n.ts._conway.blinkerAlt },
	{ value: 'toad', label: i18n.ts._conway.toad },
	{ value: 'beacon', label: i18n.ts._conway.beacon },
	{ value: 'pulsar', label: i18n.ts._conway.pulsar },
	{ value: 'pentadecathlon', label: i18n.ts._conway.pentadecathlon },
];

let wasmModule: any = null;
let universe: any = null;
let animationId: number | null = null;
let lastFrameTime = 0;
let frameCount = 0;
let fpsUpdateTime = 0;

const cellSize = ref(4);
const canvasWidth = 800;
const canvasHeight = 600;

const GRID_COLOR = '#2a2a2a';
const DEAD_COLOR = '#1a1a1a';
const ALIVE_COLOR = '#4ade80';
const HOVER_COLOR = '#6b7280';

const useImageDataRendering = ref(true);
const renderScale = ref(1);
let imageData: ImageData | null = null;

const speedToFps = {
	slow: 1,
	normal: 5,
	fast: 10,
	ultra: 20,
};

const initSpeed = () => {
	targetFps.value = speedToFps[props.gameSpeed as keyof typeof speedToFps] || 10;
};

const drawGrid = (ctx: CanvasRenderingContext2D) => {
	const width = universe.width();
	const height = universe.height();
	const actualCellSize = cellSize.value;

	ctx.beginPath();
	ctx.strokeStyle = GRID_COLOR;
	ctx.lineWidth = 1;

	for (let i = 0; i <= width; i++) {
		const x = i * actualCellSize;
		ctx.moveTo(x, 0);
		ctx.lineTo(x, height * actualCellSize);
	}

	for (let j = 0; j <= height; j++) {
		const y = j * actualCellSize;
		ctx.moveTo(0, y);
		ctx.lineTo(width * actualCellSize, y);
	}

	ctx.stroke();
};

const drawCells = (ctx: CanvasRenderingContext2D) => {
	if (!universe || !wasmModule) return;

	const width = universe.width();
	const height = universe.height();
	const cells = universe.cells_js();
	const actualCellSize = cellSize.value;

	ctx.fillStyle = DEAD_COLOR;
	ctx.fillRect(0, 0, width * actualCellSize, height * actualCellSize);

	ctx.fillStyle = ALIVE_COLOR;
	for (let row = 0; row < height; row++) {
		for (let col = 0; col < width; col++) {
			const idx = row * width + col;
			if (cells[idx] === 1) {
				ctx.fillRect(
					col * actualCellSize,
					row * actualCellSize,
					actualCellSize,
					actualCellSize
				);
			}
		}
	}
};

const renderWithImageData = () => {
	const canvas = canvasRef.value;
	if (!canvas || !universe) return;

	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	try {
		if (universe.render_to_rgba && props.gridSize >= 64) {
			const maxPixels = canvasWidth * canvasHeight;
			const rgbaData = universe.render_to_rgba(maxPixels);
			const dims = universe.render_dimensions(maxPixels);

			if (rgbaData && dims && dims.length >= 2) {
				const [width, height] = dims;
				const imageData = new ImageData(new Uint8ClampedArray(rgbaData), width, height);

				ctx.fillStyle = DEAD_COLOR;
				ctx.fillRect(0, 0, canvas.width, canvas.height);

				const scaleX = canvas.width / width;
				const scaleY = canvas.height / height;

				const tempCanvas = window.document.createElement('canvas');
				tempCanvas.width = width;
				tempCanvas.height = height;
				const tempCtx = tempCanvas.getContext('2d');

				if (tempCtx) {
					tempCtx.putImageData(imageData, 0, 0);
					ctx.imageSmoothingEnabled = false;
					ctx.drawImage(tempCanvas, 0, 0, width, height, 0, 0, canvas.width, canvas.height);
				}

				drawGrid(ctx);
				return;
			}
		}
	} catch (error) {
		console.warn('High-performance rendering failed, falling back to legacy method:', error);
	}

	drawCells(ctx);
	drawGrid(ctx);
};

const render = () => {
	if (useImageDataRendering.value) {
		renderWithImageData();
	} else {
		const canvas = canvasRef.value;
		if (!canvas || !universe) return;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		drawCells(ctx);
		drawGrid(ctx);
	}
};

const gameLoop = (currentTime: number) => {
	if (!isPlaying.value) return;

	const deltaTime = currentTime - lastFrameTime;
	const targetInterval = 1000 / targetFps.value;

	if (deltaTime >= targetInterval) {
		universe.tick();
		render();
		updateStats();

		frameCount++;
		if (currentTime - fpsUpdateTime >= 1000) {
			currentFps.value = Math.round((frameCount * 1000) / (currentTime - fpsUpdateTime));
			frameCount = 0;
			fpsUpdateTime = currentTime;
		}

		lastFrameTime = currentTime - (deltaTime % targetInterval);
	}

	animationId = requestAnimationFrame(gameLoop);
};

const updateStats = () => {
	if (universe) {
		generation.value = universe.generation();
		liveCells.value = universe.live_cell_count();

		if (stableDetection.value && universe.is_stable) {
			const stable = universe.is_stable();
			if (stable !== isStable.value) {
				isStable.value = stable;
				if (stable && isPlaying.value) {
					console.log('Game reached stable state at generation', generation.value);
				}
			}
		}
	}
};

const play = () => {
	isPlaying.value = true;
	lastFrameTime = performance.now();
	fpsUpdateTime = performance.now();
	frameCount = 0;
	requestAnimationFrame(gameLoop);
};

const pause = () => {
	isPlaying.value = false;
	if (animationId) {
		cancelAnimationFrame(animationId);
		animationId = null;
	}
};

const step = () => {
	if (universe) {
		universe.tick();
		render();
		updateStats();
	}
};

const clear = () => {
	pause();
	if (universe) {
		universe.clear();
		render();
		updateStats();
	}
};

const randomize = () => {
	pause();
	if (universe) {
		universe.randomize(0.3);
		render();
		updateStats();
	}
};

const placePattern = () => {
	placingPattern.value = true;
};

const handleCanvasClick = (event: MouseEvent) => {
	if (!universe || !canvasRef.value) return;

	const rect = canvasRef.value.getBoundingClientRect();
	const x = event.clientX - rect.left;
	const y = event.clientY - rect.top;

	const col = Math.floor(x / cellSize.value);
	const row = Math.floor(y / cellSize.value);

	if (placingPattern.value) {
		universe.clear();
		universe.set_pattern(selectedPattern.value, row, col);
		placingPattern.value = false;
		render();
		updateStats();
	} else {
		universe.toggle_cell(row, col);
		render();
		updateStats();
	}
};

const handleMouseMove = (event: MouseEvent) => {
};

const handleMouseLeave = () => {
};

const setupCanvas = () => {
	const canvas = canvasRef.value;
	if (!canvas || !universe) return;

	const width = universe.width();
	const height = universe.height();

	const maxCellSizeW = Math.floor(canvasWidth / width);
	const maxCellSizeH = Math.floor(canvasHeight / height);
	cellSize.value = Math.min(maxCellSizeW, maxCellSizeH, 8);

	canvas.width = width * cellSize.value;
	canvas.height = height * cellSize.value;
	canvas.style.width = `${canvas.width}px`;
	canvas.style.height = `${canvas.height}px`;

	render();
};

const initializePattern = () => {
	if (!universe) return;

	const centerRow = Math.floor(universe.height() / 2);
	const centerCol = Math.floor(universe.width() / 2);

	switch (props.startingPattern) {
		case 'random':
			universe.randomize(0.3);
			break;
		case 'empty':
			break;
		default:
			universe.set_pattern(props.startingPattern, centerRow - 5, centerCol - 5);
			break;
	}
};

const goBack = () => {
	pause();
	emit('end');
};

onMounted(async () => {
	try {
		wasmModule = await import('wasm-game-of-life');
		await wasmModule.default();
		universe = wasmModule.Universe.new(props.gridSize, props.gridSize);

		await nextTick();
		initSpeed();
		initializePattern();
		setupCanvas();
		updateStats();
	} catch (error) {
		console.error('Failed to load WebAssembly module:', error);
	}
});

onUnmounted(() => {
	pause();
});

watch(targetFps, () => {
});
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	height: 100vh;
	background: var(--MI_THEME-bg);
	padding: 1rem;
	gap: 1rem;
}

.header {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	background: var(--MI_THEME-panel);
	padding: 1rem;
	border-radius: 8px;
}

.controls {
	display: flex;
	justify-content: space-between;
	align-items: center;
	flex-wrap: wrap;
	gap: 1rem;
}

.mainControls {
	display: flex;
	gap: 0.5rem;
	flex-wrap: wrap;
}

.patternControls {
	display: flex;
	gap: 1rem;
	align-items: center;
}

.controlGroup {
	display: flex;
	align-items: center;
	gap: 0.5rem;

	label {
		font-weight: 600;
		color: var(--MI_THEME-fg);
	}
}

.stats {
	display: flex;
	gap: 2rem;
	justify-content: center;
	flex-wrap: wrap;
}

.statItem {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.25rem;
}

.statLabel {
	font-size: 0.875rem;
	color: var(--MI_THEME-fgTransparent);
}

.statValue {
	font-size: 1.5rem;
	font-weight: 600;
	color: var(--MI_THEME-accent);
	font-variant-numeric: tabular-nums;
}

.speedControl {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	align-items: center;

	label {
		font-weight: 600;
		color: var(--MI_THEME-fg);
	}
}

.slider {
	width: 200px;
	height: 6px;
	border-radius: 3px;
	background: var(--MI_THEME-buttonBg);
	outline: none;

	&::-webkit-slider-thumb {
		appearance: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--MI_THEME-accent);
		cursor: pointer;
	}

	&::-moz-range-thumb {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--MI_THEME-accent);
		border: none;
		cursor: pointer;
	}
}

.gameArea {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	background: var(--MI_THEME-panel);
	border-radius: 8px;
	padding: 1rem;
	min-height: 0;
}

.canvas {
	border: 2px solid var(--MI_THEME-divider);
	border-radius: 4px;
	cursor: crosshair;
	background: #000;

	&:hover {
		border-color: var(--MI_THEME-accent);
	}
}

.instruction {
	margin-top: 1rem;
	padding: 0.5rem 1rem;
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
	border-radius: 4px;
	font-weight: 500;
	text-align: center;
}

.footer {
	display: flex;
	justify-content: center;
}

@media (max-width: 768px) {
	.root {
		padding: 0.5rem;
	}

	.controls {
		flex-direction: column;
		align-items: stretch;
	}

	.stats {
		justify-content: space-around;
		gap: 1rem;
	}

	.statValue {
		font-size: 1.25rem;
	}

	.canvas {
		max-width: 100%;
		max-height: 60vh;
	}
}
</style>
