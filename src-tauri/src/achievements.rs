//! Steam achievements for the star rating. The web side calls the `report_star` command with the
//! tower's star rating when it rises, and once at boot so a star earned while Steam was closed
//! is still unlocked. Reaching star n unlocks every achievement up to n; Steam ignores a repeat
//! unlock, so reporting is idempotent.
//!
//! With the `steam` feature off (the default) every call is a no-op and nothing links against
//! the Steamworks SDK.

/// Star rating to Steam achievement id. Star 1 is the tower standing at all; star 6 is TOWER.
/// The ids must match the achievements configured on the Steamworks partner site.
/// tests/game/steam.test.ts pins this table against src/steam/steam.ts.
pub const STAR_ACHIEVEMENTS: [(u8, &str); 6] = [
    (1, "FIRST_TOWER"),
    (2, "STAR_2"),
    (3, "STAR_3"),
    (4, "STAR_4"),
    (5, "STAR_5"),
    (6, "STAR_6"),
];

/// The achievement ids a star rating of `star` has earned, lowest first. A rating of 0 earns
/// nothing; anything past 6 earns the six.
pub fn earned(star: u8) -> Vec<&'static str> {
    STAR_ACHIEVEMENTS
        .iter()
        .filter(|(n, _)| *n <= star)
        .map(|(_, id)| *id)
        .collect()
}

#[cfg(feature = "steam")]
mod backend {
    use std::sync::Mutex;

    /// The Steam client, when Steam is running and the app id is known. `None` means every
    /// report is dropped (launched outside Steam, or no steam_appid.txt in development).
    pub struct Steam(Mutex<Option<steamworks::Client>>);

    impl Steam {
        pub fn init() -> Self {
            match steamworks::Client::init() {
                Ok(client) => Steam(Mutex::new(Some(client))),
                Err(err) => {
                    eprintln!("steam: not available ({err}); achievements are off for this run");
                    Steam(Mutex::new(None))
                }
            }
        }

        pub fn unlock(&self, ids: &[&str]) {
            let Ok(guard) = self.0.lock() else { return };
            let Some(client) = guard.as_ref() else { return };
            let stats = client.user_stats();
            for id in ids {
                let _ = stats.achievement(id).set();
            }
            let _ = stats.store_stats();
        }

        /// Pumps Steam's callbacks; the client needs this regularly.
        pub fn run_callbacks(&self) {
            if let Ok(guard) = self.0.lock() {
                if let Some(client) = guard.as_ref() {
                    client.run_callbacks();
                }
            }
        }
    }
}

#[cfg(not(feature = "steam"))]
mod backend {
    /// No Steam in this build: the state exists so the command has the same shape.
    pub struct Steam;

    impl Steam {
        pub fn init() -> Self {
            Steam
        }

        pub fn unlock(&self, _ids: &[&str]) {}

        #[allow(dead_code)]
        pub fn run_callbacks(&self) {}
    }
}

pub use backend::Steam;

/// Called by src/steam/steam.ts with the current star rating.
#[tauri::command]
pub fn report_star(n: u8, steam: tauri::State<'_, Steam>) {
    steam.unlock(&earned(n));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn six_stars_map_to_six_distinct_ids() {
        let ids: std::collections::HashSet<_> = STAR_ACHIEVEMENTS.iter().map(|(_, id)| *id).collect();
        assert_eq!(ids.len(), 6);
        let stars: Vec<u8> = STAR_ACHIEVEMENTS.iter().map(|(n, _)| *n).collect();
        assert_eq!(stars, vec![1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn a_star_earns_every_achievement_up_to_it() {
        assert!(earned(0).is_empty());
        assert_eq!(earned(1), vec!["FIRST_TOWER"]);
        assert_eq!(earned(3), vec!["FIRST_TOWER", "STAR_2", "STAR_3"]);
        assert_eq!(earned(6).len(), 6);
        assert_eq!(earned(200).len(), 6);
    }

    #[cfg(not(feature = "steam"))]
    #[test]
    fn reporting_without_steam_is_a_no_op() {
        let steam = Steam::init();
        steam.unlock(&earned(6));
        steam.run_callbacks();
    }
}
