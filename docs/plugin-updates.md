# Plugin updates

Update discovery returns candidates only. Downloaded, verified and staged bytes are distinct from applying an update. Updates are compared by immutable revision hash, publisher, dependencies, compatibility and capability diff. Same version with different bytes is a separate revision and is never silently substituted.

A compatible update without authority changes may be eligible under the owner's policy. Capability expansion, publisher/dependency authority changes, incompatibility, invalid integrity or security revocation always stop at `REVIEW_REQUIRED`/rejection. Active executable bytes are never mutated in place; the previous known-good revision remains the recovery target when safe.
