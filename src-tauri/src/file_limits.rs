//! Size gates for file reads (#665).
//!
//! `read_file` and `document_read` take a caller-supplied path and used to read
//! whatever they found straight into memory:
//!
//! - `read_file`: `fs::read_to_string` on the whole file, then a slice of the
//!   requested line range. `offset=1&limit=20` on a 2 GB log still allocated
//!   2 GB before returning 20 lines.
//! - `document_read`: handed archives to the OOXML/ODF readers, which
//!   decompress entries into memory. A tiny `.docx` can expand to gigabytes.
//!
//! An allocation failure here is not a recoverable error in a Tauri window: the
//! process dies and the session's in-flight state is lost. So the caps are
//! checked from file metadata *before* reading, and archive readers track the
//! running total of decompressed bytes.
//!
//! The module is Tauri-free so its tests run without the WebKitGTK stack.

/// Largest file `read_file` will open. Generous for source code (and for the
/// line-range case, where only a slice is returned), small enough to survive.
pub(crate) const READ_FILE_MAX_BYTES: u64 = 50 * 1024 * 1024;

/// Largest document `document_read` will open (`.docx`/`.xlsx`/`.pptx`/`.odt`/
/// `.ods`/`.odp`/`.pdf`). Archives are usually far smaller than this; the cap
/// exists to reject obviously wrong inputs before any parsing starts.
pub(crate) const DOCUMENT_MAX_BYTES: u64 = 100 * 1024 * 1024;

/// Largest *decompressed* total an archive reader will materialise in memory,
/// summed over all entries. Stops zip bombs, where a few hundred KB expands to
/// gigabytes.
pub(crate) const DECOMPRESSED_MAX_BYTES: u64 = 256 * 1024 * 1024;

/// Format a byte count as megabytes for error messages.
pub(crate) fn format_mb(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
}

/// Reject `len` bytes against `max`, naming the subject in the error.
///
/// `what` is the noun used in the message ("File", "Document"), so the same gate
/// reads naturally for both commands.
pub(crate) fn ensure_within_cap(len: u64, max: u64, what: &str) -> Result<(), String> {
    if len > max {
        return Err(format!(
            "{what} is {} which exceeds the {} limit.",
            format_mb(len),
            format_mb(max)
        ));
    }
    Ok(())
}

/// Accumulate a decompressed entry size, refusing to cross `max`.
///
/// Returns the new running total so archive readers can carry it through their
/// entry loop.
pub(crate) fn check_decompressed_total(total: u64, next: u64, max: u64) -> Result<u64, String> {
    let new_total = total.saturating_add(next);
    if new_total > max {
        return Err(format!(
            "Archive expands to more than the {} limit.",
            format_mb(max)
        ));
    }
    Ok(new_total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_file_at_the_limit() {
        assert!(ensure_within_cap(READ_FILE_MAX_BYTES, READ_FILE_MAX_BYTES, "File").is_ok());
        assert!(ensure_within_cap(0, READ_FILE_MAX_BYTES, "File").is_ok());
    }

    #[test]
    fn rejects_a_file_one_byte_over_the_limit() {
        let err =
            ensure_within_cap(READ_FILE_MAX_BYTES + 1, READ_FILE_MAX_BYTES, "File").unwrap_err();
        assert!(err.starts_with("File is "), "{err}");
        assert!(err.contains("exceeds the 50.0 MB limit"), "{err}");
    }

    #[test]
    fn document_cap_is_larger_than_read_cap() {
        // Archives legitimately exceed the plain-text cap; keeping the order
        // makes an accidental swap of the constants a test failure.
        assert!(DOCUMENT_MAX_BYTES > READ_FILE_MAX_BYTES);
        assert!(DECOMPRESSED_MAX_BYTES > DOCUMENT_MAX_BYTES);
    }

    #[test]
    fn decompressed_total_accumulates() {
        let mut total = 0;
        for _ in 0..4 {
            total = check_decompressed_total(total, 60, 256).expect("under cap");
        }
        assert_eq!(total, 240);
        // The next entry crosses the cap.
        assert!(check_decompressed_total(total, 17, 256).is_err());
    }

    #[test]
    fn decompressed_total_saturates_instead_of_overflowing() {
        // A hostile entry can claim u64::MAX; the sum must not wrap around to a
        // small number and slip under the cap.
        assert!(check_decompressed_total(u64::MAX - 1, u64::MAX, DECOMPRESSED_MAX_BYTES).is_err());
    }

    #[test]
    fn messages_are_in_megabytes() {
        assert_eq!(format_mb(0), "0.0 MB");
        assert_eq!(format_mb(1024 * 1024), "1.0 MB");
        assert_eq!(format_mb(3 * 1024 * 1024 / 2), "1.5 MB");
    }
}
