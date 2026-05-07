use axum::response::sse::{Event, KeepAlive, Sse};
use futures::{Stream, StreamExt};
use std::{convert::Infallible, time::Duration};
use serde::Serialize;

#[derive(Serialize)]
struct SseMessage {
    pub event: String,
    pub id: String,
    pub data: String,
}

pub async fn sse_handler() -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream =
        tokio_stream::wrappers::IntervalStream::new(tokio::time::interval(Duration::from_secs(1)))
            .enumerate()
            .map(|(i, _)| {
                let payload = serde_json::to_string(&SseMessage {
                    event: "tick".to_string(),
                    id: i.to_string(),
                    data: format!("hello {}", i),
                })
                .unwrap_or_else(|_| "{\"event\":\"tick\",\"id\":\"-1\",\"data\":\"serialize error\"}".to_string());

                Ok(Event::default()
                    .event("tick")
                    .id(i.to_string())
                    .data(payload))
            });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}
