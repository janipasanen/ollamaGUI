//! Byte limits for the raw HTTP commands (#662).
//!
//! `http_get_binary` and `fetch_url` both take a URL that can originate from the
//! model (`fetch_url` on a link it just read, `http_get_binary` for generated
//! images) and both used to buffer the entire response before looking at it:
//!
//! - `http_get_binary`: no request timeout at all, `response.bytes().await`,
//!   then base64 — roughly 2.3x the body size resident at peak.
//! - `fetch_url`: a 15s timeout, then `.text()`, and only afterwards
//!   `chars().take(max_chars)` — so a 1 GB page was fully allocated to render
//!   20k characters of text.
//!
//! The fix streams chunks and refuses to grow past a cap, so the limit is
//! enforced while reading instead of after the memory is already gone. Both
//! helpers live here rather than in `lib.rs` so their tests run without the
//! Tauri/WebKitGTK build.

/// Hard cap for `http_get_binary` bodies. Image endpoints (`/view`,
/// OpenAI-compatible `b64_json` proxies) return megabytes, not gigabytes.
pub(crate) const HTTP_BINARY_MAX_BYTES: usize = 25 * 1024 * 1024;

/// Hard cap for `fetch_url` bodies. `max_chars` trims the extracted text
/// afterwards; 4 MB of markup is far more than any page whose readable text
/// fits in the default 20k characters.
pub(crate) const FETCH_URL_MAX_BYTES: usize = 4 * 1024 * 1024;

/// Append `chunk` to `buf`, refusing to grow past `max` bytes.
///
/// On refusal `buf` is left untouched, so callers that want to keep what they
/// already have (page fetches truncate) can just stop and use it.
pub(crate) fn append_capped(buf: &mut Vec<u8>, chunk: &[u8], max: usize) -> Result<(), String> {
    let next = buf.len().saturating_add(chunk.len());
    if next > max {
        return Err(format!(
            "Response is larger than the {} MB limit.",
            max / (1024 * 1024)
        ));
    }
    buf.extend_from_slice(chunk);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_chunks_up_to_the_limit() {
        let mut buf = Vec::new();
        assert!(append_capped(&mut buf, b"abcd", 4).is_ok());
        assert_eq!(buf, b"abcd");
        // Exactly at the cap is still accepted.
        assert!(append_capped(&mut buf, b"", 4).is_ok());
        assert_eq!(buf.len(), 4);
    }

    #[test]
    fn rejects_a_chunk_that_crosses_the_limit() {
        let mut buf = b"abc".to_vec();
        let err = append_capped(&mut buf, b"de", 4).unwrap_err();
        assert!(err.contains("larger than"), "{err}");
        // The refused chunk is not partially appended.
        assert_eq!(buf, b"abc");
    }

    #[test]
    fn rejects_when_already_full() {
        let mut buf = b"xxxx".to_vec();
        assert!(append_capped(&mut buf, b"y", 4).is_err());
        assert_eq!(buf.len(), 4);
    }

    #[test]
    fn limit_error_is_expressed_in_megabytes() {
        let mut buf = Vec::new();
        let too_big = vec![0u8; 1024 * 1024 + 1];
        let err = append_capped(&mut buf, &too_big, 1024 * 1024).unwrap_err();
        assert!(err.contains("1 MB"), "{err}");
        assert!(buf.is_empty());
    }

    #[test]
    fn fetch_cap_stays_below_binary_cap() {
        // Pages are text; the binary cap exists for images. Keeping them
        // ordered makes the intent of the constants checkable.
        assert!(FETCH_URL_MAX_BYTES < HTTP_BINARY_MAX_BYTES);
    }

    // `read_file` (see issue #665) uses the same helper for its size gate, so
    // the arithmetic is covered here for non-UTF8 byte counts too.
    #[test]
    fn counts_bytes_not_chars() {
        let mut buf = Vec::new();
        let utf8_three_bytes = "€".as_bytes();
        assert_eq!(utf8_three_bytes.len(), 3);
        assert!(append_capped(&mut buf, utf8_three_bytes, 3).is_ok());
        assert!(append_capped(&mut buf, utf8_three_bytes, 5).is_err());
        assert_eq!(std::str::from_utf8(&buf).unwrap(), "€");
    }
}
