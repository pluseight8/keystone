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

## Planned canonical JSON v2

v2 should follow RFC 8785 (JSON Canonicalization Scheme): UTF-16 code-unit key
order, `undefined` properties omitted, and an error for non-JSON values. It
changes signed bytes, so it needs an explicit marker on signed objects and a
transition period in which verifiers accept a v1 signature only for objects
without the marker. The serializer change and the marker must ship together
with cross-version vectors.
