use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

pub fn extension(format: &str) -> &'static str {
    match format {
        "srt" => "srt",
        "vtt" => "vtt",
        "json" => "json",
        _ => "txt",
    }
}

/// File name suffix, so plain and timestamped text exports don't collide.
pub fn suffix(format: &str) -> String {
    match format {
        "timestamps" => ".timestamps.txt".into(),
        f => format!(".{}", extension(f)),
    }
}

pub fn render(format: &str, segments: &[Segment]) -> String {
    match format {
        "timestamps" => segments.iter().map(|s| format!("[{}] {}", clock(s.start), s.text)).collect::<Vec<_>>().join("\n") + "\n",
        "srt" => segments
            .iter()
            .enumerate()
            .map(|(i, s)| format!("{}\n{} --> {}\n{}\n", i + 1, stamp(s.start, ','), stamp(s.end, ','), s.text))
            .collect::<Vec<_>>()
            .join("\n"),
        "vtt" => {
            let cues: Vec<_> = segments.iter().map(|s| format!("{} --> {}\n{}\n", stamp(s.start, '.'), stamp(s.end, '.'), s.text)).collect();
            format!("WEBVTT\n\n{}", cues.join("\n"))
        }
        "json" => serde_json::to_string_pretty(segments).unwrap_or_default() + "\n",
        _ => plain_text(segments) + "\n",
    }
}

/// Segments joined into readable paragraphs: a pause of 2 s or more starts a new one.
pub fn plain_text(segments: &[Segment]) -> String {
    let mut out = String::new();
    let mut prev_end: Option<f64> = None;
    for s in segments {
        if s.text.is_empty() {
            continue;
        }
        match prev_end {
            None => {}
            Some(e) if s.start - e >= 2.0 => out.push_str("\n\n"),
            Some(_) => out.push(' '),
        }
        out.push_str(&s.text);
        prev_end = Some(s.end);
    }
    out
}

fn stamp(t: f64, sep: char) -> String {
    let ms = (t.max(0.0) * 1000.0).round() as u64;
    format!("{:02}:{:02}:{:02}{}{:03}", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, sep, ms % 1000)
}

fn clock(t: f64) -> String {
    let s = t.max(0.0) as u64;
    if s >= 3600 { format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) } else { format!("{:02}:{:02}", s / 60, s % 60) }
}

/// A file name that is safe on any filesystem and readable.
pub fn safe_stem(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if c == '/' || c == '\0' || c.is_control() { '_' } else { c }).collect();
    let trimmed = cleaned.trim().trim_start_matches('.');
    let short: String = trimmed.chars().take(120).collect();
    if short.is_empty() { "transcript".into() } else { short }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segs() -> Vec<Segment> {
        vec![
            Segment { start: 0.0, end: 2.5, text: "Hello there.".into() },
            Segment { start: 2.6, end: 4.0, text: "General Kenobi.".into() },
            Segment { start: 3725.25, end: 3727.0, text: "Later.".into() },
        ]
    }

    #[test]
    fn srt() {
        let out = render("srt", &segs());
        assert!(out.starts_with("1\n00:00:00,000 --> 00:00:02,500\nHello there.\n\n2\n"));
        assert!(out.contains("3\n01:02:05,250 --> 01:02:07,000\nLater.\n"));
    }

    #[test]
    fn vtt() {
        let out = render("vtt", &segs());
        assert!(out.starts_with("WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello there.\n"));
    }

    #[test]
    fn plain_paragraphs() {
        assert_eq!(plain_text(&segs()), "Hello there. General Kenobi.\n\nLater.");
    }

    #[test]
    fn timestamps() {
        assert!(render("timestamps", &segs()).contains("[1:02:05] Later."));
    }

    #[test]
    fn stems() {
        assert_eq!(safe_stem("a/b\u{7}c"), "a_b_c");
        assert_eq!(safe_stem("  .hidden "), "hidden");
        assert_eq!(safe_stem(""), "transcript");
    }
}
