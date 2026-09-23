# src-tauri: the desktop shell for Steam

Steamworks SDK (partner.steamgames.com, not vendored here: licence): unzip it outside the repo and `export STEAM_SDK_LOCATION=/path/to/steamworks_sdk/sdk` so the `steamworks-sys` crate builds against it instead of its own bundled copy.
Build with achievements on: `npx tauri build --features steam` (plain `npx tauri build` has no Steam); ship `sdk/redistributable_bin/<platform>/` (libsteam_api) beside the executable and `steam_appid.txt` for local runs.
