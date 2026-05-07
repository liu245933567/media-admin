mod api;
mod config;
mod core;
mod db;
mod error;
mod state;

fn main() {
    let _ = dotenvy::dotenv();

    api::start();
}
