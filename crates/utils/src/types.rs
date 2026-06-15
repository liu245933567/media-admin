use serde::{Deserialize, Serialize};
use typeshare::typeshare;
use utoipa::{IntoParams, ToSchema};

fn default_list_page() -> i32 {
    1
}

fn default_list_page_size() -> i32 {
    20
}

#[typeshare]
#[derive(Deserialize, IntoParams, ToSchema)]
pub struct PageParams {
    #[serde(default = "default_list_page")]
    pub current: i32,
    #[serde(default = "default_list_page_size")]
    pub page_size: i32,
}

#[typeshare]
#[derive(Serialize, ToSchema)]
pub struct PageResult<T> {
    pub data: Vec<T>,
    pub total: i32,
}
