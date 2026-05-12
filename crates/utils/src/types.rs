use serde::{Deserialize, Serialize};
use typeshare::typeshare;

fn default_list_page() -> i32 {
    1
}

fn default_list_page_size() -> i32 {
    20
}

#[typeshare]
#[derive(Deserialize)]
pub struct PageParams {
    #[serde(default = "default_list_page")]
    pub current: i32,
    #[serde(default = "default_list_page_size")]
    pub page_size: i32,
}

#[typeshare]
#[derive(Serialize)]
pub struct PageResult<T> {
    pub data: Vec<T>,
    pub total: i32,
}
