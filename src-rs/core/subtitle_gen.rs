use std::path::Path;

use crate::core::{
    ffmpeg::extract_wav_16k_mono,
    vad::{detect_vad_intervals_i16, VadConfig},
};
use anyhow::Result;

// detect_vad_intervals_i16

pub async fn generate_subtitle(video_path: &Path, vad_config: Option<VadConfig>) -> Result<String> {
    let wav_path = extract_wav_16k_mono(video_path).await?;

    let mut samples_i16: Vec<i16> = hound::WavReader::open(&wav_path)?
        .into_samples::<i16>()
        .collect::<Result<Vec<_>, _>>()?;

    match vad_config {
        Some(vad_config) => {
            let intervals = detect_vad_intervals_i16(&samples_i16, vad_config)?;
            if !intervals.is_empty() {
                let mut filtered: Vec<i16> = Vec::with_capacity(samples_i16.len());
                for (s, e) in intervals {
                    filtered.extend_from_slice(&samples_i16[s..e]);
                }
                samples_i16 = filtered;
            }
        }
        None => {}
    }

    Ok(wav_path.display().to_string())
}
