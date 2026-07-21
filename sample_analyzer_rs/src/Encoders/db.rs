use crate::peak::Peak;
use mysql::prelude::*;
use mysql::*;

pub fn get_pool(db_url: &str) -> Result<Pool> {
    let opts = Opts::from_url(db_url)?;
    Pool::new(opts)
}

pub fn init_db(pool: &Pool) -> Result<()> {
    let mut conn = pool.get_conn()?;
    conn.query_drop(
        r"CREATE TABLE IF NOT EXISTS peaks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            path VARCHAR(1024) UNIQUE,
            name VARCHAR(255),
            folder VARCHAR(255),
            json_data JSON
        )",
    )?;
    Ok(())
}

pub fn write_peaks(pool: &Pool, peaks: &[Peak]) -> Result<()> {
    let mut conn = pool.get_conn()?;
    
    // Using batch insert / upsert (ON DUPLICATE KEY UPDATE)
    // Since path is unique, we update existing records.
    let stmt = conn.prep(
        r"INSERT INTO peaks (path, name, folder, json_data) 
          VALUES (:path, :name, :folder, :json_data)
          ON DUPLICATE KEY UPDATE 
          name = VALUES(name), folder = VALUES(folder), json_data = VALUES(json_data)",
    )?;

    conn.exec_batch(
        &stmt,
        peaks.iter().map(|p| {
            let json_str = serde_json::to_string(p).unwrap_or_else(|_| "{}".to_string());
            params! {
                "path" => &p.metadata.path,
                "name" => &p.metadata.name,
                "folder" => &p.metadata.folder,
                "json_data" => json_str,
            }
        }),
    )?;
    
    Ok(())
}
