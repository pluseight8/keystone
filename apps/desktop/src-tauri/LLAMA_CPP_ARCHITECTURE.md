# Embedded llama.cpp architecture

The native process owns one `LlamaState` and therefore one loaded GGUF model.
Model loading and generation must run on blocking workers; neither operation may
block Tauri's async runtime. The frontend never receives a raw llama pointer.

## Cargo.toml additions

```toml
[dependencies]
llama-cpp-2 = "0.1" # pin an audited release/commit in production
tokio = { version = "1", features = ["sync", "rt-multi-thread"] }
uuid = { version = "1", features = ["v4", "serde"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = [] }

[features]
default = []
cuda = ["llama-cpp-2/cuda"]
metal = ["llama-cpp-2/metal"]
vulkan = ["llama-cpp-2/vulkan"]
```

Use only the feature supported by a release artifact. CPU remains the portable
fallback. GPU layer count should be derived from free VRAM and exposed as a user
override. Exact crate feature names must be pinned against the selected
`llama-cpp-2` version because its build interface can change.

## Detailed Rust pseudocode

```rust,ignore
use llama_cpp_2::{LlamaBackend, model::{LlamaModel, params::LlamaModelParams}};
use std::{path::PathBuf, sync::{Arc, atomic::{AtomicBool, Ordering}}};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{Mutex, RwLock};

struct LoadedModel { model: Arc<LlamaModel>, path: PathBuf }
#[derive(Default)]
struct LlamaState {
    backend: OnceCell<LlamaBackend>,
    model: RwLock<Option<LoadedModel>>,
    generation_lock: Mutex<()>,             // contexts are not shared concurrently
    cancellations: DashMap<Uuid, Arc<AtomicBool>>,
}

#[tauri::command]
async fn llama_load_model(state: State<'_, LlamaState>, model_path: PathBuf) -> Result<(), String> {
    // 1. canonicalize; require regular .gguf below app_local_data_dir()/models.
    //    This prevents arbitrary-file probing through the command boundary.
    let canonical = validate_model_path(model_path)?;
    let backend = state.backend.get_or_try_init(LlamaBackend::init)?;
    let backend = backend.clone();
    // 2. Build off the async executor. n_gpu_layers is selected from hardware
    //    capability; mmap=true avoids eagerly copying the complete file.
    let model = spawn_blocking(move || {
        let params = LlamaModelParams::default()
            .with_n_gpu_layers(selected_gpu_layers())
            .with_use_mmap(true);
        LlamaModel::load_from_file(&backend, &canonical, &params)
    }).await??;
    // 3. Atomic replacement: in-flight generation holds its own Arc.
    *state.model.write().await = Some(LoadedModel { model: Arc::new(model), path: canonical });
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct GenerateRequest { request_id: Uuid, system: String, prompt: String,
                         max_tokens: u32, temperature: f32 }

#[derive(Serialize, Clone)]
#[serde(rename_all="camelCase")]
struct TokenEvent { request_id: Uuid, token: Option<String>,
                    done: bool, error: Option<String> }

#[tauri::command]
async fn llama_generate(app: AppHandle, state: State<'_, LlamaState>, request: GenerateRequest)
  -> Result<(), String> {
    validate_limits(&request, /* prompt <= 128 KiB, tokens <= context */)?;
    let model = state.model.read().await.as_ref().ok_or("No model loaded")?.model.clone();
    let cancelled = Arc::new(AtomicBool::new(false));
    state.cancellations.insert(request.request_id, cancelled.clone());
    let state_handle = state.inner().clone();
    // Return once the job has been accepted. Token events carry completion/error.
    tauri::async_runtime::spawn(async move {
      let _one_generation = state_handle.generation_lock.lock().await;
      let result = spawn_blocking(move || -> Result<(), String> {
        // A context owns KV cache. Apply the model's chat template rather than
        // concatenating role strings. Tokenize with add_special=true.
        let mut ctx = model.new_context(context_params(/* n_ctx, threads, batch */))?;
        let prompt = model.apply_chat_template([system_msg, user_msg], true)?;
        let tokens = model.str_to_token(&prompt, AddBos::Always)?;
        ensure_prompt_fits_context(tokens.len(), request.max_tokens)?;
        ctx.decode(batch_from(tokens))?;
        let mut sampler = sampler_chain(request.temperature); // temp=0 => greedy
        let mut utf8 = Utf8TokenBuffer::default();
        for position in prompt_tokens..context_limit {
          if cancelled.load(Ordering::Relaxed) { return Ok(()); }
          let token = sampler.sample(&ctx, -1);
          if model.is_eog_token(token) { break; }
          sampler.accept(token);
          ctx.decode(single_token_batch(token, position))?;
          // Buffer partial byte sequences: one token is not necessarily UTF-8.
          if let Some(text) = utf8.push(model.token_to_bytes(token)?) {
             app.emit("llama://token", TokenEvent::token(request.request_id, text))?;
          }
        }
        if let Some(text) = utf8.finish()? { app.emit("llama://token", TokenEvent::token(id,text))?; }
        Ok(())
      }).await;
      let event = match result {
        Ok(Ok(())) => TokenEvent::done(request.request_id),
        other => TokenEvent::error(request.request_id, sanitize_error(other)),
      };
      let _ = app.emit("llama://token", event);
      state_handle.cancellations.remove(&request.request_id);
    });
    Ok(())
}

#[tauri::command]
fn llama_cancel(state: State<'_, LlamaState>, request_id: Uuid) {
    if let Some(flag) = state.cancellations.get(&request_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
async fn llama_unload_model(state: State<'_, LlamaState>) -> Result<(), String> {
    // Cancel jobs, acquire generation_lock, then drop the model Arc.
    cancel_all(&state.cancellations);
    let _exclusive = state.generation_lock.lock().await;
    *state.model.write().await = None;
    Ok(())
}

// Builder wiring:
.manage(LlamaState::default())
.invoke_handler(tauri::generate_handler![
  /* existing commands */, llama_load_model, llama_generate,
  llama_cancel, llama_unload_model
])
```

The downloader's native `LocalFileSystem` bridge should use `app.path().app_local_data_dir()`
plus `models`, write `.part` files with seek/write/flush, and rename only after the
TypeScript SHA-256 verifier succeeds. Production builds should additionally
recompute SHA-256 natively before loading to keep the Tauri trust boundary strict.
