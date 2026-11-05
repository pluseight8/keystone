//! Device identity seed storage for the Desktop host.
//!
//! Linux keeps seeds in the user's Secret Service (through `secret-tool`, the
//! same backend as `LinuxSecretToolStorage` in `@keystone/native-host`). Seeds
//! from the older owner-only `identity-keys.json` file are moved there lazily:
//! a seed leaves the file only after the Secret Service returned exactly the
//! same value, so an interrupted migration leaves a readable copy behind.
//! Other platforms keep the 0600 file until their OS keystore is integrated.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub trait SecretBackend {
    /// True when a Secret Service session answered a round-trip probe.
    fn available(&self) -> bool;
    fn store(&self, device_id: &str, seed_b64: &str) -> Result<(), String>;
    fn lookup(&self, device_id: &str) -> Result<Option<String>, String>;
    fn clear(&self, device_id: &str) -> Result<(), String>;
}

/// `secret-tool` client. Secrets travel over stdin only, never argv or logs.
pub struct SecretTool {
    command: String,
    service: String,
    available: std::sync::OnceLock<bool>,
}

impl SecretTool {
    pub fn new(service: &str) -> Self {
        Self { command: "secret-tool".into(), service: service.into(), available: std::sync::OnceLock::new() }
    }

    fn run(&self, args: &[&str], input: Option<&str>) -> Result<(i32, String), String> {
        let mut child = Command::new(&self.command)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Secret Service client is unavailable".to_string())?;
        {
            let mut stdin = child.stdin.take().ok_or("Secret Service client stdin is unavailable")?;
            if let Some(value) = input { stdin.write_all(value.as_bytes()).map_err(|_| "Secret Service write failed")?; }
        }
        // A locked keyring may show an unlock prompt, so allow time for the user.
        let deadline = Instant::now() + Duration::from_secs(60);
        let status = loop {
            if let Some(status) = child.try_wait().map_err(|_| "Secret Service client failed")? { break status; }
            if Instant::now() > deadline { let _ = child.kill(); let _ = child.wait(); return Err("Secret Service operation timed out".into()); }
            std::thread::sleep(Duration::from_millis(10));
        };
        let mut output = String::new();
        if let Some(mut stdout) = child.stdout.take() { let _ = stdout.read_to_string(&mut output); }
        Ok((status.code().unwrap_or(-1), output.trim().to_string()))
    }
}

impl SecretBackend for SecretTool {
    fn available(&self) -> bool {
        *self.available.get_or_init(|| {
            if !cfg!(target_os = "linux") { return false; }
            let probe = format!("probe-{}", std::process::id());
            let stored = self.run(&["store", "--label=Keystone secure-storage probe", "service", &self.service, "probe", &probe], Some("keystone-probe"));
            let found = matches!(self.run(&["lookup", "service", &self.service, "probe", &probe], None), Ok((0, ref value)) if value == "keystone-probe");
            let _ = self.run(&["clear", "service", &self.service, "probe", &probe], None);
            matches!(stored, Ok((0, _))) && found
        })
    }

    fn store(&self, device_id: &str, seed_b64: &str) -> Result<(), String> {
        let label = format!("Keystone device identity ({device_id})");
        match self.run(&["store", &format!("--label={label}"), "service", &self.service, "device", device_id], Some(seed_b64))? {
            (0, _) => Ok(()),
            _ => Err("Secret Service refused to store the device identity".into()),
        }
    }

    fn lookup(&self, device_id: &str) -> Result<Option<String>, String> {
        match self.run(&["lookup", "service", &self.service, "device", device_id], None)? {
            (0, value) if !value.is_empty() => Ok(Some(value)),
            // secret-tool exits 1 with no output when no item matches.
            (0, _) | (1, _) => Ok(None),
            _ => Err("Secret Service lookup failed".into()),
        }
    }

    fn clear(&self, device_id: &str) -> Result<(), String> {
        match self.run(&["clear", "service", &self.service, "device", device_id], None)? {
            (0, _) | (1, _) => Ok(()),
            _ => Err("Secret Service could not remove the device identity".into()),
        }
    }
}

#[derive(Serialize, Deserialize, Default)]
struct LegacyFile { version: u8, keys: HashMap<String, String> }

pub struct IdentityStore<B: SecretBackend> {
    pub legacy_path: PathBuf,
    pub backend: B,
    /// When true, a new identity is never written outside the secure backend.
    pub require_secure: bool,
}

impl<B: SecretBackend> IdentityStore<B> {
    fn read_legacy(&self) -> Result<LegacyFile, String> {
        if !self.legacy_path.exists() { return Ok(LegacyFile { version: 1, keys: HashMap::new() }); }
        let raw = fs::read(&self.legacy_path).map_err(|error| error.to_string())?;
        let value = serde_json::from_slice::<LegacyFile>(&raw).map_err(|_| "Desktop identity store is invalid".to_string())?;
        if value.version != 1 { return Err("Unsupported desktop identity store version".into()); }
        Ok(value)
    }

    fn write_legacy(&self, value: &LegacyFile) -> Result<(), String> {
        if value.keys.is_empty() {
            return match fs::remove_file(&self.legacy_path) { Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()), _ => Ok(()) };
        }
        if let Some(parent) = self.legacy_path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        let temporary = self.legacy_path.with_extension("json.tmp");
        let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        // Create the file owner-only from the start: writing first and chmod-ing
        // afterwards briefly exposed the private seeds under the default umask.
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // A stale temporary file from an earlier crash keeps its old mode; reset it.
            file.set_permissions(fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())?;
        }
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        // Flush to disk before the rename so a crash cannot replace the key store with an empty file.
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        fs::rename(temporary, &self.legacy_path).map_err(|error| error.to_string())
    }

    /// Move one device seed from the legacy file into the secure backend.
    /// Runs on every access, so a migration interrupted at any point resumes.
    fn migrate(&self, device_id: &str) -> Result<(), String> {
        if !self.backend.available() { return Ok(()); }
        let mut legacy = self.read_legacy()?;
        let Some(old) = legacy.keys.get(device_id).cloned() else { return Ok(()) };
        match self.backend.lookup(device_id)? {
            None => {
                self.backend.store(device_id, &old)?;
                if self.backend.lookup(device_id)?.as_deref() != Some(old.as_str()) {
                    return Err("Secret Service did not return the migrated identity; the existing key was kept".into());
                }
            }
            Some(current) if current == old => {}
            // Never pick a side silently: both copies stay until the owner resolves it.
            Some(_) => return Err("Device identity differs between Secret Service and the legacy key file".into()),
        }
        legacy.keys.remove(device_id);
        self.write_legacy(&legacy)
    }

    pub fn provision(&self, device_id: &str, seed: &[u8]) -> Result<(), String> {
        let encoded = STANDARD.encode(seed);
        if self.backend.available() {
            self.migrate(device_id)?;
            if let Some(existing) = self.backend.lookup(device_id)? {
                // Re-provisioning the same seed is idempotent; replacing a different one is refused.
                return if existing == encoded { Ok(()) } else { Err("A different identity already exists for this device".into()) };
            }
            self.backend.store(device_id, &encoded)?;
            return match self.backend.lookup(device_id)? {
                Some(value) if value == encoded => Ok(()),
                _ => { let _ = self.backend.clear(device_id); Err("Secret Service did not return the stored identity".into()) }
            };
        }
        if self.require_secure { return Err("Secret Service is unavailable; start a keyring (for example gnome-keyring or KWallet) to create a Keystone identity".into()); }
        let mut legacy = self.read_legacy()?;
        legacy.version = 1;
        legacy.keys.insert(device_id.to_string(), encoded);
        self.write_legacy(&legacy)
    }

    /// Base64 seed for `device_id`, or None when the device has no identity.
    pub fn seed(&self, device_id: &str) -> Result<Option<String>, String> {
        self.migrate(device_id)?;
        if self.backend.available() {
            if let Some(value) = self.backend.lookup(device_id)? { return Ok(Some(value)); }
        }
        // Existing file seeds stay usable while no Secret Service is reachable, so the owner is never locked out.
        Ok(self.read_legacy()?.keys.get(device_id).cloned())
    }

    pub fn remove(&self, device_id: &str) -> Result<(), String> {
        if self.backend.available() { self.backend.clear(device_id)?; }
        let mut legacy = self.read_legacy()?;
        if legacy.keys.remove(device_id).is_some() { self.write_legacy(&legacy)?; }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Memory { up: bool, items: RefCell<HashMap<String, String>>, corrupt_reads: bool }
    impl SecretBackend for Memory {
        fn available(&self) -> bool { self.up }
        fn store(&self, id: &str, value: &str) -> Result<(), String> { self.items.borrow_mut().insert(id.into(), value.into()); Ok(()) }
        fn lookup(&self, id: &str) -> Result<Option<String>, String> { Ok(self.items.borrow().get(id).map(|value| if self.corrupt_reads { format!("{value}x") } else { value.clone() })) }
        fn clear(&self, id: &str) -> Result<(), String> { self.items.borrow_mut().remove(id); Ok(()) }
    }

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("keystone-identity-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("identity-keys.json")
    }

    fn legacy_with(path: &PathBuf, device: &str, seed: &str) {
        let store = IdentityStore { legacy_path: path.clone(), backend: Memory::default(), require_secure: false };
        store.write_legacy(&LegacyFile { version: 1, keys: HashMap::from([(device.to_string(), seed.to_string())]) }).unwrap();
    }

    #[test]
    fn migrates_legacy_seed_and_deletes_file_only_after_verified_copy() {
        let path = temp_path("migrate");
        legacy_with(&path, "device:a", "c2VlZA==");
        let store = IdentityStore { legacy_path: path.clone(), backend: Memory { up: true, ..Default::default() }, require_secure: true };
        assert_eq!(store.seed("device:a").unwrap().as_deref(), Some("c2VlZA=="));
        assert_eq!(store.backend.items.borrow().get("device:a").map(String::as_str), Some("c2VlZA=="));
        assert!(!path.exists(), "legacy file is removed once it holds no seeds");
    }

    #[test]
    fn keeps_legacy_seed_when_backend_returns_a_different_value() {
        let path = temp_path("verify");
        legacy_with(&path, "device:a", "c2VlZA==");
        let store = IdentityStore { legacy_path: path.clone(), backend: Memory { up: true, corrupt_reads: true, ..Default::default() }, require_secure: true };
        assert!(store.seed("device:a").is_err());
        assert!(path.exists(), "the only verified copy must survive a failed migration");
    }

    #[test]
    fn resumes_after_interruption_between_store_and_file_cleanup() {
        let path = temp_path("resume");
        legacy_with(&path, "device:a", "c2VlZA==");
        let backend = Memory { up: true, ..Default::default() };
        backend.store("device:a", "c2VlZA==").unwrap();
        let store = IdentityStore { legacy_path: path.clone(), backend, require_secure: true };
        assert_eq!(store.seed("device:a").unwrap().as_deref(), Some("c2VlZA=="));
        assert!(!path.exists());
    }

    #[test]
    fn refuses_to_choose_between_conflicting_copies() {
        let path = temp_path("conflict");
        legacy_with(&path, "device:a", "b2xk");
        let backend = Memory { up: true, ..Default::default() };
        backend.store("device:a", "bmV3").unwrap();
        let store = IdentityStore { legacy_path: path.clone(), backend, require_secure: true };
        assert!(store.seed("device:a").is_err());
        assert!(path.exists());
        assert_eq!(store.backend.items.borrow().get("device:a").map(String::as_str), Some("bmV3"));
    }

    #[test]
    fn new_identity_fails_closed_without_secret_service() {
        let path = temp_path("closed");
        let store = IdentityStore { legacy_path: path.clone(), backend: Memory::default(), require_secure: true };
        assert!(store.provision("device:a", &[7; 32]).is_err());
        assert!(!path.exists(), "no silent fallback to the key file");
    }

    #[test]
    fn existing_file_seed_stays_readable_without_secret_service() {
        let path = temp_path("offline");
        legacy_with(&path, "device:a", "c2VlZA==");
        let store = IdentityStore { legacy_path: path.clone(), backend: Memory::default(), require_secure: true };
        assert_eq!(store.seed("device:a").unwrap().as_deref(), Some("c2VlZA=="));
    }

    #[test]
    fn provision_is_idempotent_and_refuses_replacement() {
        let path = temp_path("provision");
        let store = IdentityStore { legacy_path: path.clone(), backend: Memory { up: true, ..Default::default() }, require_secure: true };
        store.provision("device:a", &[1; 32]).unwrap();
        store.provision("device:a", &[1; 32]).unwrap();
        assert!(store.provision("device:a", &[2; 32]).is_err());
        assert!(!path.exists());
        store.remove("device:a").unwrap();
        assert_eq!(store.seed("device:a").unwrap(), None);
    }

    #[test]
    fn legacy_file_is_owner_only() {
        let path = temp_path("mode");
        let store = IdentityStore { legacy_path: path.clone(), backend: Memory::default(), require_secure: false };
        store.provision("device:a", &[3; 32]).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    /// Round-trip through the real Secret Service; run with `cargo test -- --ignored` in a desktop session.
    #[test]
    #[ignore]
    fn real_secret_service_round_trip() {
        let path = temp_path("real");
        legacy_with(&path, "device:keystone-test", "cmVhbC1zZWVk");
        let store = IdentityStore { legacy_path: path.clone(), backend: SecretTool::new("keystone-desktop-identity-test"), require_secure: true };
        assert!(store.backend.available(), "Secret Service is not reachable");
        assert_eq!(store.seed("device:keystone-test").unwrap().as_deref(), Some("cmVhbC1zZWVk"));
        assert!(!path.exists());
        store.remove("device:keystone-test").unwrap();
        assert_eq!(store.seed("device:keystone-test").unwrap(), None);
    }
}
