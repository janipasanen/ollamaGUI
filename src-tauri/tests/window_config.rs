#[test]
fn declares_a_visible_main_window() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid Tauri config");

    let windows = config["tauri"]["windows"]
        .as_array()
        .expect("Tauri must declare at least one window");
    let main = windows
        .iter()
        .find(|window| window["label"] == "main")
        .expect("Tauri must declare the main window");

    assert_eq!(main["title"], "OllamaGUI");
    assert_eq!(main["visible"], true);
    assert!(main["width"].as_u64().unwrap_or(0) > 0);
    assert!(main["height"].as_u64().unwrap_or(0) > 0);
}
