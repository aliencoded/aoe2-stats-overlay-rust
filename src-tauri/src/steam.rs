#[cfg(windows)]
pub fn current_steam_id64() -> anyhow::Result<String> {
    use anyhow::{anyhow, Context};
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_DWORD,
        REG_VALUE_TYPE,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe {
        let mut hkey = HKEY::default();
        let subkey = wide("Software\\Valve\\Steam\\ActiveProcess");
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            0,
            KEY_READ,
            &mut hkey,
        )
        .ok()
        .context("open HKCU\\Software\\Valve\\Steam\\ActiveProcess (Steam not installed?)")?;

        let name = wide("ActiveUser");
        let mut kind = REG_VALUE_TYPE(0);
        let mut data: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let res = RegQueryValueExW(
            hkey,
            PCWSTR(name.as_ptr()),
            None,
            Some(&mut kind),
            Some(&mut data as *mut u32 as *mut u8),
            Some(&mut size),
        );
        let _ = RegCloseKey(hkey);
        res.ok().context("read ActiveUser value")?;
        if kind != REG_DWORD {
            return Err(anyhow!("ActiveUser is not REG_DWORD"));
        }
        if data == 0 {
            return Err(anyhow!("Steam not logged in (ActiveUser=0)"));
        }
        let steam_id64: u64 = 76561197960265728u64 + data as u64;
        Ok(steam_id64.to_string())
    }
}

#[cfg(not(windows))]
pub fn current_steam_id64() -> anyhow::Result<String> {
    Err(anyhow::anyhow!("Steam ID lookup only supported on Windows"))
}
