use napi_derive::napi;
use scraper::{Html, Node};
use std::collections::HashSet;
use unicode_normalization::UnicodeNormalization;
use regex::Regex;
use lazy_static::lazy_static;

lazy_static! {
    static ref URL_REGEX: Regex = Regex::new(r"^https?://[\w/:%#@$&?!()\[\]~.,=+\-]+").unwrap();
    static ref URL_REGEX_FULL: Regex = Regex::new(r"^https?://[\w/:%#@$&?!()\[\]~.,=+\-]+$").unwrap();
}

#[napi]
pub fn html_to_mfm(html: String, hashtag_names: Option<Vec<String>>) -> String {
    let fragment = Html::parse_fragment(&html);
    let mut mfm = String::new();

    let normalized_hashtags = hashtag_names.map(|names| {
        names.into_iter()
            .map(|n| n.nfkc().collect::<String>().to_lowercase())
            .collect::<HashSet<_>>()
    });

    for node in fragment.tree.root().children() {
        walk(node, &mut mfm, &normalized_hashtags);
    }

    mfm.trim().to_string()
}

fn walk(node: ego_tree::NodeRef<scraper::node::Node>, mfm: &mut String, hashtags: &Option<HashSet<String>>) {
    use unicode_normalization::UnicodeNormalization;

    match node.value() {
        Node::Text(text) => {
            mfm.push_str(&text.text);
        }
        Node::Element(element) => {
            let tag_name = element.name();

            match tag_name {
                "br" => mfm.push('\n'),
                "p" | "div" => {
                    mfm.push('\n');
                    for child in node.children() {
                        walk(child, mfm, hashtags);
                    }
                    mfm.push('\n');
                }
                "b" | "strong" => {
                    mfm.push_str("**");
                    for child in node.children() {
                        walk(child, mfm, hashtags);
                    }
                    mfm.push_str("**");
                }
                "i" | "em" => {
                    mfm.push('*');
                    for child in node.children() {
                        walk(child, mfm, hashtags);
                    }
                    mfm.push('*');
                }
                "s" | "del" => {
                    mfm.push_str("~~");
                    for child in node.children() {
                        walk(child, mfm, hashtags);
                    }
                    mfm.push_str("~~");
                }
                "code" => {
                    if let Some(parent) = node.parent() {
                        if let Node::Element(parent_el) = parent.value() {
                            if parent_el.name() == "pre" {
                                for child in node.children() {
                                    walk(child, mfm, hashtags);
                                }
                                return;
                            }
                        }
                    }
                    mfm.push('`');
                    for child in node.children() {
                        walk(child, mfm, hashtags);
                    }
                    mfm.push('`');
                }
                "pre" => {
                    mfm.push_str("\n```\n");
                    for child in node.children() {
                        walk(child, mfm, hashtags);
                    }
                    mfm.push_str("\n```\n");
                }
                "blockquote" => {
                    mfm.push_str("\n> ");
                    for child in node.children() {
                        walk(child, mfm, hashtags);
                    }
                    mfm.push('\n');
                }
                "a" => {
                    let href = element.attr("href").unwrap_or("");
                    let rel = element.attr("rel").unwrap_or("");

                    // Extract text content of the link
                    let mut txt = String::new();
                    for child in node.children() {
                        walk(child, &mut txt, hashtags);
                    }

                    let normalized_txt = txt.nfkc().collect::<String>().to_lowercase();

                    // Hashtag check
                    if let Some(tags) = hashtags {
                        if !href.is_empty() {
                             let no_hash = normalized_txt.trim_start_matches('#');
                             if tags.contains(&normalized_txt) || tags.contains(no_hash) {
                                mfm.push_str(&txt);
                                return;
                             }
                        }
                    }

                    // Mention check
                    if txt.starts_with('@') && !rel.starts_with("me ") {
                        let parts: Vec<&str> = txt.split('@').collect();

                        if parts.len() == 2 && !href.is_empty() {
                            // Local mention: @user -> @user@host
                            if let Ok(url) = url::Url::parse(href) {
                                if let Some(host) = url.host_str() {
                                    mfm.push_str(&txt);
                                    mfm.push('@');
                                    mfm.push_str(host);
                                    return;
                                }
                            }
                        } else if parts.len() == 3 {
                            // Remote mention: @user@host
                            mfm.push_str(&txt);
                            return;
                        }
                    }

                    // Default link
                    if href.is_empty() {
                        mfm.push_str(&txt);
                    } else if txt.is_empty() || txt == href {
                         // #6383: Missing text node or text equals href
                         if URL_REGEX_FULL.is_match(href) {
                             mfm.push_str(href);
                         } else {
                             mfm.push('<');
                             mfm.push_str(href);
                             mfm.push('>');
                         }
                    } else {
                        // #6846
                        if URL_REGEX.is_match(href) && !URL_REGEX_FULL.is_match(href) {
                            mfm.push('[');
                            mfm.push_str(&txt);
                            mfm.push_str("](<");
                            mfm.push_str(href);
                            mfm.push_str(">)");
                        } else {
                            mfm.push('[');
                            mfm.push_str(&txt);
                            mfm.push_str("](");
                            mfm.push_str(href);
                            mfm.push(')');
                        }
                    }
                }
                "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                     mfm.push_str("\n\n");
                     if tag_name == "h1" {
                         mfm.push_str("【");
                     }
                     for child in node.children() {
                        walk(child, mfm, hashtags);
                     }
                     if tag_name == "h1" {
                         mfm.push_str("】");
                     }
                     mfm.push('\n');
                }
                _ => {
                    for child in node.children() {
                        walk(child, mfm, hashtags);
                    }
                }
            }
        }
        _ => {}
    }
}
