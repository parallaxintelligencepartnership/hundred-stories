// The desktop shell for Steam. It loads the game bundle from `npm run build:app` (dist-app, the
// game page at the root, no service worker) and adds three things the web bundle asks for:
// the fs plugin (the save slot in the app data directory, src/game/storage.ts), the dialog
// plugin (export and import), and the `report_star` command (Steam achievements, a no-op
// unless built with `--features steam`, src/steam/steam.ts calls it).

mod achievements;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(achievements::Steam::init());
            #[cfg(feature = "steam")]
            {
                // Steam wants its callbacks pumped; a slow timer is plenty for achievements.
                let handle = app.handle().clone();
                std::thread::spawn(move || loop {
                    handle.state::<achievements::Steam>().run_callbacks();
                    std::thread::sleep(std::time::Duration::from_millis(250));
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![achievements::report_star])
        .run(tauri::generate_context!())
        .expect("error while running the Hundred Stories shell");
}
