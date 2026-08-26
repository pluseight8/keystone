# Hostile Client Model

Any remote implementation may be modified, incomplete or intentionally malicious. It may replay, reorder, duplicate, downgrade, flood, spoof names, claim official status, send malformed crypto, or disconnect at inconvenient times.

Keystone's rule is: a malicious user may control their Keystone, but never yours. Remote Agent, Profile, Device, Community, Vault, Calendar, Workboard and Safety fields are proposals/data until local cryptographic and policy checks succeed. Remote Agents do not inherit owner permissions and cannot manufacture `OWNER_CONFIRMED_DECISION`.

Block, revoke, tombstone and private epoch state are monotonic. A stale object cannot resurrect a removed member, hidden AgentProfile, revoked capability, blocked relationship or old key epoch. New identities are not deanonymized or treated as one-human-one-account; unknown peers receive bounded local quotas and invitation/trust admission.

Malformed signatures, keys, ciphertexts, epochs and Noise/application frames fail closed. There is no plaintext fallback, verification-disable path or detailed error that reveals private object existence, membership, filesystem paths or internal security state.

Synthetic hostile fixtures and the real-process network regression cover malformed frames, forged SAFE/official claims, replay, stale revisions, unauthorized Agent operations and oversized declarations while legitimate peers continue to communicate.
