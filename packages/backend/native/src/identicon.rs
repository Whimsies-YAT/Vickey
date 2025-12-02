use image::{ImageBuffer, Rgba, RgbaImage};
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use sha2::{Digest, Sha256};
use std::io::Cursor;

const COLORS: &[([u8; 3], [u8; 3])] = &[
    ([255, 81, 47], [221, 36, 118]),   // #FF512F, #DD2476
    ([255, 97, 210], [254, 144, 144]), // #FF61D2, #FE9090
    ([114, 255, 182], [16, 209, 100]), // #72FFB6, #10D164
    ([253, 132, 81], [255, 189, 111]), // #FD8451, #FFBD6F
    ([48, 81, 112], [109, 252, 107]),  // #305170, #6DFC6B
    ([0, 192, 255], [66, 24, 184]),    // #00C0FF, #4218B8
    ([0, 146, 69], [252, 238, 33]),    // #009245, #FCEE21
    ([1, 0, 236], [251, 54, 244]),     // #0100EC, #FB36F4
    ([253, 171, 221], [55, 74, 90]),   // #FDABDD, #374A5A
    ([56, 162, 215], [86, 17, 57]),    // #38A2D7, #561139
    ([18, 28, 132], [130, 120, 218]),  // #121C84, #8278DA
    ([87, 97, 178], [31, 197, 168]),   // #5761B2, #1FC5A8
    ([255, 219, 1], [14, 25, 125]),    // #FFDB01, #0E197D
    ([255, 62, 157], [14, 31, 64]),    // #FF3E9D, #0E1F40
    ([118, 110, 255], [0, 212, 255]),  // #766eff, #00d4ff
    ([155, 255, 110], [0, 212, 255]),  // #9bff6e, #00d4ff
    ([255, 110, 148], [0, 212, 255]),  // #ff6e94, #00d4ff
    ([255, 169, 110], [0, 212, 255]),  // #ffa96e, #00d4ff
    ([255, 169, 110], [255, 0, 157]),  // #ffa96e, #ff009d
    ([255, 221, 110], [255, 0, 157]),  // #ffdd6e, #ff009d
];

#[napi]
pub fn generate_identicon(seed: String) -> Buffer {
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    let result = hasher.finalize();

    let mut seed_array = [0u8; 32];
    seed_array.copy_from_slice(&result);
    let mut rng = StdRng::from_seed(seed_array);

    let size = 128;
    let margin = size / 4;
    let n = 5;
    let actual_size = size - (margin * 2);
    let cell_size = actual_size / n;

    let color_idx = rng.gen_range(0..COLORS.len());
    let (start_color, end_color) = COLORS[color_idx];

    let mut image: RgbaImage = ImageBuffer::new(size, size);

    for y in 0..size {
        for x in 0..size {
            let t = (x as f32 + y as f32) / (2.0 * size as f32);

            let r = (start_color[0] as f32 * (1.0 - t) + end_color[0] as f32 * t) as u8;
            let g = (start_color[1] as f32 * (1.0 - t) + end_color[1] as f32 * t) as u8;
            let b = (start_color[2] as f32 * (1.0 - t) + end_color[2] as f32 * t) as u8;

            image.put_pixel(x, y, Rgba([r, g, b, 255]));
        }
    }

    let side_n = n / 2;

    let mut side = vec![vec![false; n as usize]; side_n as usize];
    for x in 0..side_n {
        for y in 0..n {
            side[x as usize][y as usize] = rng.gen_range(0..3) == 0;
        }
    }

    let mut center = vec![false; n as usize];
    for y in 0..n {
        center[y as usize] = rng.gen_range(0..3) == 0;
    }

    let fg_color = Rgba([255, 255, 255, 255]);

    for x in 0..n {
        for y in 0..n {
            let is_x_center = x == (n - 1) / 2; // x == 2
            if is_x_center && !center[y as usize] {
                continue;
            }

            let is_left_side = x < (n - 1) / 2; // x < 2
            if is_left_side && !side[x as usize][y as usize] {
                continue;
            }

            let is_right_side = x > (n - 1) / 2; // x > 2
            if is_right_side && !side[(side_n - (x - side_n)) as usize][y as usize] {
                continue;
            }

            let actual_x = margin + (cell_size * x);
            let actual_y = margin + (cell_size * y);

            for dy in 0..cell_size {
                for dx in 0..cell_size {
                     if actual_x + dx < size && actual_y + dy < size {
                        image.put_pixel(actual_x + dx, actual_y + dy, fg_color);
                    }
                }
            }
        }
    }

    let mut buffer = Vec::new();
    let mut cursor = Cursor::new(&mut buffer);
    image.write_to(&mut cursor, image::ImageOutputFormat::Png).unwrap();

    Buffer::from(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_identicon() {
        let seed = "test-seed".to_string();
        let buffer = generate_identicon(seed);

        assert!(buffer.len() > 0);

        assert_eq!(buffer[0], 0x89);
        assert_eq!(buffer[1], 0x50);
        assert_eq!(buffer[2], 0x4E);
        assert_eq!(buffer[3], 0x47);
        assert_eq!(buffer[4], 0x0D);
        assert_eq!(buffer[5], 0x0A);
        assert_eq!(buffer[6], 0x1A);
        assert_eq!(buffer[7], 0x0A);
    }
}
