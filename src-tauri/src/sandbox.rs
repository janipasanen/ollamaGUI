//! Workspace sandbox path resolution (#661).
//!
//! Every filesystem command the agent can call routes its arguments through
//! [`resolve_in_roots`], which answers one question: is this path still inside
//! a folder the user granted?
//!
//! The original implementation compared *strings*: it normalized `..`
//! lexically and checked `starts_with(root)`. That is necessary but not
//! sufficient, because a symlink inside the workspace pointing elsewhere keeps
//! the string under the root while the real target is anywhere on the disk —
//! `read_file("link/to/secret")` then read `~/.ssh/id_rsa` and `write_file`
//! happily overwrote it. Resolution now goes through the filesystem
//! (`canonicalize`), so the comparison sees the real target.
//!
//! Paths that do not exist yet are supported (that is how files get created):
//! the deepest existing ancestor is canonicalized — resolving any symlinks
//! along the way — and the missing components are appended verbatim, so a
//! not-yet-created file cannot be used to jump outside either.

use std::path::{Path, PathBuf};

/// Lexically normalize `..`/`.` without touching the filesystem.
pub(crate) fn normalize_path(path: &Path) -> PathBuf {
    let mut parts: Vec<&std::ffi::OsStr> = Vec::new();
    for component in path.components() {
        use std::path::Component::*;
        match component {
            ParentDir => {
                parts.pop();
            }
            CurDir => {}
            c => parts.push(c.as_os_str()),
        }
    }
    parts.iter().collect()
}

/// Canonicalize `path`, tolerating a tail that does not exist yet: the deepest
/// existing ancestor is canonicalized and the missing components are appended.
fn canonicalize_allow_missing(path: &Path) -> Result<PathBuf, String> {
    let mut existing = path.to_path_buf();
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    loop {
        match existing.canonicalize() {
            Ok(base) => {
                let mut out = base;
                for part in missing.iter().rev() {
                    out.push(part);
                }
                return Ok(out);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // The entry can exist and still canonicalize as NotFound when it
                // is a dangling or looping symlink. That is not a "file that has
                // not been created yet": following it would write outside the
                // workspace, so refuse instead of falling back to the lexical
                // path.
                if std::fs::symlink_metadata(&existing).is_ok() {
                    return Err(format!(
                        "Path '{}' is a broken or looping symlink.",
                        path.display()
                    ));
                }
                let Some(name) = existing.file_name().map(|n| n.to_os_string()) else {
                    return Err(format!("Cannot resolve '{}'.", path.display()));
                };
                missing.push(name);
                if !existing.pop() {
                    return Err(format!("Cannot resolve '{}'.", path.display()));
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Resolve `path` against `roots` and return the canonical absolute path.
///
/// `roots` must already be canonical (see `set_workspace_roots`); the first
/// entry is the primary root that relative paths are resolved against. A
/// project may span several repositories (#492), so any root is acceptable.
pub(crate) fn resolve_in_roots(roots: &[PathBuf], path: &str) -> Result<PathBuf, String> {
    let Some(primary) = roots.first() else {
        return Err("No workspace root set. Call set_workspace_root first.".to_string());
    };
    let candidate = PathBuf::from(path);
    let abs = if candidate.is_absolute() {
        candidate
    } else {
        primary.join(&candidate)
    };

    // Cheap lexical gate first: rejects `..` traversal without touching the disk.
    let normalized = normalize_path(&abs);
    if !roots.iter().any(|r| normalized.starts_with(r)) {
        return Err(format!("Path '{}' is outside the workspace root(s).", path));
    }

    // Then the real check: follow every symlink and compare the true target.
    let resolved = canonicalize_allow_missing(&normalized)?;
    if !roots.iter().any(|r| resolved.starts_with(r)) {
        return Err(format!(
            "Path '{}' resolves outside the workspace root(s).",
            path
        ));
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn temp_dir(tag: &str) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "ollamagui-sandbox-{}-{}-{}",
            tag,
            std::process::id(),
            n
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir.canonicalize().expect("canonicalize temp dir")
    }

    #[test]
    fn allows_nested_existing_and_missing_files() {
        let root = temp_dir("allow");
        std::fs::create_dir_all(root.join("src/deep")).unwrap();
        std::fs::write(root.join("src/deep/file.txt"), "x").unwrap();
        let roots = vec![root.clone()];

        assert!(resolve_in_roots(&roots, "src/deep/file.txt").is_ok());
        // Writes target files that do not exist yet.
        assert!(resolve_in_roots(&roots, "src/deep/new.txt").is_ok());
        let abs = root.join("src/deep/file.txt");
        assert!(resolve_in_roots(&roots, &abs.to_string_lossy()).is_ok());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_parent_traversal() {
        let root = temp_dir("traversal");
        let roots = vec![root.clone()];

        let err = resolve_in_roots(&roots, "../outside.txt").unwrap_err();
        assert!(err.contains("outside the workspace root"), "{err}");
        let abs_escape = root.join("../outside.txt");
        assert!(resolve_in_roots(&roots, &abs_escape.to_string_lossy()).is_err());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_empty_root_list() {
        assert!(resolve_in_roots(&[], "anything").is_err());
    }

    #[test]
    fn accepts_any_configured_root() {
        let first = temp_dir("multi-a");
        let second = temp_dir("multi-b");
        let roots = vec![first.clone(), second.clone()];

        assert!(resolve_in_roots(&roots, first.join("a.txt").to_string_lossy().as_ref()).is_ok());
        assert!(resolve_in_roots(&roots, second.join("b.txt").to_string_lossy().as_ref()).is_ok());
        let third = temp_dir("multi-c");
        assert!(resolve_in_roots(&roots, third.join("c.txt").to_string_lossy().as_ref()).is_err());

        for d in [&first, &second, &third] {
            std::fs::remove_dir_all(d).ok();
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_directory_escape() {
        // #661: the string stays under the root, the target does not.
        let root = temp_dir("symlink-root");
        let outside = temp_dir("symlink-outside");
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        let roots = vec![root.clone()];

        let err = resolve_in_roots(&roots, "link/secret.txt").unwrap_err();
        assert!(err.contains("resolves outside the workspace root"), "{err}");
        // Writes through the same symlink are refused too.
        assert!(resolve_in_roots(&roots, "link/new.txt").is_err());
        // Absolute form of the same escape.
        let abs = root.join("link/secret.txt");
        assert!(resolve_in_roots(&roots, &abs.to_string_lossy()).is_err());

        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&outside).ok();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_file_escape() {
        let root = temp_dir("filelink-root");
        let outside = temp_dir("filelink-outside");
        let target = outside.join("secret.txt");
        std::fs::write(&target, "secret").unwrap();
        std::os::unix::fs::symlink(&target, root.join("innocent.txt")).unwrap();
        let roots = vec![root.clone()];

        assert!(resolve_in_roots(&roots, "innocent.txt").is_err());

        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&outside).ok();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_dangling_symlink_outside_root() {
        // A broken link still names a target outside the workspace; creating the
        // target later must not turn the path into a valid one.
        let root = temp_dir("dangling-root");
        let outside = temp_dir("dangling-outside");
        let missing = outside.join("not-yet.txt");
        std::os::unix::fs::symlink(&missing, root.join("broken.txt")).unwrap();
        let roots = vec![root.clone()];

        assert!(resolve_in_roots(&roots, "broken.txt").is_err());

        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&outside).ok();
    }
}
