//! The analyzer version written into every record: crate version + a hash of
//! the src/*.rs sources (stamped by build.rs at compile time). Two builds of
//! identical source share a version, so their results are interchangeable; any
//! code change produces a new version and re-analysis.
pub const ANALYZER_VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), "+", env!("ANALYZER_REV"));
