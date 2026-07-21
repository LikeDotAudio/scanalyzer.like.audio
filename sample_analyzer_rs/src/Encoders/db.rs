use crate::peak::Peak;

pub struct Pool;

pub fn get_pool(_db_url: &str) -> Result<Pool, String> {
    Ok(Pool)
}

pub fn init_db(_pool: &Pool) -> Result<(), String> {
    Ok(())
}

pub fn write_peaks(_pool: &Pool, peaks: &[Peak]) -> Result<(), String> {
    if peaks.is_empty() {
        return Ok(());
    }

    let url = "https://scanalyzer.like.audio/api/upload_peak.php";
    
    // Chunk requests into max 500 records per upload
    for chunk in peaks.chunks(500) {
        let resp = ureq::post(url)
            .set("Content-Type", "application/json")
            .send_json(chunk)
            .map_err(|e| e.to_string())?;
            
        if resp.status() != 200 {
            return Err(format!("Server returned HTTP {}", resp.status()));
        }
    }
    
    Ok(())
}
