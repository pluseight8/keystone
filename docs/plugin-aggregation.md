# Plugin provider aggregation

Keystone owns fan-out, timeout, cancellation, privacy, SafetySurfaceGate,
attribution and final ranking. Plugin scores are bounded hints only. Provider
IDs are namespaced and source metadata cannot claim `KEYSTONE_NATIVE`.

Media source enablement is an explicit owner setting (`PluginMediaSourceRegistry`);
installation never silently makes a provider global. Search and media pages are
bounded to 100 items and provider failures return partial results while native
content continues to work.
