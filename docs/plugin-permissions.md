# Plugin permissions

Owner policy may grant only capabilities declared by the current manifest. A
grant is bound to Plugin ID, revision hash, scope, owner and optional context or
expiry. Revocation is immediate for new calls and is durable. Updates never
inherit authority from a prior executable hash; new permissions require review.
