# Protocol compatibility and canonical data

Keystone envelopes and social objects currently use schema version `1`. Unknown
or malformed envelopes are rejected at the transport/application boundary;
signed objects use strict Zod schemas. Canonical JSON sorts object keys
recursively before signing, so object-key insertion order cannot change a
signature or action hash.

The unit suite carries a fixed v1 canonical-JSON vector and a BLAKE2b-256
action-hash vector. Changing either requires an intentional protocol-version
decision, not an incidental serializer change.

There is no older social-object schema compatibility promise yet. A future
version must add an explicit migration/compatibility test before it is accepted
by a current peer; silently treating an unknown version as version `1` is not
allowed.

## Canonical JSON v1: known properties

`canonicalJson` in `packages/core/src/crypto.ts` is the v1 format. Its
behaviour is frozen by vectors in `crypto.test.ts`, including a test that runs
it in separate processes under `C`, `ru`, `lt`, `da`, `et` and `tr` locales.

- **Key order** is the ICU `en` collation (`localeCompare(b, 'en')`), not
  UTF-16 code-unit order: `a` < `A` < `b`, `_x` before digits. It no longer
  follows the OS locale. Before November 2026 it did, so objects with
  non-ASCII keys signed under a non-English locale may hash differently now;
  an instrumented run of the Core suite found no non-ASCII keys in signed data.
  The order still depends on ICU, which a non-JavaScript implementation would
  have to reproduce exactly.
- **`undefined` properties** serialize as `"key":undefined`, which is not JSON.
  After JSON transport the property disappears, so a peer computes different
  bytes and signature verification fails. The instrumented run found such
  fields in signed objects (for example `payload.thumbnailUri` and
  `payload.publishedAt` in Video/Shorts, `parentWorkerId` in agent workers).
- **Non-plain values** lose information: `Date` and `Map` become `{}`,
  `NaN`/`Infinity` become `null`, `-0` becomes `0`, typed arrays become
  objects with index keys. None appeared in signed data in the Core suite.
- Strings are not Unicode-normalized; lone surrogates are escaped as by
  `JSON.stringify`.

## Canonical JSON v2

`canonicalJsonV2` in `packages/core/src/crypto.ts` follows RFC 8785 (JSON
Canonicalization Scheme): keys in UTF-16 code-unit order, `undefined`
properties omitted (as JSON transport omits them), and a `TypeError` for values
JSON cannot carry (`undefined` in an array, non-finite numbers, `bigint`,
functions, symbols, non-plain objects such as `Date`, `Map` or typed arrays,
and lone surrogates). Vectors live in `canonical-v2.test.ts`.

**The marker.** A signature made over v2 bytes starts with `c2.`; the rest is
the unchanged base64url Ed25519 signature. `signCanonical` produces it and
`verifyCanonical` / `canonicalSigned` pick the bytes from it:

- `c2.` present: verify against v2 bytes;
- no marker: verify against v1 bytes, so objects signed and stored before v2
  stay valid. v1 is never used to create a new signature.

The marker sits outside the signed bytes. Moving it does not help an attacker:
a v2 signature checked as v1 (or the reverse) only verifies when both
serializations are byte-identical, which means the same JSON value. A value v2
cannot represent is rejected by the verifier and is an error for the signer.

**What uses v2.** Every signature Core creates: transport envelopes and the
domain-separated identity signatures, social objects, messages, communities,
spaces, publications, calendar, tasks, vaults, shared folders, device mesh,
delay-tolerant parcel manifests, agent protocols, and the desktop host signer.

**What stays on v1, deliberately.** Anything that is an identifier or bound
data rather than a signature: action hashes, content ids, integrity digests,
fingerprints, AEAD associated data and comparisons. These values are already
stored or shared, so changing their bytes would orphan them; they keep the v1
properties above. Contact replication signatures keep their own v1 serializer
(`contacts.ts`), which already omits `undefined`. Moving any of these needs its
own versioned identifier, not a serializer swap.

**Compatibility.** A build without v2 rejects a `c2.` signature (it is not
valid base64url), so it fails closed instead of misreading it; mixed
deployments must update verifiers before signers. There is no cut-off date for
unmarked signatures yet: stored v1 objects have no re-signing path.
