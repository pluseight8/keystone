# AI Resource Modes

Resource modes are local scheduling policies, not privacy policies. The existing Local / Personal Trusted Compute / External AI boundaries remain unchanged.

## PERFORMANCE

Use when the device is plugged in or has spare resources. Multiple foreground and bounded background jobs may share the loaded runtime. Per-agent quotas and the maximum queue still apply.

## BALANCED

The default policy. Foreground requests stay responsive while one bounded background slot handles tasks such as Memory consolidation or recommendations. Background jobs yield cooperatively when an interactive request arrives.

## GAMING

The host can keep the foreground assistant available while pausing ordinary background inference and Memory consolidation. Recommendations are accepted only when the job is explicitly marked `cheap`; the scheduler does not silently run an expensive recommendation in this mode.

## BATTERY

The model may be unloaded as soon as it becomes idle. Proactive/background work is strongly limited and private tasks never fall back to an external provider. A host may expose a battery/charging signal to tighten the policy further.

## Pressure signals

High RAM/VRAM pressure, critical thermal state or saturated CPU/GPU reduces concurrency and pauses background work. A host can also request a model unload after the scheduler reaches `IDLE`. These decisions are local and are not reported as telemetry.

## Keep-loaded policy

`never`, `5m`, `15m` and `always` control idle lifecycle only. They do not change Agent identity or session durability. Reloading the same `provider/model` creates a new lease for the next job, while the durable Agent/Memory state remains intact.
