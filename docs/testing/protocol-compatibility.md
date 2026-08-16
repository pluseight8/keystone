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
