# Scanalyzer Database Architecture & Normalization Audit

## Current State Analysis

The current database architecture stores 100% of the extracted waveform and spectral data in a single SQL column (`json_data`) on the `peaks` table. 

**Problems with the current approach:**
1. **Bloat:** A single `.PEAK` file contains densely packed array data (such as raw time-series peak frames, full `mel_frequency_cepstral_coefficients`, and principal components) used for local 3D rendering. This inflates the JSON size to ~1.3 MB per file.
2. **Network Bottlenecks:** Pulling a library of 37,000 files from the cloud transfers nearly 50 GB of JSON data, heavily taxing the server's bandwidth and PHP memory limits. 
3. **Query Inefficiency:** The database cannot natively search, filter, or index specific audio characteristics (like `beats_per_minute` or `ucs_category`) because everything is trapped inside a monolithic JSON blob.

## Proposed Relational Data Model

To resolve this, we will separate the lightweight metadata (used for filtering/searching) from the heavy arrays. The heavy arrays will be completely dropped from the cloud database, while the remaining scalar fields will be normalized into the following relational tables:

---

### Table: `audio_files`
The core table identifying the file, its origin, and the analyzer engine that processed it.
- `id` (INT) - Primary Key, Auto Increment
- `filename` (VARCHAR)
- `folder_path` (VARCHAR)
- `user_id` (INT) - Nullable, for future multi-user support/sessions
- `analyzer_version` (VARCHAR)
- `created_at` (TIMESTAMP)

### Table: `metadata`
Technical specifications regarding the raw audio source.
- `file_id` (INT) - Foreign Key
- `length_seconds` (FLOAT)
- `sample_rate` (INT)
- `bit_depth` (INT)
- `channels` (INT)
- `source_format` (VARCHAR) - e.g. "WAV"
- `lossy_source` (BOOLEAN)
- `dc_offset` (FLOAT)

### Table: `classification`
Semantic grouping and Universal Category System (UCS) mapping.
- `file_id` (INT) - Foreign Key
- `ucs_category` (VARCHAR)
- `ucs_subcategory` (VARCHAR)
- `ucs_confidence` (FLOAT)
- `group_name` (VARCHAR)
- `subgroup` (VARCHAR)
- `timbre` (VARCHAR)
- `acoustic_types` (VARCHAR)
- `instrument_family` (VARCHAR)

### Table: `spectral_features`
High-level spectral summaries for the 3D scatter plot and analytical searching.
- `file_id` (INT) - Foreign Key
- `rms_level` (FLOAT)
- `crest_factor` (FLOAT)
- `complexity` (FLOAT)
- `spectral_centroid_hz` (FLOAT)
- `spectral_rolloff_hz` (FLOAT)
- `spectral_flatness` (FLOAT)
- `harmonicity` (FLOAT)
- `total_harmonic_distortion` (FLOAT)
- `clipping_density` (FLOAT)

### Table: `musicality`
Pitch and rhythm characteristics.
- `file_id` (INT) - Foreign Key
- `pitch_hz` (FLOAT)
- `root_note_name` (VARCHAR)
- `root_midi_note` (INT)
- `root_cents_offset` (FLOAT)
- `beats_per_minute` (FLOAT)

### Table: `envelope`
Temporal shape descriptors outlining the volume envelope.
- `file_id` (INT) - Foreign Key
- `transient_count` (INT)
- `attack_seconds` (FLOAT)
- `decay_seconds` (FLOAT)
- `sustain_level` (FLOAT)
- `release_seconds` (FLOAT)
- `temporal_centroid` (FLOAT)
- `shape` (VARCHAR)

---

## Action Plan

1. **Frontend Optimization:** Update the `upload_peak.php` HTTP request payload to rigorously exclude arrays. Before stringifying, the frontend will map the `.PEAK` JSON into a flat object containing only the scalar fields listed above. This will reduce upload sizes by 99%.
2. **Database Migration:** Create the normalized tables detailed above in the MariaDB database. Migrate any valid legacy JSON blobs into the new schema before safely dropping the `json_data` column.
3. **Backend Refactoring:** Refactor `upload_peak.php` to insert incoming scalar fields into the relational tables using SQL Prepared Statements. Refactor `get_peaks.php` to construct the returned JSON array by dynamically `JOIN`ing the tables.
