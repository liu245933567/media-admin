use media_admin::api;

fn main() {
    let _ = dotenvy::dotenv();

    api::start();
}
