# Owner Authority

Models propose settings changes; `OwnerAuthorityService` decides whether a consequence may be applied. An `OwnerRequestedSettingsIntent` is signed by the owner and bound to the owner identity, device, session, source interaction, requested paths/values/actions, timestamp, nonce/request id and short expiry. Replays, stale requests, wrong signatures and out-of-scope values are rejected.

Settings classes are:

- `USER_PREFERENCE` — appearance, language, layout and presentation;
- `PRIVACY_SETTING` — presence, receipts, discovery, location and contextual AI access;
- `SECURITY_SETTING` — device trust, plugin/agent capabilities, browser permissions and recovery choices;
- `IMMUTABLE_POLICY` — integrity, crypto/protocol validation, Safety, ToolPolicy, sandbox and AI-egress roots.

Preference mutations may use a fresh explicit request. Disclosure changes require preview/confirmation; security changes require strong or double confirmation; immutable policy is always denied. Remote agents cannot mutate owner settings. Skills and plugins must use the normal owner request and a scoped, non-expired capability; they cannot mutate core policy.

`SettingsService.updateByAuthority` and `AISettingsService.updateByAuthority` are the integration points for AI/agent callers. Direct `update` remains the owner-facing UI adapter and does not turn model output into authority.
