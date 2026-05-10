use axum::{extract::Request, http::HeaderValue, middleware::Next, response::Response};
use uuid::Uuid;

pub async fn request_id(mut req: Request, next: Next) -> Response {
    let id = Uuid::new_v4().to_string();

    req.extensions_mut().insert(id.clone());

    let mut res = next.run(req).await;

    res.headers_mut().insert(
        "x-request-id",
        HeaderValue::from_str(&id).expect("uuid string is a valid header value"),
    );

    res
}
