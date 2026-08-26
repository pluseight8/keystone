# Plugin recovery

Recovery is exact-content repair, not a trust bypass. Startup or health checks can classify missing/corrupt bytes, interrupted updates/migrations, crash loops, missing dependencies, incompatibility and security quarantine. Repair reacquires the exact `sha256:` revision from any allowed source, repeats quarantine, integrity, signature, compatibility and revocation checks, and preserves current grants/policy. A revoked revision is never a rollback target.

Revision archives are bounded. A source outage does not affect a locally installed validated revision, and rollback changes code only—not revoked authority, secrets or MandatoryPolicy.
