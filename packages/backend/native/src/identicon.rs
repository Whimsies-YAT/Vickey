use image::{ImageBuffer, Rgba, RgbaImage};
use napi_derive::napi;
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use sha2::{Digest, Sha256};
use std::io::Cursor;

#[napi]
pub fn generate_identicon(seed: String) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    let result = hasher.finalize();

    let mut seed_array = [0u8; 32];
    seed_array.copy_from_slice(&result);
    let mut rng = StdRng::from_seed(seed_array);

    let size = 128;
    let margin = size / 18;
    let cell_size = (size - (margin * 2)) / 5;

    let actual_margin = (size - (cell_size * 5)) / 2;

    let hue = rng.gen_range(0.0..360.0);
    let saturation = 0.7;
    let lightness = 0.5;

    let (r, g, b) = hsl_to_rgb(hue, saturation, lightness);
    let fg_color = Rgba([r, g, b, 255]);
    let bg_color = Rgba([240, 240, 240, 255]);

    let mut image: RgbaImage = ImageBuffer::from_pixel(size, size, bg_color);

    let mut grid = [[false; 5]; 5];

    for y in 0..5 {
        for x in 0..3 {
            if rng.gen_bool(0.5) {
                grid[y][x] = true;
                grid[y][4 - x] = true; // Mirror
            }
        }
    }

    // Draw
    for (y, row) in grid.iter().enumerate() {
        for (x, &filled) in row.iter().enumerate() {
            if filled {
                let x_pos = actual_margin + (x as u32 * cell_size);
                let y_pos = actual_margin + (y as u32 * cell_size);

                // Fill rect
                for dy in 0..cell_size {
                    for dx in 0..cell_size {
                        if x_pos + dx < size && y_pos + dy < size {
                            image.put_pixel(x_pos + dx, y_pos + dy, fg_color);
                        }
                    }
                }
            }
        }
    }

    let mut buffer = Vec::new();
    let mut cursor = Cursor::new(&mut buffer);
    image.write_to(&mut cursor, image::ImageOutputFormat::Png).unwrap();

    buffer
}

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = l - c / 2.0;

    let (r_prime, g_prime, b_prime) = if h < 60.0 {
        (c, x, 0.0)
    } else if h < 120.0 {
        (x, c, 0.0)
    } else if h < 180.0 {
        (0.0, c, x)
    } else if h < 240.0 {
        (0.0, x, c)
    } else if h < 300.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };

    (
        ((r_prime + m) * 255.0).round() as u8,
        ((g_prime + m) * 255.0).round() as u8,
        ((b_prime + m) * 255.0).round() as u8,
    )
}
