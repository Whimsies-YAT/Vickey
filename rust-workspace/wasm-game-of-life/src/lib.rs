use wasm_bindgen::prelude::*;
use js_sys::Uint8Array;
use std::collections::VecDeque;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

const MAX_CELLS: usize = 100_000_000;
const MAX_HISTORY: usize = 64;
const DEFAULT_MAX_RENDER_PIXELS: usize = 1_000_000;

fn u32_to_rgba_bytes(col: u32) -> [u8;4] {
    [
        ((col >> 24) & 0xFF) as u8,
        ((col >> 16) & 0xFF) as u8,
        ((col >> 8) & 0xFF) as u8,
        (col & 0xFF) as u8,
    ]
}

fn interpolate_color(c1: u32, c2: u32, ratio: f32) -> u32 {
    let r1 = ((c1 >> 24) & 0xFF) as f32;
    let g1 = ((c1 >> 16) & 0xFF) as f32;
    let b1 = ((c1 >> 8) & 0xFF) as f32;
    let a1 = (c1 & 0xFF) as f32;

    let r2 = ((c2 >> 24) & 0xFF) as f32;
    let g2 = ((c2 >> 16) & 0xFF) as f32;
    let b2 = ((c2 >> 8) & 0xFF) as f32;
    let a2 = (c2 & 0xFF) as f32;

    let r = (r1 + (r2 - r1) * ratio).round() as u32;
    let g = (g1 + (g2 - g1) * ratio).round() as u32;
    let b = (b1 + (b2 - b1) * ratio).round() as u32;
    let a = (a1 + (a2 - a1) * ratio).round() as u32;

    (r << 24) | (g << 16) | (b << 8) | a
}

#[wasm_bindgen]
pub struct Universe {
    width: u32,
    height: u32,
    cells: Vec<u8>,
    next_cells: Vec<u8>,
    history: VecDeque<u64>,
    generation: u32,
}

pub struct RenderResult {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

#[wasm_bindgen]
impl Universe {
    pub fn new(width: u32, height: u32) -> Universe {
        let size = (width as usize) * (height as usize);
        assert!(size <= MAX_CELLS);
        Universe {
            width,
            height,
            cells: vec![0; size],
            next_cells: vec![0; size],
            history: VecDeque::with_capacity(MAX_HISTORY),
            generation: 0,
        }
    }

    pub fn width(&self) -> u32 { self.width }
    pub fn height(&self) -> u32 { self.height }

    pub fn cells_js(&self) -> Uint8Array {
        Uint8Array::from(&self.cells[..])
    }

    pub fn memory_size(&self) -> usize {
        self.cells.len()
    }

    pub fn toggle_cell(&mut self, row: u32, col: u32) {
        if row < self.height && col < self.width {
            let idx = self.get_index(row, col);
            self.cells[idx] ^= 1;
        }
    }


    pub fn randomize(&mut self, probability: f64) {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let p = probability.clamp(0.0, 1.0);
        for cell in self.cells.iter_mut() {
            *cell = if rng.gen::<f64>() < p { 1 } else { 0 };
        }
    }

    pub fn tick(&mut self) -> bool {
        let mut changed = false;
        for row in 0..self.height {
            for col in 0..self.width {
                let idx = self.get_index(row, col);
                let live_neighbors = self.live_neighbor_count(row, col);
                let next_state = match (self.cells[idx], live_neighbors) {
                    (1, x) if x < 2 => 0,
                    (1, 2) | (1, 3) => 1,
                    (1, x) if x > 3 => 0,
                    (0, 3) => 1,
                    (otherwise, _) => otherwise,
                };
                self.next_cells[idx] = next_state;
                if next_state != self.cells[idx] {
                    changed = true;
                }
            }
        }
        std::mem::swap(&mut self.cells, &mut self.next_cells);
        self.generation += 1;
        let mut hasher = DefaultHasher::new();
        self.cells.hash(&mut hasher);
        let hash = hasher.finish();
        self.history.push_back(hash);
        if self.history.len() > MAX_HISTORY {
            self.history.pop_front();
        }
        changed
    }

    fn get_index(&self, row: u32, col: u32) -> usize {
        (row * self.width + col) as usize
    }

    fn live_neighbor_count(&self, row: u32, col: u32) -> u8 {
        let mut count = 0;
        for dr in [-1i32, 0, 1] {
            for dc in [-1i32, 0, 1] {
                if dr == 0 && dc == 0 { continue; }
                let n_row = ((row as i32 + dr + self.height as i32) % self.height as i32) as u32;
                let n_col = ((col as i32 + dc + self.width as i32) % self.width as i32) as u32;
                count += self.cells[self.get_index(n_row, n_col)];
            }
        }
        count
    }

    pub fn generation(&self) -> u32 {
        self.generation
    }

    pub fn live_cell_count(&self) -> u32 {
        self.cells.iter().map(|&cell| cell as u32).sum()
    }

    pub fn clear(&mut self) {
        self.cells.fill(0);
        self.generation = 0;
        self.history.clear();
    }

    pub fn set_pattern(&mut self, pattern: &str, start_row: u32, start_col: u32) {
        let coords = match pattern {
            "glider" => vec![
                (1, 0), (2, 1), (0, 2), (1, 2), (2, 2)
            ],
            "block" => vec![
                (0, 0), (0, 1), (1, 0), (1, 1)
            ],
            "beehive" => vec![
                (0, 1), (0, 2), (1, 0), (1, 3), (2, 1), (2, 2)
            ],
            "blinker" => vec![
                (1, 0), (1, 1), (1, 2)
            ],
            "toad" => vec![
                (1, 1), (1, 2), (1, 3), (2, 0), (2, 1), (2, 2)
            ],
            "beacon" => vec![
                (0, 0), (0, 1), (1, 0), (1, 1), (2, 2), (2, 3), (3, 2), (3, 3)
            ],
            "pulsar" => vec![
                // Pulsar pattern - 13x13 oscillator
                (2, 4), (2, 5), (2, 6), (2, 10), (2, 11), (2, 12),
                (4, 2), (4, 7), (4, 9), (4, 14),
                (5, 2), (5, 7), (5, 9), (5, 14),
                (6, 2), (6, 7), (6, 9), (6, 14),
                (7, 4), (7, 5), (7, 6), (7, 10), (7, 11), (7, 12),
                (9, 4), (9, 5), (9, 6), (9, 10), (9, 11), (9, 12),
                (10, 2), (10, 7), (10, 9), (10, 14),
                (11, 2), (11, 7), (11, 9), (11, 14),
                (12, 2), (12, 7), (12, 9), (12, 14),
                (14, 4), (14, 5), (14, 6), (14, 10), (14, 11), (14, 12)
            ],
            "pentadecathlon" => vec![
                (5, 1), (5, 2), (4, 3), (6, 3), (5, 4), (5, 5),
                (5, 6), (5, 7), (4, 8), (6, 8), (5, 9), (5, 10)
            ],
            _ => vec![]
        };

        for (dr, dc) in coords {
            let row = start_row + dr;
            let col = start_col + dc;
            if row < self.height && col < self.width {
                let idx = self.get_index(row, col);
                self.cells[idx] = 1;
            }
        }
    }

    fn render_downsample(&self, max_pixels: Option<u32>, mode: u8) -> RenderResult {
        let max_pixels = max_pixels.unwrap_or(DEFAULT_MAX_RENDER_PIXELS as u32);
        let scale = ((self.width as u64) * (self.height as u64) / max_pixels as u64).max(1) as u32;
        let out_width = (self.width + scale - 1) / scale;
        let out_height = (self.height + scale - 1) / scale;
        let mut buffer = vec![0u8; (out_width * out_height * 4) as usize];
        let alive_col = alive_color();
        let dead_col = dead_color();
        for oy in 0..out_height {
            for ox in 0..out_width {
                let mut alive_count = 0;
                let mut total = 0;
                for dy in 0..scale {
                    for dx in 0..scale {
                        let y = oy * scale + dy;
                        let x = ox * scale + dx;
                        if y < self.height && x < self.width {
                            total += 1;
                            alive_count += self.cells[self.get_index(y, x)] as u32;
                        }
                    }
                }
                let ratio = if total > 0 { alive_count as f32 / total as f32 } else { 0.0 };
                let color = if mode == 0 {
                    if ratio >= 0.5 { alive_col } else { dead_col }
                } else {
                    interpolate_color(dead_col, alive_col, ratio)
                };
                let offset = ((oy * out_width + ox) * 4) as usize;
                buffer[offset..offset+4].copy_from_slice(&u32_to_rgba_bytes(color));
            }
        }
        RenderResult {
            width: out_width,
            height: out_height,
            data: buffer,
        }
    }

    pub fn cells(&self) -> *const u8 {
        self.cells.as_ptr()
    }

    pub fn render_to_rgba(&self, max_pixels: Option<u32>) -> Vec<u8> {
        let result = self.render_downsample(max_pixels, 1);
        result.data
    }

    pub fn render_dimensions(&self, max_pixels: Option<u32>) -> Vec<u32> {
        let max_pixels = max_pixels.unwrap_or(DEFAULT_MAX_RENDER_PIXELS as u32);
        let scale = ((self.width as u64) * (self.height as u64) / max_pixels as u64).max(1) as u32;
        let out_width = (self.width + scale - 1) / scale;
        let out_height = (self.height + scale - 1) / scale;
        vec![out_width, out_height, scale]
    }

    pub fn set_cells(&mut self, cells_coords: &[u32]) {
        for chunk in cells_coords.chunks(3) {
            if chunk.len() == 3 {
                let row = chunk[0];
                let col = chunk[1];
                let state = chunk[2];
                if row < self.height && col < self.width {
                    let idx = self.get_index(row, col);
                    self.cells[idx] = if state > 0 { 1 } else { 0 };
                }
            }
        }
    }

    pub fn is_stable(&self) -> bool {
        if self.history.len() < 2 {
            return false;
        }

        let current_hash = self.history.back().unwrap();
        for (i, &hash) in self.history.iter().enumerate() {
            if i < self.history.len() - 1 && hash == *current_hash {
                return true;
            }
        }
        false
    }

    pub fn reset_generation(&mut self) {
        self.generation = 0;
        self.history.clear();
    }
}

fn alive_color() -> u32 { 0x00FF00FF }
fn dead_color() -> u32 { 0x000000FF }