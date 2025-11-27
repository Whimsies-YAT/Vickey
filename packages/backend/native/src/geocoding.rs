use napi_derive::napi;
use rstar::{RTree, RTreeObject, AABB};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GeoPoint {
    pub index: u32,
    pub lat: f64,
    pub lon: f64,
    pub importance: f64,
}

impl RTreeObject for GeoPoint {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_point([self.lat, self.lon])
    }
}

#[napi]
pub struct GeocodingIndex {
    tree: RTree<GeoPoint>,
}

use geo::Point;
use geo::{Geodesic, Distance};

#[napi]
impl GeocodingIndex {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            tree: RTree::new(),
        }
    }

    #[napi]
    pub fn add(&mut self, index: u32, lat: f64, lon: f64, importance: f64) {
        self.tree.insert(GeoPoint {
            index,
            lat,
            lon,
            importance,
        });
    }

    #[napi]
    pub fn search(&self, lat: f64, lon: f64, radius_km: f64, limit: u32) -> Vec<u32> {
        let lat_deg = radius_km / 110.574;
        let lon_deg = radius_km / (111.320 * lat.to_radians().cos().abs().max(0.001));

        let min_lat = lat - lat_deg;
        let max_lat = lat + lat_deg;
        let min_lon = lon - lon_deg;
        let max_lon = lon + lon_deg;

        let envelope = AABB::from_corners([min_lat, min_lon], [max_lat, max_lon]);

        let candidates: Vec<&GeoPoint> = self.tree.locate_in_envelope(&envelope).collect();

        struct Candidate<'a> {
            point: &'a GeoPoint,
            distance: f64,
        }

        let mut valid_candidates: Vec<Candidate> = candidates
            .into_iter()
            .map(|p| Candidate {
                point: p,
                distance: geodesic_distance(lat, lon, p.lat, p.lon),
            })
            .filter(|c| c.distance <= radius_km)
            .collect();

        valid_candidates.sort_by(|a, b| {
            a.distance.partial_cmp(&b.distance).unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.point.importance.partial_cmp(&a.point.importance).unwrap_or(std::cmp::Ordering::Equal))
        });

        valid_candidates.into_iter().take(limit as usize).map(|c| c.point.index).collect()
    }
}

fn geodesic_distance(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let p1 = Point::new(lon1, lat1);
    let p2 = Point::new(lon2, lat2);
    Geodesic::distance(p1, p2) / 1000.0
}
