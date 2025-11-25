/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

#![deny(clippy::all)]
#![warn(clippy::pedantic)]
#![allow(clippy::missing_errors_doc)]

use napi_derive::napi;
use unicode_normalization::UnicodeNormalization;

#[napi]
pub fn normalize_for_search(text: String) -> String {
    text.nfkc().collect::<String>().to_lowercase()
}

#[napi]
pub fn safe_for_sql(text: String) -> bool {
    !text.contains(['\\', '%', '_'])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_basic() {
        assert_eq!(normalize_for_search("Hello".into()), "hello");
    }

    #[test]
    fn test_normalize_fullwidth() {
        assert_eq!(normalize_for_search("Ｈｅｌｌｏ".into()), "hello");
    }

    #[test]
    fn test_normalize_japanese() {
        assert_eq!(normalize_for_search("こんにちは".into()), "こんにちは");
    }

    #[test]
    fn test_normalize_mixed() {
        assert_eq!(normalize_for_search("Ｔｅｓｔ＃１２３".into()), "test#123");
    }

    #[test]
    fn test_normalize_emoji() {
        assert_eq!(normalize_for_search("Hello👋World".into()), "hello👋world");
    }

    #[test]
    fn test_safe_for_sql_valid() {
        assert!(safe_for_sql("hello".into()));
        assert!(safe_for_sql("test123".into()));
        assert!(safe_for_sql("hello-world_test".into()));
    }

    #[test]
    fn test_safe_for_sql_invalid() {
        assert!(!safe_for_sql("test\\".into()));
        assert!(!safe_for_sql("test%".into()));
        assert!(!safe_for_sql("test_".into()));
    }
}
